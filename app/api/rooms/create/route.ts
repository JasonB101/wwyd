import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import { Room } from '@/models/Room';
import { v4 as uuidv4 } from 'uuid';

function generateRoomCode(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { nickname } = body;

    if (!nickname) {
      return NextResponse.json({ error: 'Nickname is required' }, { status: 400 });
    }

    await connectToDatabase();
    const playerId = uuidv4();
    const roomCode = generateRoomCode();

    // Create a new room with the player as host
    const room = new Room({
      code: roomCode,
      players: [{
        id: playerId,
        nickname,
        isHost: true,
        isConnected: true
      }],
      status: 'waiting',
      scores: {} // Initialize empty scores object
    });

    await room.save();
    console.log('Room created:', {
      code: room.code,
      playerCount: room.players.length,
      players: room.players.map(p => ({ id: p.id, nickname: p.nickname, isHost: p.isHost }))
    });

    return NextResponse.json({
      room,
      playerId,
      isHost: true
    });
  } catch (error) {
    console.error('Error creating room:', error);
    return NextResponse.json({ error: 'Failed to create room' }, { status: 500 });
  }
} 