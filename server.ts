import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { Server as SocketIOServer } from 'socket.io';
import { connectToDatabase } from './lib/mongodb';
import { Room } from './models/Room';
import dotenv from 'dotenv';
import { AIService } from './lib/ai/aiService';
import { GameCategory, JudgingStyle, GameState } from './types/gameState';

// Load environment variables
dotenv.config({ path: '.env.local' });

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

app.prepare().then(() => {
  console.log('Next.js app prepared');
  
  // Create HTTP server
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
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
    }
    
    /**
     * Join room event handler
     * Adds a player to a room and broadcasts the update to all players
     */
    socket.on('joinRoom', async (roomCode: string, playerId: string, nickname: string) => {
      console.log(`Join room: ${roomCode}, Player: ${nickname} (${playerId})`);
      
      try {
        // Ensure database connection
        await connectToDatabase();
        
        // Find the room with a fresh query to get the latest state
        const room = await Room.findOne({ code: roomCode });
        if (!room) {
          console.log('Room not found:', roomCode);
          socket.emit('error', 'Room not found');
          return;
        }

        // Check if player is already in the room by ID (handles reconnections)
        const existingPlayerById = room.players.find((p: Player) => p.id === playerId);
        if (existingPlayerById) {
          console.log(`Player ${nickname} already in room ${roomCode} by ID, marking as connected`);
          
          // Update their connection status
          await Room.updateOne(
            { code: roomCode, 'players.id': playerId },
            { $set: { 'players.$.isConnected': true } }
          );
          
          // Join the socket to the room
          socket.join(roomCode);
          socketToPlayer.set(socket.id, { playerId, roomCode, nickname });
          
          // Get the updated room
          const updatedRoom = await Room.findOne({ code: roomCode });
          if (!updatedRoom) {
            console.log('Failed to get updated room');
            return;
          }
          
          // Send room update to the reconnecting player first
          socket.emit('roomUpdate', updatedRoom);
          
          // If the game is in answering state, also send current time
          if (updatedRoom.gameState && updatedRoom.gameState.status === 'answering' && 
              updatedRoom.gameState.timeRemaining) {
            console.log(`Sending current time to reconnected player: ${updatedRoom.gameState.timeRemaining}s`);
            socket.emit('timeUpdate', updatedRoom.gameState.timeRemaining);
          }
          
          // Then to all other players
          socket.to(roomCode).emit('roomUpdate', updatedRoom);
          console.log(`Room update sent for reconnected player ${nickname}`);
          return;
        }
        
        // Check for duplicate nickname
        const existingPlayerByNickname = room.players.find(
          (p: Player) => p.nickname.toLowerCase() === nickname.toLowerCase() && p.id !== playerId
        );
        if (existingPlayerByNickname) {
          console.log(`Nickname ${nickname} already taken in room ${roomCode}`);
          socket.emit('error', 'This nickname is already taken in this room');
          return;
        }

        // Add new player to room
        const shouldBeHost = room.players.length === 0;
        console.log(`Adding player ${nickname} to room ${roomCode}, host: ${shouldBeHost}`);
        
        const updatedRoom = await Room.findOneAndUpdate(
          { code: roomCode },
          {
            $push: {
              players: {
                id: playerId,
                nickname,
                isHost: shouldBeHost,
                isConnected: true
              }
            }
          },
          { new: true }
        );

        if (!updatedRoom) {
          console.log('Failed to update room:', { roomCode, playerId });
          socket.emit('error', 'Failed to join room');
          return;
        }

        // Store player info in socket mapping
        socket.join(roomCode);
        socketToPlayer.set(socket.id, { playerId, roomCode, nickname });

        // Log the updated player count
        console.log(`Room ${roomCode} updated: ${updatedRoom.players.length} players`);

        // Notify all players in the room
        io.to(roomCode).emit('roomUpdate', updatedRoom);
        console.log('Room update emitted to all players');
        
        // If the game is in answering state, also send current time to the new player
        if (updatedRoom.gameState && updatedRoom.gameState.status === 'answering' && 
            updatedRoom.gameState.timeRemaining) {
          console.log(`Sending current time to new player: ${updatedRoom.gameState.timeRemaining}s`);
          socket.emit('timeUpdate', updatedRoom.gameState.timeRemaining);
        }
      } catch (error) {
        console.error('Error in joinRoom handler:', error);
        socket.emit('error', 'Server error when joining room');
      }
    });

    /**
     * Leave room event handler
     * Removes a player from a room, reassigns host if needed, and broadcasts the update
     */
    socket.on('leaveRoom', async (roomCode: string) => {
      console.log(`Leave room event: ${roomCode}, Socket: ${socket.id}`);
      
      try {
        // Get player info from socket mapping
        const playerInfo = socketToPlayer.get(socket.id);
        if (!playerInfo) {
          console.log('No player info found for socket');
          return;
        }

        // Ensure database connection
        await connectToDatabase();
        
        // Find the room to verify the player exists
        const room = await Room.findOne({ code: roomCode });
        if (!room) {
          console.log('Room not found:', roomCode);
          return;
        }

        // Find the leaving player
        const leavingPlayer = room.players.find((p: Player) => p.id === playerInfo.playerId);
        if (!leavingPlayer) {
          console.log('Player not found in room');
          return;
        }

        console.log(`${leavingPlayer.nickname} is leaving room ${roomCode}`);
        const wasHost = leavingPlayer.isHost;

        // Remove the player from the room
        const updatedRoom = await Room.findOneAndUpdate(
          { code: roomCode },
          {
            $pull: { players: { id: playerInfo.playerId } }
          },
          { new: true }
        );

        if (!updatedRoom) {
          console.log('Failed to update room');
          return;
        }

        // If the leaving player was the host and there are other players, assign a new host
        if (wasHost && updatedRoom.players.length > 0) {
          const newHostRoom = await Room.findOneAndUpdate(
            { code: roomCode },
            {
              $set: { 'players.0.isHost': true }
            },
            { new: true }
          );

          if (newHostRoom) {
            console.log(`New host assigned: ${newHostRoom.players[0].nickname}`);
            
            // Use the updated room with the new host
            updatedRoom.players[0].isHost = true;
          }
        }

        if (updatedRoom.players.length === 0) {
          // If no players left, delete the room
          await Room.deleteOne({ code: roomCode });
          console.log(`Room ${roomCode} deleted (no players remaining)`);
          io.to(roomCode).emit('roomEnded', 'Room has been closed');
        } else {
          // Notify remaining players
          io.to(roomCode).emit('roomUpdate', updatedRoom);
          console.log(`Room update sent to ${updatedRoom.players.length} remaining players`);
        }
      } catch (error) {
        console.error('Error in leaveRoom handler:', error);
      } finally {
        // Clean up socket connection
        socketToPlayer.delete(socket.id);
        socket.leave(roomCode);
        socket.disconnect();
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
        io.to(roomCode).emit('roomUpdate', updatedRoom);
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
          console.log('Game is not in category selection state');
          return;
        }

        // Verify the player is the category selector
        if (room.gameState.categorySelector !== playerId) {
          console.log('Only the category selector can select a category');
          return;
        }

        // Generate a question using the AI service
        const { question, context } = await AIService.generateQuestion(category);
        
        // Update game state to question display
        const updatedGameState: Partial<GameState> = {
          status: 'question-display',
          currentCategory: category,
          question,
          questionContext: context,
          judgingStyle: AIService.getRandomJudgingStyle(),
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

        console.log(`Question generated for room ${roomCode}: ${question}`);
        
        // Notify all players of the new question
        io.to(roomCode).emit('roomUpdate', updatedRoom);
        io.to(roomCode).emit('questionReady', updatedRoom.gameState);
        
        // Start a timer to transition to answering state
        setTimeout(async () => {
          const currentRoom = await Room.findOne({ code: roomCode });
          if (currentRoom && currentRoom.gameState && currentRoom.gameState.status === 'question-display') {
            await Room.updateOne(
              { code: roomCode },
              { $set: { 'gameState.status': 'answering' } }
            );
            
            const updatedRoom = await Room.findOne({ code: roomCode });
            io.to(roomCode).emit('roomUpdate', updatedRoom);
            io.to(roomCode).emit('answeringStarted');
            
            // Start the answer timer (180 seconds)
            startAnswerTimer(roomCode, 180);
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
      console.log(`Answer submitted`);
      
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

        // Verify game is in answering state
        if (!room.gameState || room.gameState.status !== 'answering') {
          console.log('Game is not in answering state');
          return;
        }

        // Prepare the update operation using dot notation for the specific player's answer
        const updateOperation: Record<string, string> = {};
        updateOperation[`gameState.answers.${playerId}`] = answer;

        // Record the player's answer
        const updatedRoom = await Room.findOneAndUpdate(
          { code: roomCode },
          { $set: updateOperation },
          { new: true }
        );

        if (!updatedRoom) {
          console.log('Failed to record answer');
          return;
        }

        // Notify the player that their answer was recorded
        socket.emit('answerRecorded', playerId);
        
        // Notify all players of how many answers have been submitted
        const totalAnswers = Object.keys(updatedRoom.gameState.answers || {}).length;
        io.to(roomCode).emit('answerCountUpdate', {
          count: totalAnswers,
          total: updatedRoom.players.length
        });
        
        // Check if all players have answered
        if (totalAnswers === updatedRoom.players.length) {
          // Move to judging state immediately
          await judgeAnswers(roomCode);
        }
        
      } catch (error) {
        console.error('Error in submitAnswer handler:', error);
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
          io.to(roomCode).emit('roomUpdate', updatedRoom);
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

        // Verify the requester is the host
        const hostPlayer = room.players.find((p: Player) => p.id === playerId);
        if (!hostPlayer || !hostPlayer.isHost) {
          console.log('Only the host can kick players');
          return;
        }

        // Find the player to kick
        const playerToKick = room.players.find((p: Player) => p.id === playerIdToKick);
        if (!playerToKick) {
          console.log('Player to kick not found');
          return;
        }

        if (playerToKick.isHost) {
          console.log('Cannot kick the host');
          return;
        }

        console.log(`Kicking player ${playerToKick.nickname} from room ${roomCode}`);

        // Remove the player from the room
        const updatedRoom = await Room.findOneAndUpdate(
          { code: roomCode },
          {
            $pull: { players: { id: playerIdToKick } }
          },
          { new: true }
        );

        if (!updatedRoom) {
          console.log('Failed to update room');
          return;
        }

        // Find the socket for the kicked player
        let kickedPlayerSocketId: string | undefined;
        for (const [socketId, info] of socketToPlayer.entries()) {
          if (info.playerId === playerIdToKick) {
            kickedPlayerSocketId = socketId;
            break;
          }
        }

        // Notify the kicked player
        if (kickedPlayerSocketId) {
          const kickedSocket = io.sockets.sockets.get(kickedPlayerSocketId);
          if (kickedSocket) {
            // Send kicked event to the player being removed
            kickedSocket.emit('kicked', 'You have been kicked from the room');
            
            // Clean up socket mapping and disconnect
            socketToPlayer.delete(kickedPlayerSocketId);
            kickedSocket.leave(roomCode);
            kickedSocket.disconnect();
          }
        }

        // Notify remaining players
        io.to(roomCode).emit('roomUpdate', updatedRoom);
        console.log(`Room update sent after player kicked. Remaining players: ${updatedRoom.players.length}`);
      } catch (error) {
        console.error('Error in kickPlayer handler:', error);
      }
    });

    /**
     * Socket disconnect handler
     * Cleans up player info when a socket disconnects
     */
    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
      const playerInfo = socketToPlayer.get(socket.id);
      if (playerInfo) {
        console.log(`Cleaning up player: ${playerInfo.nickname}`);
        socketToPlayer.delete(socket.id);
      }
    });
  });

  // Start the server
  server.listen(3000, () => {
    console.log('> Ready on http://localhost:3000');
  });
});

/**
 * Helper functions for game logic
 */

/**
 * Start the answer timer
 */
const startAnswerTimer = async (roomCode: string, duration: number) => {
  try {
    // Initialize timer in room
    const room = await Room.findOne({ code: roomCode });
    if (!room || !room.gameState) return;
    
    room.gameState.timeRemaining = duration;
    await room.save();
    io.to(roomCode).emit('timeUpdate', duration);
    
    // Start countdown
    const timer = setInterval(async () => {
      try {
        // Fetch the latest room state to ensure we have updated data
        const currentRoom = await Room.findOne({ code: roomCode });
        if (!currentRoom || !currentRoom.gameState) {
          clearInterval(timer);
          return;
        }
        
        // If the game is no longer in answering state, stop the timer
        if (currentRoom.gameState.status !== 'answering') {
          clearInterval(timer);
          return;
        }
        
        // Decrement time
        let timeRemaining = currentRoom.gameState.timeRemaining - 1;
        
        // Handle timer completion
        if (timeRemaining <= 0) {
          clearInterval(timer);
          timeRemaining = 0;
          console.log(`Timer reached zero for room ${roomCode}. Transitioning to results.`);
          
          // Save the time and emit the update
          currentRoom.gameState.timeRemaining = timeRemaining;
          await currentRoom.save();
          io.to(roomCode).emit('timeUpdate', timeRemaining);
          
          // Automatically move to results when time is up
          await judgeAnswers(roomCode);
          return;
        }
        
        // Update the room with new time
        currentRoom.gameState.timeRemaining = timeRemaining;
        await currentRoom.save();
        
        // Emit time update every second
        io.to(roomCode).emit('timeUpdate', timeRemaining);
      } catch (error) {
        console.error('Error updating timer:', error);
        clearInterval(timer);
      }
    }, 1000);
  } catch (error) {
    console.error('Error starting timer:', error);
  }
};

/**
 * Judge the answers and update scores
 */
async function judgeAnswers(roomCode: string) {
  try {
    // Find the room
    const room = await Room.findOne({ code: roomCode });
    if (!room || !room.gameState) {
      console.log('Room not found or game state missing');
      return;
    }
    
    // Update status to judging
    await Room.updateOne(
      { code: roomCode },
      { $set: { 'gameState.status': 'judging' } }
    );
    
    const updatedRoom = await Room.findOne({ code: roomCode });
    io.to(roomCode).emit('roomUpdate', updatedRoom);
    io.to(roomCode).emit('judgingStarted');
    
    // Get the answers, category, and question
    const gameState = updatedRoom.gameState;
    const answers = gameState.answers || {};
    const category = gameState.currentCategory as GameCategory;
    const judgingStyle = gameState.judgingStyle as JudgingStyle;
    const question = gameState.question || '';
    
    // Convert Mongoose Map to plain object if needed
    let answersObj: Record<string, string> = {};
    if (answers instanceof Map) {
      // Convert standard Map to object
      answersObj = Object.fromEntries(answers);
    } else if (answers instanceof Object && typeof answers.toJSON === 'function') {
      // Handle Mongoose Map/Document with toJSON method
      const jsonObj = answers.toJSON();
      for (const [key, value] of Object.entries(jsonObj)) {
        if (!key.startsWith('$')) { // Skip Mongoose internal keys
          answersObj[key] = value as string;
        }
      }
    } else {
      // It's already an object
      answersObj = answers as Record<string, string>;
    }
    
    // Use AI to judge the answers
    const judgingResult = await AIService.judgeAnswers(
      category,
      judgingStyle,
      question,
      answersObj
    );
    
    // Award points to winners (3 points each)
    const pointsPerWin = 3;
    const updatedScores = { ...(gameState.scores || {}) };
    
    judgingResult.winners.forEach(playerId => {
      updatedScores[playerId] = (updatedScores[playerId] || 0) + pointsPerWin;
    });
    
    // Save the round history
    // Create a clean version of the answers object for storage
    const cleanAnswers: Record<string, string> = {};
    Object.keys(answersObj).forEach(key => {
      cleanAnswers[key] = answersObj[key];
    });
    
    const roundHistory = [...(gameState.roundHistory || [])];
    roundHistory.push({
      round: gameState.round,
      category,
      question,
      answers: cleanAnswers,
      winners: judgingResult.winners,
      explanation: judgingResult.explanation
    });
    
    // Update the game state with judging results and scores
    await Room.updateOne(
      { code: roomCode },
      { 
        $set: { 
          'gameState.status': 'results',
          'gameState.judgingResult': judgingResult,
          'gameState.scores': updatedScores,
          'gameState.roundHistory': roundHistory
        } 
      }
    );
    
    const finalUpdatedRoom = await Room.findOne({ code: roomCode });
    io.to(roomCode).emit('roomUpdate', finalUpdatedRoom);
    io.to(roomCode).emit('judgingComplete', {
      judgingResult,
      scores: updatedScores
    });
    
  } catch (error) {
    console.error('Error judging answers:', error);
  }
}

/**
 * Start the next round
 */
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
      if ((score as number) < lowestScore) {
        lowestScore = score as number;
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
    io.to(roomCode).emit('roomUpdate', updatedRoom);
    io.to(roomCode).emit('roundStarted', updatedRoom.gameState);
    
  } catch (error) {
    console.error('Error starting next round:', error);
  }
} 