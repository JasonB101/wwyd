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

      // Initialize Socket.IO
      const newSocket = io({
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        query: {
          playerId: playerInfo.playerId,
          roomCode: playerInfo.roomCode,
          nickname: playerInfo.nickname
        }
      });

      // Set up event handlers
      newSocket.on('connect', () => {
        console.log('Socket connected successfully:', newSocket.id);
        setIsConnected(true);
        
        // Join room with player info
        newSocket.emit('joinRoom', playerInfo.roomCode, playerInfo.playerId, playerInfo.nickname);
      });

      newSocket.on('connect_error', (err) => {
        console.error('Socket connection error:', err);
        setIsConnected(false);
      });

      newSocket.on('disconnect', (reason) => {
        console.log('Socket disconnected:', reason);
        setIsConnected(false);
      });

      // Handle server errors
      newSocket.on('error', (errorMsg: string) => {
        console.error('Socket error:', errorMsg);
        alert(`Error: ${errorMsg}`);
        
        // If it's a critical error, redirect to home
        if (errorMsg.includes('not found') || errorMsg.includes('nickname is already taken')) {
          localStorage.removeItem('playerInfo');
          router.push('/');
        }
      });

      // Store and return the socket
      socketInstance = newSocket;
      setSocket(newSocket);
    } catch (error) {
      console.error('Error initializing socket:', error);
    }

    // Cleanup on unmount
    return () => {
      if (socket) {
        socket.off('connect');
        socket.off('connect_error');
        socket.off('disconnect');
        socket.off('error');
      }
    };
  }, [router]);

  return { socket, isConnected };
} 