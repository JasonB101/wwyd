import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import { Room } from '@/models/Room';
import { v4 as uuidv4 } from 'uuid';

export async function POST(req: Request) {
  try {
    const { code, nickname } = await req.json();

    if (!code || !nickname) {
      return NextResponse.json(
        { error: 'Room code and nickname are required' },
        { status: 400 }
      );
    }

    await connectToDatabase();
    const room = await Room.findOne({ code });

    if (!room) {
      return NextResponse.json(
        { error: 'Room not found' },
        { status: 404 }
      );
    }

    if (room.status !== 'waiting') {
      return NextResponse.json(
        { error: 'Game has already started' },
        { status: 400 }
      );
    }

    // Check if nickname is already taken
    const existingPlayerWithSameNickname = room.players.find(p => p.nickname.toLowerCase() === nickname.toLowerCase());
    if (existingPlayerWithSameNickname) {
      return NextResponse.json(
        { error: 'This nickname is already taken in this room' },
        { status: 400 }
      );
    }

    // Generate a player ID but DON'T add to room yet - socket connection will handle that
    const playerId = uuidv4();
    
    console.log('Player prepared to join room:', {
      code: room.code,
      playerId,
      nickname
    });

    return NextResponse.json({
      room,
      playerId,
      isHost: room.players.length === 0 // Will be host if first player
    });
  } catch (error) {
    console.error('Error joining room:', error);
    return NextResponse.json(
      { error: 'Failed to join room' },
      { status: 500 }
    );
  }
} 