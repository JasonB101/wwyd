import { Server as NetServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { NextApiResponse } from 'next';
import { Room, type IRoom } from '@/models/Room';

export type NextApiResponseWithSocket = NextApiResponse & {
  socket: {
    server: NetServer & {
      io?: SocketIOServer;
    };
  };
};

export const initSocket = (res: NextApiResponseWithSocket) => {
  if (!res.socket.server.io) {
    const io = new SocketIOServer(res.socket.server, {
      path: '/api/socket',
      addTrailingSlash: false,
    });

    io.on('connection', (socket) => {
      console.log('Client connected:', socket.id);

      socket.on('joinRoom', (roomCode: string) => {
        socket.join(roomCode);
        console.log(`Client ${socket.id} joined room ${roomCode}`);
      });

      socket.on('leaveRoom', (roomCode: string) => {
        socket.leave(roomCode);
        console.log(`Client ${socket.id} left room ${roomCode}`);
      });

      socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
      });
    });

    res.socket.server.io = io;
  }
  return res.socket.server.io;
};

export function emitRoomUpdate(roomCode: string, room: IRoom) {
  const io = (global as any).io;
  if (io) {
    console.log('Emitting room update:', {
      roomCode,
      playerCount: room.players.length,
      players: room.players.map((p: { id: string; nickname: string }) => ({ id: p.id, nickname: p.nickname }))
    });
    io.to(roomCode).emit('roomUpdate', room);
  } else {
    console.warn('Socket.IO instance not found when trying to emit room update');
  }
}

export function emitGameStart(roomCode: string) {
  const io = (global as any).io;
  if (io) {
    io.to(roomCode).emit('gameStart');
  }
}

export function emitGameEnd(roomCode: string) {
  const io = (global as any).io;
  if (io) {
    io.to(roomCode).emit('gameEnd');
  }
}

export function emitQuestionUpdate(roomCode: string, question: string) {
  const io = (global as any).io;
  if (io) {
    io.to(roomCode).emit('questionUpdate', question);
  }
}

export function emitAnswerUpdate(roomCode: string, playerId: string, answer: string) {
  const io = (global as any).io;
  if (io) {
    io.to(roomCode).emit('answerUpdate', { playerId, answer });
  }
}

export function emitScoreUpdate(roomCode: string, scores: Record<string, number>) {
  const io = (global as any).io;
  if (io) {
    io.to(roomCode).emit('scoreUpdate', scores);
  }
}

let io: SocketIOServer | null = null;

export function setSocketServer(socketServer: SocketIOServer) {
  io = socketServer;
}

export function getSocketServer(): SocketIOServer | null {
  return io;
} 