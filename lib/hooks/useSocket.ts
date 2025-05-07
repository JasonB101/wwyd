import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useRouter } from 'next/navigation';

// Shared socket instance to be reused across components
let socketInstance: Socket | null = null;

/**
 * Custom hook for managing socket.io connections
 * Handles connection, player info, and room management
 */
export function useSocket() {
  const [socket, setSocket] = useState<Socket | null>(socketInstance);
  const [isConnected, setIsConnected] = useState<boolean>(socketInstance?.connected || false);
  const router = useRouter();

  useEffect(() => {
    // If we already have a socket instance, use it
    if (socketInstance) {
      setSocket(socketInstance);
      setIsConnected(socketInstance.connected);
      return;
    }

    try {
      // Get player info from localStorage
      const playerInfoStr = localStorage.getItem('playerInfo');
      if (!playerInfoStr) {
        console.log('No player info found, cannot initialize socket');
        return;
      }

      let playerInfo;
      try {
        playerInfo = JSON.parse(playerInfoStr);
      } catch (e) {
        console.error('Failed to parse player info:', e);
        return;
      }

      if (!playerInfo.playerId || !playerInfo.roomCode || !playerInfo.nickname) {
        console.log('Invalid player info:', playerInfo);
        return;
      }

      console.log('Initializing socket with player info:', playerInfo);

      // Initialize Socket.IO with explicit host to ensure proper connection
      const newSocket = io(window.location.origin, {
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000,
        query: {
          playerId: playerInfo.playerId,
          roomCode: playerInfo.roomCode,
          nickname: playerInfo.nickname
        }
      });

      // Store query params on socket for reconnection support
      (newSocket as any)._query = {
        playerId: playerInfo.playerId,
        roomCode: playerInfo.roomCode,
        nickname: playerInfo.nickname
      };

      // Add this forceful disconnect handler FIRST, before all other handlers
      // This should be the very first event handler defined after creating the socket
      // It will ensure the socket is terminated before any reconnection attempt

      // Force disconnection handler - no automatic reconnection allowed
      newSocket.on('forceDisconnect', (data: { message: string, roomCode: string }) => {
        console.log('FORCE DISCONNECT received:', data.message);
        
        // Explicitly disable auto-reconnect at all levels
        newSocket.io.opts.reconnection = false;
        newSocket.io._reconnection = false;
        
        // Clear ALL localStorage immediately
        if (data.roomCode) {
          localStorage.removeItem(`room_${data.roomCode}_playerId`);
          localStorage.removeItem(`room_${data.roomCode}_nickname`);
        }
        localStorage.removeItem('playerInfo');
        
        // Force client-side disconnect
        console.log('Forcing permanent disconnection, no auto-reconnect allowed');
        newSocket.disconnect();
        
        // Kill shared instance
        socketInstance = null;
        
        // Alert and redirect
        setTimeout(() => {
          alert(data.message || 'You have been removed from the room.');
          router.push('/');
        }, 0);
      });

      // Set up event handlers
      newSocket.on('connect', () => {
        console.log('Socket connected!');
        setIsConnected(true);
        
        // For reconnection - retrieve room code and player info from localStorage
        const storedPlayerInfo = localStorage.getItem('playerInfo');
        if (storedPlayerInfo) {
          try {
            const playerInfo = JSON.parse(storedPlayerInfo);
            if (playerInfo && playerInfo.roomCode && playerInfo.playerId && playerInfo.nickname) {
              const { roomCode, playerId, nickname } = playerInfo;
              console.log(`Reconnecting to room ${roomCode} with existing player info`, playerInfo);
              
              // First mark player as connected again
              newSocket.emit('playerReconnected', {
                roomCode,
                playerId,
                nickname
              });
              
              // Then rejoin room
              newSocket.emit('joinRoom', {
                roomCode,
                nickname,
                playerId
              });
            }
          } catch (e) {
            console.error('Error parsing playerInfo during reconnection:', e);
          }
        } else {
          console.log('No stored playerInfo found, cannot reconnect automatically');
        }
      });

      // Handle connection status from server
      newSocket.on('connectionStatus', (data) => {
        console.log('Connection status from server:', data);
        setIsConnected(true);
        
        // Verify we're properly joined to the room
        if (data.roomCode === playerInfo.roomCode && data.playerId === playerInfo.playerId) {
          console.log('Successfully joined room with socket ID:', data.socketId);
        } else {
          console.warn('Connection status mismatch:', { received: data, expected: playerInfo });
        }
      });

      newSocket.on('connect_error', (err) => {
        console.error('Socket connection error:', err);
        setIsConnected(false);
        
        // Try to provide helpful troubleshooting info
        console.log('Socket connection URL:', window.location.origin);
        console.log('Socket connection path:', '/socket.io');
        console.log('Socket connection query:', playerInfo);
      });

      newSocket.on('disconnect', (reason) => {
        console.log('Socket disconnected:', reason);
        setIsConnected(false);
        
        // If it was a server disconnect, try to reconnect
        if (reason === 'io server disconnect') {
          console.log('Server disconnected socket, attempting to reconnect...');
          newSocket.connect();
        }
      });

      // Handle server errors
      newSocket.on('error', (errorMsg: string) => {
        console.error('Socket error:', errorMsg);
        
        // Don't show alert for refresh-related errors
        if (errorMsg !== 'No player info found for socket') {
          alert(`Error: ${errorMsg}`);
        }
        
        // If it's a critical error, redirect to home
        if (errorMsg.includes('not found') || errorMsg.includes('nickname is already taken')) {
          // Clear playerInfo for this specific room
          if (playerInfo.roomCode) {
            localStorage.removeItem(`room_${playerInfo.roomCode}_playerId`);
            localStorage.removeItem(`room_${playerInfo.roomCode}_nickname`);
            localStorage.removeItem('playerInfo');
            console.log('Cleared player data due to critical error:', errorMsg);
          }
          
          router.push('/');
        }
      });

      // Handle server-initiated storage clearing (like when kicked)
      newSocket.on('clearRoomStorage', (data: { roomCode: string }) => {
        console.log('Server requested to clear room storage for:', data.roomCode);
        if (data.roomCode) {
          localStorage.removeItem(`room_${data.roomCode}_playerId`);
          localStorage.removeItem(`room_${data.roomCode}_nickname`);
          
          // If this is the active room, also clear playerInfo
          const currentInfo = JSON.parse(localStorage.getItem('playerInfo') || '{}');
          if (currentInfo.roomCode === data.roomCode) {
            localStorage.removeItem('playerInfo');
            console.log('Cleared playerInfo for room:', data.roomCode);
          }
        }
      });

      // Add a dedicated kicked event handler to handle being kicked better
      newSocket.on('kicked', (message: string) => {
        console.log('Kicked from room:', message);
        
        // Immediately set reconnection to false to prevent auto-reconnect
        newSocket.io.opts.reconnection = false;
        
        // Get the current room info before clearing it
        const playerInfoStr = localStorage.getItem('playerInfo');
        let roomCode = '';
        
        if (playerInfoStr) {
          try {
            const playerInfo = JSON.parse(playerInfoStr);
            roomCode = playerInfo.roomCode;
          } catch (e) {
            console.error('Error parsing playerInfo during kick:', e);
          }
        }
        
        // Clear ALL related storage immediately
        if (roomCode) {
          localStorage.removeItem(`room_${roomCode}_playerId`);
          localStorage.removeItem(`room_${roomCode}_nickname`);
        }
        localStorage.removeItem('playerInfo');
        
        // Don't rely on server disconnect - force disconnect now
        console.log('Disconnecting socket after kick');
        socketInstance = null; // Prevent any reconnection attempts
        newSocket.disconnect();
        
        // Alert user they were kicked and redirect
        alert('You have been removed from the room by the host.');
        router.push('/');
      });

      // Add a handler for room inactivity (temporary paused state)
      newSocket.on('roomInactive', (data: { message: string, roomCode: string }) => {
        console.log('Room is temporarily inactive:', data.message);
        // We could display a toast message here to inform users, but we don't 
        // need to clear storage or disconnect - just inform that room is paused
        
        // You might want to update UI state to show the room is inactive
        // This event is mainly useful for diagnostic purposes
      });

      // Store and return the socket
      socketInstance = newSocket;
      setSocket(newSocket);
    } catch (error) {
      console.error('Error initializing socket:', error);
    }

    // Cleanup on unmount
    return () => {
      // Don't disconnect socket on component unmount to maintain connection
      // Just remove listeners to prevent memory leaks
      if (socket) {
        console.log('Cleaning up socket listeners');
        socket.off('forceDisconnect');
        socket.off('connect');
        socket.off('connect_error');
        socket.off('disconnect');
        socket.off('connectionStatus');
        socket.off('error');
        socket.off('clearRoomStorage');
        socket.off('kicked');
        socket.off('roomInactive');
      }
    };
  }, [router]);

  // Connect to socket with current player info
  const reconnectWithCurrentInfo = () => {
    if (!socketInstance || !socketInstance.connected) {
      console.log('Attempting manual reconnection with current player info');
      
      try {
        const playerInfoStr = localStorage.getItem('playerInfo');
        if (!playerInfoStr) {
          console.error('No player info found for manual reconnection');
          return;
        }
        
        const playerInfo = JSON.parse(playerInfoStr);
        if (!playerInfo || !playerInfo.roomCode || !playerInfo.playerId || !playerInfo.nickname) {
          console.error('Invalid player info for manual reconnection:', playerInfo);
          return;
        }
        
        console.log('Manual reconnection attempt with:', playerInfo);
        
        // If the socket exists but is disconnected, try to reconnect
        if (socketInstance) {
          // Force disconnect first to clean up any stale state
          if (socketInstance.disconnected) {
            console.log('Socket is disconnected, forcing a clean reconnection');
            socketInstance.disconnect();
            
            // Small delay before reconnecting
            setTimeout(() => {
              socketInstance.connect();
              
              // Ensure we're in the room after connection
              setTimeout(() => {
                if (socketInstance.connected) {
                  console.log('Socket reconnected, explicitly joining room:', playerInfo.roomCode);
                  socketInstance.emit('joinRoom', playerInfo.roomCode, playerInfo.playerId, playerInfo.nickname);
                } else {
                  console.log('Socket failed to reconnect after forced disconnect');
                }
              }, 300);
            }, 200);
          } else {
            // Just try to emit joinRoom again
            console.log('Socket appears to be connected, just emitting joinRoom');
            socketInstance.emit('joinRoom', playerInfo.roomCode, playerInfo.playerId, playerInfo.nickname);
          }
        } else {
          console.error('No socket instance available for reconnection');
        }
      } catch (error) {
        console.error('Error during manual reconnection:', error);
      }
    } else {
      console.log('Socket is already connected, no need to reconnect');
    }
  };

  // Handle unexpected disconnections
  useEffect(() => {
    // Set up a periodic check for connection status
    const connectionCheckInterval = setInterval(() => {
      if (socket && !socket.connected && isConnected) {
        // We think we're connected but actually aren't
        console.log('Detected socket disconnection not properly tracked');
        setIsConnected(false);
        reconnectWithCurrentInfo();
      }
    }, 5000);

    return () => {
      clearInterval(connectionCheckInterval);
    };
  }, [socket, isConnected]);

  // Cleanly disconnect and leave room
  const leaveRoom = () => {
    if (socketInstance) {
      try {
        console.log('Cleaning up socket and leaving room');
        
        // Get current room info
        const playerInfoStr = localStorage.getItem('playerInfo');
        if (playerInfoStr) {
          const playerInfo = JSON.parse(playerInfoStr);
          if (playerInfo.roomCode) {
            console.log(`Emitting leaveRoom event for room ${playerInfo.roomCode}`);
            
            // Set timestamp when we left
            localStorage.setItem('leftRoomAt', Date.now().toString());
            
            // Emit leave room event and wait for acknowledgement before disconnecting
            socketInstance.emit('leaveRoom', playerInfo.roomCode);
            
            // IMPORTANT: Add a small delay before disconnecting to ensure the event is sent
            setTimeout(() => {
              console.log('Disconnecting socket after leaveRoom event');
              // Disconnect socket AFTER the event has time to be sent
              socketInstance.disconnect();
              socketInstance = null;
            }, 300); // Give it 300ms to ensure the event is transmitted
            
            return; // Exit early to prevent immediate disconnection
          }
        }
        
        // If we don't have room info or some other issue occurred, disconnect immediately
        console.log('No room info found, disconnecting socket directly');
        socketInstance.disconnect();
        socketInstance = null;
      } catch (error) {
        console.error('Error during leaveRoom:', error);
        // Still try to disconnect the socket in case of error
        if (socketInstance) {
          socketInstance.disconnect();
          socketInstance = null;
        }
      }
    }
  };

  // Expose the manual reconnect function
  return { socket, isConnected, reconnect: reconnectWithCurrentInfo, leaveRoom };
} 