import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { Server as SocketIOServer } from 'socket.io';
import { connectToDatabase } from './lib/mongodb';
import { Room } from './models/Room';
import dotenv from 'dotenv';
import { AIService } from './lib/ai/aiService';
import { GameCategory, JudgingStyle, GameState } from './types/gameState';
import { v4 as uuidv4 } from 'uuid';
import mongoose from 'mongoose';

// Load environment variables
dotenv.config({ path: '.env.local' });

// Initialize AIService - reset counter and prepare for a fresh start
console.log('Initializing AIService...');
AIService.resetApiCallCounter();
AIService.clearCache();
// Questions will be fetched when games start, not at server startup

/**
 * Type definitions
 */
interface Player {
  id: string;
  nickname: string;
  isHost: boolean;
  isConnected: boolean;
}

interface PlayerInfo {
  id: string;
  nickname: string;
  isHost: boolean;
}

interface SocketPlayerInfo {
  playerId: string;
  roomCode: string;
  nickname: string;
}

// Additional type definition for round history item
interface RoundHistoryItem {
  round: number;
  category: GameCategory;
  question: string;
  answers: Record<string, string>;
  winners: string[];
  explanation: string;
}

// At the top of the file, before app.prepare(), add a simple cache for room data
// Simple in-memory cache for rooms to reduce database queries
const roomCache = new Map<string, { data: any, timestamp: number }>();
const CACHE_TTL = 2000; // 2 seconds TTL for cache

// Track rooms with pending deletion (roomCode -> timeout ID)
const pendingRoomDeletions = new Map<string, NodeJS.Timeout>();
const ROOM_DELETION_DELAY = 5 * 60 * 1000; // 5 minutes in milliseconds

// Helper function to get room with cache
async function getRoomWithCache(roomCode: string, forceFresh: boolean = false): Promise<any> {
  // Skip cache if force fresh is requested
  if (forceFresh) {
    console.log(`Fetching fresh room data for ${roomCode} (cache bypassed)`);
    const room = await Room.findOne({ code: roomCode });
    if (room) {
      // Update cache with fresh data
      roomCache.set(roomCode, { data: room, timestamp: Date.now() });
    }
    return room;
  }

  // Check if we have a valid cache entry
  const cachedRoom = roomCache.get(roomCode);
  if (cachedRoom && (Date.now() - cachedRoom.timestamp) < CACHE_TTL) {
    console.log(`Using cached room data for ${roomCode} (age: ${Date.now() - cachedRoom.timestamp}ms)`);
    return cachedRoom.data;
  }

  // No valid cache, fetch from database
  console.log(`Cache miss for room ${roomCode}, fetching from database`);
  const room = await Room.findOne({ code: roomCode });
  if (room) {
    // Update cache with fresh data
    roomCache.set(roomCode, { data: room, timestamp: Date.now() });
  }
  return room;
}

// Helper function to invalidate cache when a room is updated
function invalidateRoomCache(roomCode: string) {
  console.log(`Invalidating cache for room ${roomCode}`);
  roomCache.delete(roomCode);
}

// Helper function to broadcast room updates once
async function broadcastRoomUpdate(roomCode: string, room: any): Promise<void> {
  console.log(`Broadcasting room update to room ${roomCode} (${room.players.length} players)`);
  
  const formattedRoom = formatRoomForClient(room);
  
  // Return a promise that resolves when the broadcast is complete
  return new Promise<void>((resolve) => {
    io.to(roomCode).emit('roomUpdate', formattedRoom);
    
    // Fetch socket count for debugging (don't block on this)
    io.in(roomCode).fetchSockets()
      .then(sockets => {
        console.log(`Room update sent to ${sockets.length} sockets in room ${roomCode}`);
        resolve(); // Resolve the promise
      })
      .catch(err => {
        console.error('Error fetching socket count:', err);
        resolve(); // Resolve even on error
      });
  });
}

// Next.js setup
const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

// Verify environment variables
if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is not defined in environment variables');
  process.exit(1);
}

// Define io at a higher scope so it's available to helper functions
let io: SocketIOServer;

// Helper function to format room for client
function formatRoomForClient(room: any) {
  if (!room) return null;
  
  try {
    // Make sure room code is properly preserved and never becomes "unknown"
    const roomCode = room.code || (room._id ? String(room._id) : 'unknown');
    
    // Create a proper copy of the room object with null/undefined checks
    const formattedRoom = {
      code: roomCode,
      status: room.status || 'unknown',
      players: Array.isArray(room.players) ? room.players : [],
      currentRound: room.currentRound || 0,
      gameState: room.gameState ? { ...room.gameState } : null
    };
    
    // Ensure room code is consistent in logs
    console.log(`[formatRoomForClient] Room ${formattedRoom.code} has game state: ${formattedRoom.gameState?.status || 'unknown'}`);
    console.log(`[formatRoomForClient] Game state details: round=${formattedRoom.gameState?.round || 0}, players=${formattedRoom.players.length}`);
    
    return formattedRoom;
  } catch (error) {
    console.error(`[formatRoomForClient] Error formatting room:`, error);
    // Return a minimal valid object in case of error, still preserving room code
    return {
      code: room?.code || (room?._id ? String(room._id) : 'unknown'),
      status: room?.status || 'unknown',
      players: Array.isArray(room?.players) ? room.players : [],
      currentRound: room?.currentRound || 0,
      gameState: room?.gameState ? { ...room.gameState } : null
    };
  }
}

// Add timeout protection for Next.js app preparation
const nextJsTimeout = setTimeout(() => {
  console.error('Next.js preparation is taking too long (>30s). This may indicate a problem with webpack or caching.');
  console.error('You may want to run `npm run clean` and restart the server.');
}, 30000);

// Prepare Next.js app with better error handling
app.prepare()
  .then(() => {
    clearTimeout(nextJsTimeout);
    console.log('Next.js app prepared successfully');
    
    // Create HTTP server
    const server = createServer((req, res) => {
      try {
        const parsedUrl = parse(req.url!, true);
        handle(req, res, parsedUrl);
      } catch (error) {
        console.error('Error handling request:', error);
        res.statusCode = 500;
        res.end('Internal Server Error');
      }
    });

    // Initialize Socket.IO
    console.log('Initializing Socket.IO server...');
    io = new SocketIOServer(server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      },
      path: '/socket.io',
      transports: ['websocket', 'polling']
    });

    // Track socket to player ID mapping
    const socketToPlayer = new Map<string, SocketPlayerInfo>();

    /**
     * Diagnostic function to log all sockets in a room
     */
    function logSocketsInRoom(roomCode: string) {
      try {
        const room = io.sockets.adapter.rooms.get(roomCode);
        if (!room) {
          console.log(`No sockets found in room ${roomCode}`);
          return;
        }
        
        const socketsInRoom = Array.from(room);
        console.log(`Sockets in room ${roomCode}: ${socketsInRoom.length}`);
        
        // Log details about each socket
        socketsInRoom.forEach(socketId => {
          const playerInfo = socketToPlayer.get(socketId);
          if (playerInfo) {
            console.log(`  - Socket ${socketId}: Player ${playerInfo.nickname} (${playerInfo.playerId}), ${playerInfo.playerId ? 'isConnected' : 'not connected'}`);
          } else {
            console.log(`  - Socket ${socketId}: No player info found`);
          }
        });
      } catch (error) {
        console.error('Error logging sockets in room:', error);
      }
    }

    // Connect to MongoDB
    connectToDatabase().catch(error => {
      console.error('Failed to connect to MongoDB:', error);
      process.exit(1);
    });
    
    /**
     * Socket connection handler
     */
    io.on('connection', (socket) => {
      console.log('New socket connection:', socket.id);
      
      // Get player info from query parameters
      const queryInfo = socket.handshake.query;
      const playerId = queryInfo.playerId;
      const roomCode = queryInfo.roomCode;
      const nickname = queryInfo.nickname;

      // Register player if all required info is provided
      if (playerId && roomCode && nickname) {
        const playerIdStr = Array.isArray(playerId) ? playerId[0] : playerId;
        const roomCodeStr = Array.isArray(roomCode) ? roomCode[0] : roomCode;
        const nicknameStr = Array.isArray(nickname) ? nickname[0] : nickname;

        console.log(`Socket ${socket.id} authenticated for player ${nicknameStr} (${playerIdStr}) in room ${roomCodeStr}`);

        // Check if this socket is already connected for this player
        for (const [existingSocketId, playerInfo] of socketToPlayer.entries()) {
          if (playerInfo.playerId === playerIdStr && existingSocketId !== socket.id) {
            console.log(`Disconnecting duplicate socket for player: ${playerIdStr}`);
            const existingSocket = io.sockets.sockets.get(existingSocketId);
            if (existingSocket) {
              existingSocket.disconnect();
            }
            socketToPlayer.delete(existingSocketId);
          }
        }

        // Store player info in socket mapping
        socketToPlayer.set(socket.id, {
          playerId: playerIdStr,
          roomCode: roomCodeStr,
          nickname: nicknameStr
        });

        // Join the room immediately
        socket.join(roomCodeStr);
        console.log(`Socket ${socket.id} joined room ${roomCodeStr}`);
        
        // Check if player exists in the room and update connection status
        connectToDatabase().then(async () => {
          try {
            const room = await Room.findOne({ code: roomCodeStr });
            if (room) {
              const existingPlayer = room.players.find((p: Player) => p.id === playerIdStr);
              
              if (existingPlayer) {
                console.log(`Player ${nicknameStr} found in room ${roomCodeStr}, updating connection status`);
                
                // Even if already connected, we update to ensure proper status
                await Room.updateOne(
                  { code: roomCodeStr, "players.id": playerIdStr },
                  { $set: { "players.$.isConnected": true } }
                );
                
                // Send immediate confirmation to this player
                socket.emit('connectionStatus', { 
                  status: 'connected',
                  socketId: socket.id,
                  playerId: playerIdStr,
                  roomCode: roomCodeStr,
                  isHost: existingPlayer.isHost,
                  message: 'You are now connected to the room'
                });
                
                // Add a small delay before sending room updates to ensure all clients are ready
                setTimeout(async () => {
                  // Get updated room with fresh query
                  const updatedRoom = await Room.findOne({ code: roomCodeStr });
                  if (updatedRoom) {
                    // Broadcast to EVERYONE including the just-connected player
                    console.log(`Broadcasting delayed room update for ${nicknameStr}'s connection`);
                    io.to(roomCodeStr).emit('roomUpdate', formatRoomForClient(updatedRoom));
                    
                    // If the game is in progress, also send current game state to the reconnected player
                    if (updatedRoom.gameState) {
                      socket.emit('gameState', updatedRoom.gameState);
                      
                      if (updatedRoom.gameState.status === 'answering' && updatedRoom.gameState.timeRemaining) {
                        socket.emit('timerUpdate', updatedRoom.gameState.timeRemaining);
                      }
                    }
                    
                    // Send ANOTHER room update after another brief delay to ensure changes propagate
                    setTimeout(async () => {
                      const finalRoom = await Room.findOne({ code: roomCodeStr });
                      if (finalRoom) {
                        console.log(`Broadcasting final room update confirmation for ${nicknameStr}`);
                        io.to(roomCodeStr).emit('roomUpdate', formatRoomForClient(finalRoom));
                      }
                    }, 1000);
                  }
                }, 500);
              } else {
                console.log(`Player ${nicknameStr} not found in room ${roomCodeStr}, they may need to join first`);
                socket.emit('error', 'You are not in this room. Please join first.');
              }
            } else {
              console.log(`Room ${roomCodeStr} not found during socket connection`);
              socket.emit('error', 'Room not found');
            }
          } catch (error) {
            console.error('Error updating player connection status:', error);
            socket.emit('error', 'Server error when updating connection');
          }
        });
      } else {
        console.log('Incomplete socket connection parameters:', { playerId, roomCode, nickname });
        socket.emit('error', 'Incomplete connection info');
      }
      
      /**
       * Handle player reconnection event
       * When a player refreshes the page, they first reconnect then join
       */
      socket.on('playerReconnected', async (data: { roomCode: string, playerId: string, nickname: string }) => {
        try {
          console.log(`Player ${data.nickname} (${data.playerId}) reconnecting to room ${data.roomCode}`);
          
          // Ensure database connection
          await connectToDatabase();
          
          // Check if room exists
          const room = await Room.findOne({ code: data.roomCode });
          if (!room) {
            console.log(`Room ${data.roomCode} not found during reconnection`);
            socket.emit('error', 'Room not found');
            return;
          }
          
          // Check if player exists in room and just mark as connected
          const player = room.players.find((p: Player) => p.id === data.playerId);
          if (player) {
            console.log(`Found existing player ${data.playerId} in room ${data.roomCode}, marking as connected`);
            
            // Update player to connected status
            await Room.updateOne(
              { code: data.roomCode, "players.id": data.playerId },
              { $set: { "players.$.isConnected": true } }
            );
            
            // Update socket to player mapping
            socketToPlayer.set(socket.id, {
              playerId: data.playerId,
              roomCode: data.roomCode,
              nickname: data.nickname
            });
            
            // Join the socket room
            socket.join(data.roomCode);
            
            // If room was pending deletion, cancel it
            cancelRoomDeletion(data.roomCode);
            
            // Get the updated room and broadcast to all clients
            invalidateRoomCache(data.roomCode);
            const updatedRoom = await getRoomWithCache(data.roomCode, true);
            await broadcastRoomUpdate(data.roomCode, updatedRoom);
            
            // Confirm reconnection to client
            socket.emit('roomJoined', {
              roomCode: data.roomCode,
              playerId: data.playerId,
              isHost: player.isHost,
              message: 'Reconnected successfully'
            });
            
            // Log connected sockets in room
            logSocketsInRoom(data.roomCode);
          } else {
            console.log(`Player ${data.playerId} not found in room ${data.roomCode} during reconnection`);
          }
        } catch (error) {
          console.error('Error handling playerReconnected:', error);
          socket.emit('error', 'Failed to reconnect to room');
        }
      });

      /**
       * Handle join room event
       * Adds players to rooms when they join
       */
      socket.on('joinRoom', async (data: { roomCode: string, nickname: string, playerId?: string }) => {
        try {
          console.log(`Socket ${socket.id} attempting to join room ${data.roomCode}`);
          
          // Ensure database connection
          await connectToDatabase();
          
          // Check if room exists
          const room = await Room.findOne({ code: data.roomCode });
          if (!room) {
            console.log(`Room ${data.roomCode} not found`);
            socket.emit('error', 'Room not found');
            return;
          }
          
          // Handle reconnection with existing player ID
          if (data.playerId) {
            const existingPlayer = room.players.find((p: Player) => p.id === data.playerId);
            if (existingPlayer) {
              console.log(`Player ${data.playerId} already exists in room, handling as reconnection`);
              
              // Update player's connection status if they were disconnected
              if (!existingPlayer.isConnected) {
                await Room.updateOne(
                  { code: data.roomCode, "players.id": data.playerId },
                  { $set: { "players.$.isConnected": true } }
                );
              }
              
              // Update socket to player mapping
              socketToPlayer.set(socket.id, {
                playerId: data.playerId,
                roomCode: data.roomCode,
                nickname: data.nickname
              });
              
              // Join the socket room
              socket.join(data.roomCode);
              
              // If room was pending deletion, cancel it
              cancelRoomDeletion(data.roomCode);
              
              // Get the updated room and broadcast to all clients
              invalidateRoomCache(data.roomCode);
              const updatedRoom = await getRoomWithCache(data.roomCode, true);
              await broadcastRoomUpdate(data.roomCode, updatedRoom);
              
              // Confirm reconnection to client
              socket.emit('roomJoined', {
                roomCode: data.roomCode,
                playerId: data.playerId,
                isHost: existingPlayer.isHost,
                message: 'Rejoined room successfully'
              });
              
              console.log(`Player ${data.nickname} (${data.playerId}) successfully reconnected to room ${data.roomCode}`);
              logSocketsInRoom(data.roomCode);
              return;
            } else {
              console.log(`Player ID ${data.playerId} provided but not found in room, will create new player`);
            }
          }
          
          // New player joining - create player ID
          const playerId = data.playerId || uuidv4();
          
          // Check if room is full (maximum 8 players)
          if (room.players.length >= 8) {
            console.log(`Room ${data.roomCode} is full`);
            socket.emit('error', { message: 'Room is full' });
            return;
          }
          
          // Check if nickname already exists in room
          if (room.players.some((p: Player) => p.nickname === data.nickname)) {
            console.log(`Nickname ${data.nickname} already exists in room ${data.roomCode}`);
            socket.emit('error', { message: 'Nickname already exists in room' });
            return;
          }
          
          // Add player to room
          const isHost = room.players.length === 0;
          const player = {
            id: playerId,
            nickname: data.nickname,
            isHost,
            isConnected: true,
            joinedAt: new Date()
          };
          
          // Update database
          await Room.updateOne(
            { code: data.roomCode },
            { $push: { players: player } }
          );
          
          // Update socket to player mapping
          socketToPlayer.set(socket.id, {
            playerId,
            roomCode: data.roomCode,
            nickname: data.nickname
          });
          
          // Join the socket room
          socket.join(data.roomCode);
          
          // If room was pending deletion, cancel it
          cancelRoomDeletion(data.roomCode);
          
          // Get the updated room and broadcast to all clients
          invalidateRoomCache(data.roomCode);
          const updatedRoom = await getRoomWithCache(data.roomCode, true);
          await broadcastRoomUpdate(data.roomCode, updatedRoom);
          
          // Confirm join to client
          socket.emit('roomJoined', {
            roomCode: data.roomCode,
            playerId,
            isHost,
            message: 'Joined room successfully'
          });
          
          console.log(`Player ${data.nickname} (${playerId}) successfully joined room ${data.roomCode} as ${isHost ? 'host' : 'player'}`);
          logSocketsInRoom(data.roomCode);
        } catch (error) {
          console.error('Error joining room:', error);
          socket.emit('error', 'Failed to join room');
        }
      });

      /**
       * Leave room event handler
       * Removes a player from a room, reassigns host if needed, and broadcasts the update
       */
      socket.on('leaveRoom', async (roomCode: string) => {
        console.log(`========== LEAVE ROOM EVENT RECEIVED ==========`);
        console.log(`Socket ${socket.id} is leaving room ${roomCode}`);
        
        try {
          // Get player info from socket mapping
          const playerInfo = socketToPlayer.get(socket.id);
          if (!playerInfo) {
            console.log('No player info found for socket');
            socket.emit('error', 'Not connected to a room');
            return;
          }

          console.log(`Processing leave room for player ${playerInfo.nickname} (${playerInfo.playerId})`);

          // Ensure database connection
          await connectToDatabase();
          
          // Find the room with fresh data to verify the player exists
          const room = await getRoomWithCache(roomCode, true); // Force fresh data
          if (!room) {
            console.log('Room not found:', roomCode);
            socket.emit('error', 'Room not found');
            return;
          }

          // Find the leaving player
          const leavingPlayer = room.players.find((p: Player) => p.id === playerInfo.playerId);
          if (!leavingPlayer) {
            console.log('Player not found in room');
            socket.emit('error', 'You are not in this room');
            return;
          }

          console.log(`${leavingPlayer.nickname} is leaving room ${roomCode}`);
          const wasHost = leavingPlayer.isHost;
          const leavingPlayerNickname = leavingPlayer.nickname;

          // CRITICAL FIX: Use findOneAndUpdate for atomic removal operation
          // Intentional leave = immediate removal (no delay needed)
          console.log(`Immediately removing player ${leavingPlayerNickname} (intentional leave)`);
          const updatedRoomDoc = await Room.findOneAndUpdate(
            { code: roomCode },
            { $pull: { players: { id: playerInfo.playerId } } },
            { new: true } // Return the updated document
          );

          if (!updatedRoomDoc) {
            console.log('Failed to update room when player left');
            socket.emit('error', 'Failed to leave room, please try again');
            return;
          }

          // Verify player was removed
          const playerStillExists = updatedRoomDoc.players.some((p: Player) => p.id === playerInfo.playerId);

          if (playerStillExists) {
            console.error(`Failed to remove player ${playerInfo.playerId} from room ${roomCode}`);
            console.log('Current players in room:', updatedRoomDoc.players);
            socket.emit('error', 'Failed to leave room, please try again');
            return;
          }

          console.log(`Successfully removed player ${leavingPlayerNickname} from database. Remaining players: ${updatedRoomDoc.players.length}`);

          // Invalidate the room cache
          invalidateRoomCache(roomCode);

          // If the leaving player was the host and there are other players, assign a new host
          if (wasHost && updatedRoomDoc.players.length > 0) {
            console.log(`Previous host left, transferring host status to next player in line`);
            await transferHostStatus(roomCode);
            
            // Get the latest room data after host transfer and invalidate cache
            invalidateRoomCache(roomCode);
            const roomAfterHostTransfer = await getRoomWithCache(roomCode, true);
            if (roomAfterHostTransfer) {
              // Use the updated room for subsequent operations
              Object.assign(updatedRoomDoc, roomAfterHostTransfer);
            }
          }

          if (updatedRoomDoc.players.length === 0) {
            // Instead of deleting the room immediately, schedule it for deletion
            console.log(`Room ${roomCode} is now empty, scheduling for deletion`);
            scheduleRoomDeletion(roomCode);
          } else {
            // Notify remaining players
            await broadcastRoomUpdate(roomCode, updatedRoomDoc);
            console.log(`Room update sent to ${updatedRoomDoc.players.length} remaining players after ${leavingPlayerNickname} left`);
            logSocketsInRoom(roomCode);
          }
          
          // Clean up socket connection
          socketToPlayer.delete(socket.id);
          socket.leave(roomCode);
          
          // Notify client to clear storage for this room
          socket.emit('clearRoomStorage', { roomCode });
          
          // Confirm leave room was processed successfully
          socket.emit('leftRoom', { roomCode, success: true });
          
          console.log(`========== LEAVE ROOM COMPLETE FOR ${leavingPlayerNickname} ==========`);
          
          // Disconnect this socket with a small delay to ensure messages are sent
          setTimeout(() => {
            try {
              if (socket.connected) {
                console.log(`Disconnecting socket ${socket.id} after successful leave room`);
                socket.disconnect(true);
              }
            } catch (error) {
              console.error('Error disconnecting socket:', error);
            }
          }, 100);
        } catch (error) {
          console.error('Error in leaveRoom handler:', error);
          socket.emit('error', 'Server error when leaving room');
          
          // Even with error, try to clean up client resources
          socket.emit('clearRoomStorage', { roomCode });
        }
      });

      /**
       * Start game event handler
       * Initiates the game when the host clicks the Begin button
       */
      socket.on('startGame', async () => {
        console.log('Start game event received');
        
        try {
          // Get player info from socket mapping
          const playerInfo = socketToPlayer.get(socket.id);
          if (!playerInfo) {
            console.log('No player info found for socket');
            return;
          }

          const { roomCode, playerId } = playerInfo;
          
          // Ensure database connection
          await connectToDatabase();
          
          // Find the room
          const room = await Room.findOne({ code: roomCode });
          if (!room) {
            console.log('Room not found:', roomCode);
            return;
          }

          // Verify the player is the host
          const hostPlayer = room.players.find((p: Player) => p.id === playerId);
          if (!hostPlayer || !hostPlayer.isHost) {
            console.log('Only the host can start the game');
            return;
          }

          if (room.players.length < 2) {
            console.log('Need at least 2 players to start the game');
            return;
          }

          // Clear existing question cache and fetch fresh questions for this game
          console.log(`Fetching fresh questions for room ${roomCode}`);
          AIService.clearCache();
          AIService.fetchAllCategoryQuestions().then(() => {
            console.log(`Successfully fetched fresh questions for room ${roomCode}`);
          }).catch(error => {
            console.error(`Error fetching questions for room ${roomCode}:`, error);
            // Game will still work with fallback questions if fetch fails
          });

          // Initialize scores for all players
          const initialScores: Record<string, number> = {};
          room.players.forEach((player: Player) => {
            initialScores[player.id] = 0;
          });

          // Get available categories
          const allCategories: GameCategory[] = ['business', 'scenario', 'wouldYouRather', 'pleadForYourLife', 'escape'];
          
          // Find player with lowest score (for first round, randomly select)
          const randomPlayerIndex = Math.floor(Math.random() * room.players.length);
          const categorySelector = room.players[randomPlayerIndex].id;

          // Initialize the game state
          const initialGameState: GameState = {
            status: 'category-selection',
            round: 1,
            totalRounds: 5,
            scores: initialScores,
            answers: {},
            categorySelector,
            categories: allCategories,
            roundHistory: []
          };

          // Update room status to playing and set initial game state
          const updatedRoom = await Room.findOneAndUpdate(
            { code: roomCode },
            { 
              $set: { 
                status: 'playing',
                currentRound: 1,
                gameState: initialGameState
              } 
            },
            { new: true }
          );

          if (!updatedRoom) {
            console.log('Failed to update room status');
            return;
          }

          console.log(`Game started in room ${roomCode}, round 1`);
          
          // Notify all players that the game has started
          broadcastRoomUpdate(roomCode, updatedRoom);
          io.to(roomCode).emit('gameStarted', initialGameState);
        } catch (error) {
          console.error('Error in startGame handler:', error);
        }
      });

      /**
       * Select category event handler
       * When the player with the lowest score selects a category
       */
      socket.on('selectCategory', async (category: GameCategory) => {
        console.log(`Category selected: ${category}`);
        
        try {
          // Get player info from socket mapping
          const playerInfo = socketToPlayer.get(socket.id);
          if (!playerInfo) {
            console.log('No player info found for socket');
            return;
          }

          const { roomCode, playerId } = playerInfo;
          console.log(`Player ${playerId} selecting category ${category} for room ${roomCode}`);
          
          // Ensure database connection
          await connectToDatabase();
          
          // Find the room
          const room = await Room.findOne({ code: roomCode });
          if (!room) {
            console.log('Room not found:', roomCode);
            return;
          }

          // Verify game is in category selection state
          if (!room.gameState || room.gameState.status !== 'category-selection') {
            console.log(`Game is not in category selection state. Current state: ${room.gameState?.status}`);
            return;
          }

          // Verify the player is the category selector
          if (room.gameState.categorySelector !== playerId) {
            console.log(`Player ${playerId} is not the category selector. Selector is: ${room.gameState.categorySelector}`);
            return;
          }

          console.log(`Generating question for category: ${category}`);
          // Generate a question using the AI service
          const questionResult = await AIService.generateQuestion(category);
          const question = questionResult.questionText; // Use questionText instead of question
          const judgingStyle = questionResult.judgingStyle; // Use the judgingStyle from the result
          
          console.log(`Question generated: ${question}`);
          
          // Update game state to question display
          const updatedGameState: Partial<GameState> = {
            status: 'question-display',
            currentCategory: category,
            question,
            questionContext: `You will be judged on ${judgingStyle}.`, // Create context from judgingStyle
            judgingStyle, // Use the judgingStyle directly
            timeRemaining: 180, // 3 minutes (180 seconds) to answer
            answers: {}
          };

          // Update the room with the new game state
          const updatedRoom = await Room.findOneAndUpdate(
            { code: roomCode },
            { 
              $set: { 
                'gameState.status': updatedGameState.status,
                'gameState.currentCategory': updatedGameState.currentCategory,
                'gameState.question': updatedGameState.question,
                'gameState.questionContext': updatedGameState.questionContext,
                'gameState.judgingStyle': updatedGameState.judgingStyle,
                'gameState.timeRemaining': updatedGameState.timeRemaining,
                'gameState.answers': {}
              } 
            },
            { new: true }
          );

          if (!updatedRoom) {
            console.log('Failed to update game state');
            return;
          }

          console.log(`Updated room game state to ${updatedRoom.gameState.status}`);
          console.log(`Question for room ${roomCode}: ${question}`);
          
          // Notify all players of the new question
          console.log(`Broadcasting roomUpdate and questionReady events to room ${roomCode}`);
          broadcastRoomUpdate(roomCode, updatedRoom);
          io.to(roomCode).emit('questionReady', updatedRoom.gameState);
          
          // Start a timer to transition to answering state
          console.log(`Starting timer to transition to answering state (10s)`);
          setTimeout(async () => {
            try {
              // Only check room status once when timer completes
              await connectToDatabase();
              const currentRoom = await Room.findOne({ code: roomCode }, { 'gameState.status': 1 });
              
              if (!currentRoom) {
                console.log(`Room ${roomCode} not found when transitioning to answering`);
                return;
              }
              
              if (currentRoom.gameState && currentRoom.gameState.status === 'question-display') {
                console.log(`Transitioning room ${roomCode} from question-display to answering`);
                await Room.updateOne(
                  { code: roomCode },
                  { $set: { 'gameState.status': 'answering' } }
                );
                
                // Fetch full room data for the update - use getRoomWithCache to ensure we have the latest data
                // This includes the room code to prevent "unknown" room issues
                invalidateRoomCache(roomCode);
                const updatedRoom = await getRoomWithCache(roomCode, true);
                
                if (!updatedRoom) {
                  console.log(`Failed to fetch updated room ${roomCode} after status change`);
                  return;
                }
                
                console.log(`Broadcasting roomUpdate and answeringStarted events to room ${roomCode}`);
                // Use broadcastRoomUpdate to ensure the room is properly formatted with code
                await broadcastRoomUpdate(roomCode, updatedRoom);
                
                // Send the answeringStarted event
                io.to(roomCode).emit('answeringStarted');
                
                // Start the answer timer (180 seconds)
                console.log(`Starting answer timer for room ${roomCode} (180s)`);
                startAnswerTimer(roomCode, 180);
              } else {
                console.log(`Room ${roomCode} is not in question-display state, cannot transition to answering. Current state: ${currentRoom.gameState?.status}`);
              }
            } catch (error) {
              console.error(`Error transitioning to answering state: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
          }, 10000); // 10 seconds to read the question
          
        } catch (error) {
          console.error('Error in selectCategory handler:', error);
        }
      });

      /**
       * Submit answer event handler
       * When a player submits their answer to the current question
       */
      socket.on('submitAnswer', async (answer: string) => {
        // Get player info from socket mapping
        const playerInfo = socketToPlayer.get(socket.id);
        console.log(`Player ${playerInfo?.nickname || 'unknown'} submitted answer: ${answer}`);
        
        try {
          if (!playerInfo || !playerInfo.roomCode || !playerInfo.playerId) {
            socket.emit('error', 'No room or player info found');
            return;
          }

          if (!answer || answer.trim() === '') {
            socket.emit('error', 'Answer cannot be empty');
            return;
          }

          await connectToDatabase();
          const room = await Room.findOne({ code: playerInfo.roomCode });
          
          if (!room) {
            socket.emit('error', 'Room not found');
            return;
          }

          if (room.gameState.status !== 'answering') {
            socket.emit('error', 'Game is not in answering state');
            return;
          }

          // Prepare answers as a Map
          if (!room.gameState.answers) {
            // Initialize answers map if it doesn't exist
            room.gameState.answers = new Map<string, string>();
          }

          // Check if player has already submitted an answer
          if (room.gameState.answers.has(playerInfo.playerId)) {
            socket.emit('error', 'You have already submitted an answer');
            return;
          }

          // Add answer to the map (key = playerId, value = answer text)
          room.gameState.answers.set(playerInfo.playerId, answer);
          
          // Count connected players who have answered
          const connectedPlayers = room.players.filter((p: Player) => p.isConnected);
          const answers = Array.from(room.gameState.answers.keys());
          
          // Check if all connected players have answered
          const allPlayersAnswered = connectedPlayers.every((player: Player) => 
            answers.includes(player.id)
          );

          // If all players have answered, move to judging
          if (allPlayersAnswered) {
            console.log(`All players in room ${playerInfo.roomCode} have answered. Moving to judging phase.`);
            room.gameState.timeRemaining = 0; // Force time to 0 to move to judging
            room.gameState.status = 'judging';
            
            // Store answers in round history (convert answers map to object for storage)
            if (!room.gameState.roundHistory[room.gameState.round - 1]) {
              const answersObject: Record<string, string> = {};
              room.gameState.answers.forEach((value: string, key: string) => {
                answersObject[key] = value;
              });
              
              room.gameState.roundHistory[room.gameState.round - 1] = {
                question: room.gameState.question,
                category: room.gameState.currentCategory,
                answers: answersObject
              };
            }
          }
          
          // Calculate how many players have answered for the progress indicator
          const answerCount = {
            count: room.gameState.answers.size,
            total: connectedPlayers.length
          };

          await room.save();
          
          // Notify player their answer was recorded
          socket.emit('answerRecorded', playerInfo.playerId);
          
          // Update all clients about answer progress
          io.to(playerInfo.roomCode).emit('answerCountUpdate', answerCount);
          
          // Send full gameState when all have answered
          if (allPlayersAnswered) {
            io.to(playerInfo.roomCode).emit('gameState', room.gameState);
            broadcastRoomUpdate(playerInfo.roomCode, room);
          }
        } catch (error) {
          console.error('Error in submitAnswer:', error);
          socket.emit('error', 'Failed to submit answer');
        }
      });

      /**
       * Manual trigger for judging (TEMPORARY DEBUG HELPER)
       * This helps unstick rooms that are in the judging state but not progressing
       */
      socket.on('triggerJudging', async () => {
        try {
          // Get player info from socket mapping
          const playerInfo = socketToPlayer.get(socket.id);
          if (!playerInfo) {
            console.log('No player info found for socket');
            socket.emit('error', 'Not connected to a room');
            return;
          }

          console.log(`Manual judging trigger requested by ${playerInfo.nickname} for room ${playerInfo.roomCode}`);
          
          // Ensure database connection
          await connectToDatabase();
          
          // Find the room
          const room = await Room.findOne({ code: playerInfo.roomCode });
          if (!room) {
            console.log('Room not found:', playerInfo.roomCode);
            socket.emit('error', 'Room not found');
            return;
          }

          // Only proceed if in judging state
          if (!room.gameState || room.gameState.status !== 'judging') {
            console.log(`Cannot trigger judging: Room is not in judging state. Current state: ${room.gameState?.status}`);
            socket.emit('error', `Room is not in judging state. Current state: ${room.gameState?.status}`);
            return;
          }

          console.log(`Manually triggering judging process for room ${playerInfo.roomCode}`);
          
          // Call the judgeAnswers function to process the results
          await judgeAnswers(playerInfo.roomCode);
          
          socket.emit('message', 'Judging process triggered manually');
        } catch (error) {
          console.error('Error in manual judging trigger:', error);
          socket.emit('error', 'Failed to trigger judging');
        }
      });

      /**
       * Next round event handler
       * When the host advances to the next round
       */
      socket.on('nextRound', async () => {
        console.log('Next round event received');
        
        try {
          // Get player info from socket mapping
          const playerInfo = socketToPlayer.get(socket.id);
          if (!playerInfo) {
            console.log('No player info found for socket');
            return;
          }

          const { roomCode, playerId } = playerInfo;
          
          // Ensure database connection
          await connectToDatabase();
          
          // Find the room
          const room = await Room.findOne({ code: roomCode });
          if (!room) {
            console.log('Room not found:', roomCode);
            return;
          }

          // Verify the player is the host
          const hostPlayer = room.players.find((p: Player) => p.id === playerId);
          if (!hostPlayer || !hostPlayer.isHost) {
            console.log('Only the host can advance to the next round');
            return;
          }

          // Verify game is in results state
          if (!room.gameState || room.gameState.status !== 'results') {
            console.log('Game is not in results state');
            return;
          }

          // Check if this was the last round
          const currentRound = room.gameState.round || 1;
          const totalRounds = room.gameState.totalRounds || 5;
          
          if (currentRound >= totalRounds) {
            // Game is over
            const finalGameState = {
              ...room.gameState,
              status: 'game-over'
            };
            
            // Update the room with the final game state
            const updatedRoom = await Room.findOneAndUpdate(
              { code: roomCode },
              { 
                $set: { 
                  'gameState.status': 'game-over'
                } 
              },
              { new: true }
            );

            if (!updatedRoom) {
              console.log('Failed to update game state');
              return;
            }

            console.log(`Game over in room ${roomCode}`);
            
            // Notify all players that the game is over
            broadcastRoomUpdate(roomCode, updatedRoom);
            io.to(roomCode).emit('gameOver', finalGameState);
            
            return;
          }
          
          // Start the next round
          await startNextRound(roomCode, currentRound + 1);
          
        } catch (error) {
          console.error('Error in nextRound handler:', error);
        }
      });

      /**
       * Kick player event handler
       * Allows the host to remove a player from the room
       */
      socket.on('kickPlayer', async (playerIdToKick: string) => {
        console.log(`Kick player event received for player: ${playerIdToKick}`);
        
        try {
          // Get player info from socket mapping
          const playerInfo = socketToPlayer.get(socket.id);
          if (!playerInfo) {
            console.log('No player info found for socket');
            socket.emit('error', 'Not connected to a room');
            return;
          }

          const { roomCode, playerId } = playerInfo;
          
          // Ensure database connection
          await connectToDatabase();
          
          // Find the room with fresh data
          const room = await getRoomWithCache(roomCode, true); // Force fresh data
          if (!room) {
            console.log('Room not found:', roomCode);
            socket.emit('error', 'Room not found');
            return;
          }

          // Verify the requester is the host
          const hostPlayer = room.players.find((p: Player) => p.id === playerId);
          if (!hostPlayer || !hostPlayer.isHost) {
            console.log('Only the host can kick players');
            socket.emit('error', 'Only the host can remove players');
            return;
          }

          // Find the player to kick
          const playerToKick = room.players.find((p: Player) => p.id === playerIdToKick);
          if (!playerToKick) {
            console.log('Player to kick not found');
            socket.emit('error', 'Player not found or already left the room');
            return;
          }

          if (playerToKick.isHost) {
            console.log('Cannot kick the host');
            socket.emit('error', 'Cannot remove the host from the room');
            return;
          }

          // Capture player name for logging
          const playerNickname = playerToKick.nickname;
          console.log(`Kicking player ${playerNickname} (${playerIdToKick}) from room ${roomCode}`);

          // CRITICAL FIX: Use findOneAndUpdate to atomically remove the player
          // This is more reliable than the previous update operation
          const updatedRoomDoc = await Room.findOneAndUpdate(
            { code: roomCode },
            { $pull: { players: { id: playerIdToKick } } },
            { new: true } // Return the updated document
          );
          
          if (!updatedRoomDoc) {
            console.log('Failed to update room when kicking player');
            socket.emit('error', 'Failed to remove player from room');
            return;
          }
          
          // Double-check player was actually removed
          const playerStillExists = updatedRoomDoc.players.some((p: Player) => p.id === playerIdToKick);
          if (playerStillExists) {
            console.error(`Failed to remove player ${playerIdToKick} from room ${roomCode}`);
            console.log('Current players in room:', updatedRoomDoc.players);
            socket.emit('error', 'Failed to remove player, please try again');
            return;
          }
          
          console.log(`Successfully removed player ${playerNickname} from database. Remaining players: ${updatedRoomDoc.players.length}`);

          // Find all sockets for the kicked player
          console.log(`Looking for all socket connections for player ${playerIdToKick}`);
          let kickedPlayerSocketIds: string[] = [];

          for (const [socketId, info] of socketToPlayer.entries()) {
            if (info.playerId === playerIdToKick) {
              kickedPlayerSocketIds.push(socketId);
            }
          }

          console.log(`Found ${kickedPlayerSocketIds.length} socket(s) for the kicked player`);

          // Notify and disconnect all sockets for the kicked player
          for (const kickedSocketId of kickedPlayerSocketIds) {
            const kickedSocket = io.sockets.sockets.get(kickedSocketId);
            if (kickedSocket) {
              console.log(`Processing kick for socket ${kickedSocketId}`);
              
              // Completely disable reconnection before sending any events
              // This must be the FIRST thing we send to ensure it's processed before disconnect
              kickedSocket.emit('forceDisconnect', {
                message: 'You have been kicked from the room',
                roomCode: roomCode
              });
              
              // Send additional events for backward compatibility
              kickedSocket.emit('clearRoomStorage', { roomCode });
              kickedSocket.emit('kicked', 'You have been kicked from the room');
              
              // Clean up socket mapping
              socketToPlayer.delete(kickedSocketId);
              kickedSocket.leave(roomCode);
              
              // Force disconnect - important: we're forcing a server disconnect which
              // the client should NOT attempt to auto-reconnect from
              try {
                console.log(`Disconnecting kicked socket ${kickedSocketId}`);
                kickedSocket.disconnect(true);  // true = server disconnect
              } catch (err) {
                console.error(`Error disconnecting socket ${kickedSocketId}:`, err);
              }
            }
          }

          // Invalidate cache after updating the room
          invalidateRoomCache(roomCode);
          
          // Notify remaining players with formatted room data
          await broadcastRoomUpdate(roomCode, updatedRoomDoc);
          console.log(`Room update sent after player ${playerNickname} kicked. Remaining players: ${updatedRoomDoc.players.length}`);
          
          // Log all sockets in the room to verify updates are going to the right places
          logSocketsInRoom(roomCode);
        } catch (error) {
          console.error('Error in kickPlayer handler:', error);
          socket.emit('error', 'Server error when removing player');
        }
      });

      /**
       * Socket disconnect handler
       * !!!IMPORTANT!!! - Only marks players as disconnected and NEVER removes them automatically
       */
      socket.on('disconnect', async () => {
        console.log(`Socket disconnected: ${socket.id}`);
        const playerInfo = socketToPlayer.get(socket.id);
        
        if (playerInfo) {
          console.log(`=== KEEPING PLAYER ${playerInfo.nickname} IN ROOM - MARKING DISCONNECTED ONLY ===`);
          console.log(`Player disconnected: ${playerInfo.nickname} (${playerInfo.playerId}) from room ${playerInfo.roomCode}`);
          
          try {
            // Ensure database connection
            await connectToDatabase();
            
            // Force a fresh room fetch to get the latest state
            const room = await getRoomWithCache(playerInfo.roomCode, true);
            if (!room) {
              console.log(`Room ${playerInfo.roomCode} not found during disconnect`);
              socketToPlayer.delete(socket.id);
              return;
            }
            
            // Check if the player is in the room
            const disconnectingPlayer = room.players.find((p: Player) => p.id === playerInfo.playerId);
            if (!disconnectingPlayer) {
              console.log(`Player ${playerInfo.playerId} already removed from room ${playerInfo.roomCode}`);
              socketToPlayer.delete(socket.id);
              return;
            }
            
            const playerNickname = disconnectingPlayer.nickname;

            // ONLY mark the player as disconnected - NEVER remove them automatically
            console.log(`=== KEEPING PLAYER ${playerNickname} IN ROOM - MARKING DISCONNECTED ONLY ===`);
            await Room.updateOne(
              { code: playerInfo.roomCode, "players.id": playerInfo.playerId },
              { $set: { "players.$.isConnected": false } }
            );
            
            // Update clients about the disconnected status
            const updatedRoom = await Room.findOne({ code: playerInfo.roomCode });
            if (updatedRoom) {
              await broadcastRoomUpdate(playerInfo.roomCode, updatedRoom);
              console.log(`Room update sent to mark ${playerNickname} as disconnected (player remains in room indefinitely)`);
              logSocketsInRoom(playerInfo.roomCode);
            }
            
            // Clean up socket tracking
            socketToPlayer.delete(socket.id);
            socket.leave(playerInfo.roomCode);
            
            // No automatic removal under any circumstances
            console.log(`=== DISCONNECT COMPLETE - PLAYER ${playerNickname} REMAINS IN ROOM ===`);
            
          } catch (error) {
            console.error('Error handling disconnect:', error);
            socketToPlayer.delete(socket.id);
          }
        }
      });
    });

    /**
     * Helper functions for game logic
     */

    /**
     * Start the answer timer
     */
    const startAnswerTimer = async (roomCode: string, duration: number) => {
      console.log(`=== STARTING ANSWER TIMER FOR ROOM ${roomCode} (${duration}s) ===`);
      
      try {
        // Initialize timer in room - only connect to database once at the start
        await connectToDatabase();
        
        const room = await getRoomWithCache(roomCode, true); // Force fresh data to get complete room
        if (!room || !room.gameState) {
          console.log(`Cannot start timer: Room ${roomCode} not found or has no game state`);
          return;
        }
        
        if (room.gameState.status !== 'answering') {
          console.log(`Cannot start timer: Room ${roomCode} is not in answering state (current: ${room.gameState.status})`);
          return;
        }
        
        // Set initial time - store in memory, not in database
        const initialTime = duration;
        console.log(`Timer initialized for room ${roomCode}: ${initialTime}s`);
        io.to(roomCode).emit('timerUpdate', initialTime);
        
        // Store vital room information to avoid querying the database on every tick
        // This prevents room code from being lost during timer operation
        const roomDetails = {
          code: room.code,
          currentRound: room.currentRound || 0
        };
        
        // Game state tracking variables - store in memory to avoid DB checks
        let timeRemaining = initialTime;
        let lastDbCheckTime = Date.now();
        let gameStatus = 'answering';
        const DB_CHECK_INTERVAL = 15000; // Check database every 15 seconds
        
        const timer = setInterval(async () => {
          try {
            // Only check the database periodically (every 15 seconds) instead of every tick
            const currentTime = Date.now();
            if (currentTime - lastDbCheckTime >= DB_CHECK_INTERVAL) {
              console.log(`Periodic DB check for room ${roomDetails.code} (every 15s)`);
              lastDbCheckTime = currentTime;
              
              // Ensure database connection for periodic check
              await connectToDatabase();
              const currentRoom = await Room.findOne({ code: roomDetails.code });
              
              if (!currentRoom || !currentRoom.gameState) {
                console.log(`Timer stopped: Room ${roomDetails.code} no longer exists`);
                clearInterval(timer);
                return;
              }
              
              // Update our cached game status
              gameStatus = currentRoom.gameState.status;
              
              // If the game is no longer in answering state, stop the timer
              if (gameStatus !== 'answering') {
                console.log(`Timer stopped: Room ${roomDetails.code} changed state to ${gameStatus}`);
                clearInterval(timer);
                return;
              }
            }
            
            // If game status changed through other events, stop the timer
            if (gameStatus !== 'answering') {
              console.log(`Timer stopped: Game status changed to ${gameStatus}`);
              clearInterval(timer);
              return;
            }
            
            // Decrement time in memory
            timeRemaining--;
            
            // Only log every 15 seconds or when timer reaches zero
            if (timeRemaining === 0 || timeRemaining % 15 === 0 || timeRemaining === initialTime - 1) {
              console.log(`Room ${roomDetails.code} timer: ${timeRemaining}s remaining`);
            }
            
            // Handle timer completion
            if (timeRemaining <= 0) {
              clearInterval(timer);
              timeRemaining = 0;
              console.log(`=== TIMER REACHED ZERO FOR ROOM ${roomDetails.code} ===`);
              
              // Emit the final update
              io.to(roomDetails.code).emit('timerUpdate', timeRemaining);
              
              // Automatically move to judging when time is up
              console.log(`Starting judging process for room ${roomDetails.code}`);
              await judgeAnswers(roomDetails.code);
              return;
            }
            
            // Emit time update every second without updating database
            io.to(roomDetails.code).emit('timerUpdate', timeRemaining);
          } catch (error) {
            console.error(`Error updating timer for room ${roomDetails.code}:`, error instanceof Error ? error.message : 'Unknown error');
            // Don't clear the interval here - try again on next tick
          }
        }, 1000);
      } catch (error) {
        console.error(`Error starting timer for room ${roomCode}:`, error instanceof Error ? error.message : 'Unknown error');
      }
    };

    /**
     * Judge the answers and update scores
     */
    async function judgeAnswers(roomCode: string) {
      const startTime = Date.now();
      console.log(`[judgeAnswers] STARTED at ${new Date().toISOString()} for room ${roomCode}`);
      
      try {
        console.log(`[judgeAnswers] Starting judging process for room ${roomCode}`);
        
        // Find the room - only fetch necessary fields
        await connectToDatabase(); // Ensure DB connection
        console.log(`[judgeAnswers] DB connection established at +${Date.now() - startTime}ms`);
        
        const room = await Room.findOne(
          { code: roomCode },
          {
            'gameState.status': 1,
            'gameState.currentCategory': 1,
            'gameState.judgingStyle': 1,
            'gameState.question': 1,
            'gameState.answers': 1,
            'gameState.scores': 1,
            'gameState.round': 1,
            'gameState.roundHistory': 1,
            'players': 1
          }
        );
        console.log(`[judgeAnswers] Room query completed at +${Date.now() - startTime}ms`);
        
        if (!room || !room.gameState) {
          console.log('[judgeAnswers] Room not found or game state missing');
          return;
        }
        
        console.log(`[judgeAnswers] Room found, current status: ${room.gameState.status}`);
        console.log(`[judgeAnswers] Room has ${room.players.length} players, ${room.players.filter((p: Player) => p.isConnected).length} connected`);
        
        // Update status to judging - single database operation
        console.log(`[judgeAnswers] Updating status to 'judging' at +${Date.now() - startTime}ms`);
        await Room.updateOne(
          { code: roomCode },
          { $set: { 'gameState.status': 'judging' } }
        );
        
        console.log(`[judgeAnswers] Updated room status to 'judging' at +${Date.now() - startTime}ms`);
        
        // We don't need to fetch the room again, just use what we have
        const gameStateUpdate = { ...room.gameState.toObject(), status: 'judging' };
        io.to(roomCode).emit('roomUpdate', formatRoomForClient({ ...room.toObject(), gameState: gameStateUpdate }));
        io.to(roomCode).emit('judgingStarted');
        
        console.log(`[judgeAnswers] Notified all players that judging has started at +${Date.now() - startTime}ms`);
        
        // Get the answers, category, and question - convert to plain JS objects to avoid Mongoose issues
        const gameState = room.gameState;
        const category = gameState.currentCategory as GameCategory;
        const judgingStyle = gameState.judgingStyle as JudgingStyle;
        const question = gameState.question || '';
        
        // Convert Mongoose Map to plain object and ensuring no internal properties
        let answersObj: Record<string, string> = {};
        
        console.log(`[judgeAnswers] Processing answers object at +${Date.now() - startTime}ms`);
        console.log(`[judgeAnswers] Answer type: ${typeof gameState.answers}, isMap: ${gameState.answers instanceof Map}`);
        
        // Handle different types of answer objects properly
        if (gameState.answers) {
          if (gameState.answers instanceof Map) {
            // Standard Map
            console.log(`[judgeAnswers] Processing answers as Map`);
            answersObj = Object.fromEntries(gameState.answers);
          } else if (typeof gameState.answers.toJSON === 'function') {
            // Mongoose document with toJSON
            console.log(`[judgeAnswers] Processing answers using toJSON()`);
            const jsonObj = gameState.answers.toJSON();
            Object.keys(jsonObj).forEach(key => {
              if (!key.startsWith('$')) { // Skip Mongoose internal keys
                answersObj[key] = jsonObj[key];
              }
            });
          } else if (typeof gameState.answers === 'object') {
            // Plain object or Mongoose object without toJSON
            console.log(`[judgeAnswers] Processing answers as plain object`);
            Object.keys(gameState.answers).forEach(key => {
              if (!key.startsWith('$')) { // Skip Mongoose internal keys
                answersObj[key] = gameState.answers[key];
              }
            });
          }
        }
        
        console.log(`[judgeAnswers] Answers to judge:`, answersObj);
        console.log(`[judgeAnswers] Category: ${category}, Style: ${judgingStyle}`);
        console.log(`[judgeAnswers] Question: ${question}`);
        
        // Use AI to judge the answers
        console.log(`[judgeAnswers] Sending request to AI service for judging at +${Date.now() - startTime}ms`);
        let judgingResult;
        try {
          judgingResult = await AIService.judgeAnswers(
            category,
            judgingStyle,
            question,
            answersObj
          );
          console.log(`[judgeAnswers] AI judgment received at +${Date.now() - startTime}ms:`, judgingResult);
        } catch (aiError) {
          console.error(`[judgeAnswers] Error from AI service at +${Date.now() - startTime}ms:`, aiError instanceof Error ? aiError.message : 'Unknown error');
          // We'll handle this in the fallback mechanism below
        }
        
        // Fallback mechanism - select random winner if AI service failed or returned no winners
        if (!judgingResult || !judgingResult.winners || judgingResult.winners.length === 0) {
          console.log(`[judgeAnswers] WARNING: No winners returned by AI, selecting random winner at +${Date.now() - startTime}ms`);
          
          // Select a random winner if we have answers
          if (Object.keys(answersObj).length > 0) {
            const randomPlayer = Object.keys(answersObj)[Math.floor(Math.random() * Object.keys(answersObj).length)];
            judgingResult = {
              winners: [randomPlayer],
              explanation: "The AI judge is currently on break, so a random winner was selected."
            };
            console.log(`[judgeAnswers] Selected random winner: ${randomPlayer}`);
          } else {
            judgingResult = {
              winners: [],
              explanation: "No answers were submitted, so no winner was selected."
            };
            console.log(`[judgeAnswers] No answers to judge`);
          }
        }

        console.log(`[judgeAnswers] Winners:`, judgingResult.winners);
        
        // Process scores - convert to plain object to avoid Mongoose issues
        console.log(`[judgeAnswers] Processing scores object at +${Date.now() - startTime}ms`);
        let scoreObj: Record<string, number> = {};
        
        // Convert the scores to a safe format we can modify
        if (gameState.scores) {
          console.log(`[judgeAnswers] Converting scores using JSON.stringify/parse`);
          scoreObj = JSON.parse(JSON.stringify(gameState.scores));
        }
        
        console.log(`[judgeAnswers] Scores processed at +${Date.now() - startTime}ms:`, scoreObj);
        
        // Award points to winners (3 points per winner)
        judgingResult.winners.forEach(winnerId => {
          // Initialize score if not exists
          if (!scoreObj[winnerId]) {
            scoreObj[winnerId] = 0;
          }
          
          // Add 3 points
          scoreObj[winnerId] += 3;
          console.log(`[judgeAnswers] Awarded 3 points to player ${winnerId}`);
        });
        
        // Process round history
        console.log(`[judgeAnswers] Processing round history at +${Date.now() - startTime}ms`);
        const currentRound = gameState.round;
        
        // Add this round to history if not already there
        let roundHistory = gameState.roundHistory || [];
        if (!roundHistory[currentRound - 1]) {
          roundHistory[currentRound - 1] = {
            round: currentRound,
            category: category,
            question: question,
            answers: answersObj,
            winners: judgingResult.winners,
            explanation: judgingResult.explanation
          };
          
          console.log(`[judgeAnswers] Added round to history. Total rounds in history: ${roundHistory.length}`);
        }
        
        // Update everything in one database operation
        console.log(`[judgeAnswers] Updating game state with results at +${Date.now() - startTime}ms`);
        await Room.updateOne(
          { code: roomCode },
          { 
            $set: { 
              'gameState.status': 'results',
              'gameState.judgingResult': {
                winners: judgingResult.winners,
                explanation: judgingResult.explanation
              },
              'gameState.scores': scoreObj,
              'gameState.roundHistory': roundHistory
            }
          }
        );
        
        console.log(`[judgeAnswers] Game state updated at +${Date.now() - startTime}ms`);
        
        // Fetch final updated room
        const finalRoom = await Room.findOne({ code: roomCode });
        console.log(`[judgeAnswers] Final room status: ${finalRoom?.gameState?.status}`);
        
        // Notify all players
        console.log(`[judgeAnswers] Emitting final roomUpdate to all players at +${Date.now() - startTime}ms`);
        broadcastRoomUpdate(roomCode, finalRoom);
        
        console.log(`[judgeAnswers] Emitting judgingComplete event to all players at +${Date.now() - startTime}ms`);
        io.to(roomCode).emit('judgingComplete', judgingResult);
        
        console.log(`[judgeAnswers] Judging process complete for room ${roomCode} at +${Date.now() - startTime}ms`);
      } catch (error) {
        console.error(`[judgeAnswers] Error in judging process:`, error instanceof Error ? error.message : 'Unknown error');
      }
      
      console.log(`[judgeAnswers] FUNCTION ENDED at ${new Date().toISOString()} (total: ${Date.now() - startTime}ms)`);
    }

    /**
     * Helper function to transfer host status to the next connected player
     */
    async function transferHostStatus(roomCode: string) {
      console.log(`Transferring host status in room ${roomCode}`);
      try {
        const room = await Room.findOne({ code: roomCode });
        if (!room || room.players.length === 0) {
          console.log('No players left to transfer host status to');
          return false;
        }

        // Find the first connected player to make host
        const nextHostIndex = room.players.findIndex((p: Player) => p.isConnected);
        if (nextHostIndex === -1) {
          console.log('No connected players found to transfer host status to');
          return false;
        }

        console.log(`Transferring host status to player: ${room.players[nextHostIndex].nickname}`);
        
        // Update the new host in the database
        const newHostRoom = await Room.findOneAndUpdate(
          { code: roomCode },
          { $set: { [`players.${nextHostIndex}.isHost`]: true } },
          { new: true }
        );

        if (newHostRoom) {
          console.log(`New host assigned: ${newHostRoom.players[nextHostIndex].nickname}`);
          
          // Broadcast room update to all players
          broadcastRoomUpdate(roomCode, newHostRoom);
          
          return true;
        }
        return false;
      } catch (error) {
        console.error('Error transferring host status:', error);
        return false;
      }
    }

    // Helper function to schedule room deletion after inactivity
    function scheduleRoomDeletion(roomCode: string) {
      // Clear any existing timeout for this room
      if (pendingRoomDeletions.has(roomCode)) {
        clearTimeout(pendingRoomDeletions.get(roomCode)!);
        pendingRoomDeletions.delete(roomCode);
      }
      
      console.log(`Scheduling room ${roomCode} for deletion in ${ROOM_DELETION_DELAY/1000/60} minutes due to inactivity`);
      
      // Notify any remaining socket connections about room inactivity
      // This helps clients know the room is temporarily inactive but will persist
      io.to(roomCode).emit('roomInactive', {
        message: 'Room is temporarily inactive. It will be available for the next 5 minutes if anyone wants to rejoin.',
        roomCode: roomCode
      });
      
      // Set a new timeout
      const timeoutId = setTimeout(async () => {
        try {
          console.log(`Deleting inactive room ${roomCode} after timeout`);
          
          // Double-check the room is still empty before deleting
          const room = await Room.findOne({ code: roomCode });
          if (room && room.players.length === 0) {
            await Room.deleteOne({ code: roomCode });
            console.log(`Room ${roomCode} deleted after inactivity timeout`);
            
            // Send final room ended notification
            io.to(roomCode).emit('roomEnded', 'Room has been closed due to inactivity');
          } else if (room) {
            console.log(`Room ${roomCode} has players again, cancelling deletion`);
          } else {
            console.log(`Room ${roomCode} already deleted`);
          }
          
          // Clean up the pending deletion
          pendingRoomDeletions.delete(roomCode);
          
        } catch (error) {
          console.error(`Error deleting inactive room ${roomCode}:`, error);
        }
      }, ROOM_DELETION_DELAY);
      
      // Store the timeout ID
      pendingRoomDeletions.set(roomCode, timeoutId);
    }

    // Helper function to cancel room deletion if players rejoin
    function cancelRoomDeletion(roomCode: string) {
      if (pendingRoomDeletions.has(roomCode)) {
        console.log(`Cancelling scheduled deletion for room ${roomCode}`);
        clearTimeout(pendingRoomDeletions.get(roomCode)!);
        pendingRoomDeletions.delete(roomCode);
      }
    }

    // Helper function to start the next round
    async function startNextRound(roomCode: string, roundNumber: number) {
      try {
        // Find the room
        const room = await Room.findOne({ code: roomCode });
        if (!room || !room.gameState) {
          console.log('Room not found or game state missing');
          return;
        }
        
        // Find player with lowest score to select the next category
        const scores = room.gameState.scores || {};
        let lowestScore = Infinity;
        let lowestScorePlayer = '';
        
        Object.entries(scores).forEach(([playerId, score]) => {
          const numericScore = Number(score);
          if (numericScore < lowestScore) {
            lowestScore = numericScore;
            lowestScorePlayer = playerId;
          }
        });
        
        // If somehow there's no lowest (all equal), pick a random player
        if (!lowestScorePlayer && room.players.length > 0) {
          const randomIndex = Math.floor(Math.random() * room.players.length);
          lowestScorePlayer = room.players[randomIndex].id;
        }
        
        // Get available categories
        const allCategories: GameCategory[] = ['business', 'scenario', 'wouldYouRather', 'pleadForYourLife', 'escape'];
        const usedCategories = room.gameState.roundHistory.map((h: RoundHistoryItem) => h.category);
        
        // Filter out categories already used, or use all categories if none available
        let availableCategories = allCategories.filter(c => !usedCategories.includes(c));
        if (availableCategories.length === 0) {
          availableCategories = allCategories;
        }
        
        // Update the game state for the next round
        const updatedGameState: Partial<GameState> = {
          status: 'category-selection',
          round: roundNumber,
          categorySelector: lowestScorePlayer,
          categories: availableCategories,
          answers: {}
        };
        
        // Update the room with the new game state
        const updatedRoom = await Room.findOneAndUpdate(
          { code: roomCode },
          { 
            $set: { 
              currentRound: roundNumber,
              'gameState.status': updatedGameState.status,
              'gameState.round': updatedGameState.round,
              'gameState.categorySelector': updatedGameState.categorySelector,
              'gameState.categories': updatedGameState.categories,
              'gameState.answers': {}
            } 
          },
          { new: true }
        );
        
        if (!updatedRoom) {
          console.log('Failed to update game state for next round');
          return;
        }
        
        console.log(`Round ${roundNumber} started in room ${roomCode}`);
        
        // Notify all players about the new round
        broadcastRoomUpdate(roomCode, updatedRoom);
        io.to(roomCode).emit('roundStarted', updatedRoom.gameState);
        
      } catch (error) {
        console.error('Error starting next round:', error);
      }
    }

    // Start the server on the specified port
    const serverInstance = server.listen(3000, () => {
      console.log('> Ready on http://localhost:3000');
    });

    // Handle graceful shutdown
    const gracefulShutdown = (signal: string) => {
      console.log(`\n${signal} received. Gracefully shutting down...`);
      
      // First close the HTTP server
      serverInstance.close(() => {
        console.log('HTTP server closed.');
        
        // Close all socket connections
        io.close(() => {
          console.log('Socket.IO connections closed.');
          
          // Close MongoDB connection
          mongoose.connection.close(false)
            .then(() => {
              console.log('MongoDB connection closed gracefully.');
              process.exit(0);
            })
            .catch(err => {
              console.error('Error closing MongoDB connection:', err);
              process.exit(1);
            });
        });
      });
      
      // Set a timeout for forceful exit if graceful shutdown takes too long
      setTimeout(() => {
        console.error('Forceful shutdown after timeout!');
        process.exit(1);
      }, 10000); // 10 seconds timeout
    };
    
    // Listen for termination signals
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));
    
    // Handle uncaught exceptions and rejections
    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error);
      gracefulShutdown('uncaughtException');
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
      // Don't shutdown for unhandled rejections, just log them
    });
  })
  .catch(err => {
    clearTimeout(nextJsTimeout);
    console.error('Error preparing Next.js app:', err);
    process.exit(1);
  }); 