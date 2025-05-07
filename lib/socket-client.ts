import { io, Socket } from 'socket.io-client';

let socket: Socket;

export const initSocket = () => {
  if (!socket) {
    socket = io({
      path: '/api/socket',
      addTrailingSlash: false
    });

    socket.on('connect', () => {
      console.log('Connected to Socket.IO server');
    });

    socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
    });
  }
  return socket;
};

export const getSocket = () => {
  if (!socket) {
    return initSocket();
  }
  return socket;
};

export const joinRoom = (roomCode: string) => {
  const socket = getSocket();
  socket.emit('join-room', roomCode);
};

export const leaveRoom = (roomCode: string) => {
  const socket = getSocket();
  socket.emit('leaveRoom', roomCode);
}; 