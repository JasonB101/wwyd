import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Room from '@/models/Room';
import { emitGameStart, emitRoomUpdate } from '@/lib/socket';

export async function POST(
  req: Request,
  { params }: { params: { code: string } }
) {
  try {
    await dbConnect();
    const { code } = params;

    const room = await Room.findOne({ code });

    if (!room) {
      return NextResponse.json(
        { error: 'Room not found' },
        { status: 404 }
      );
    }

    if (room.gameStatus !== 'waiting') {
      return NextResponse.json(
        { error: 'Game has already started' },
        { status: 400 }
      );
    }

    if (room.players.length < 2) {
      return NextResponse.json(
        { error: 'Need at least 2 players to start' },
        { status: 400 }
      );
    }

    room.gameStatus = 'playing';
    room.currentRound = 1;
    await room.save();

    // Emit game start event to all connected clients
    emitGameStart(code);
    emitRoomUpdate(code, room);

    return NextResponse.json(room);
  } catch (error) {
    console.error('Error starting game:', error);
    return NextResponse.json(
      { error: 'Failed to start game' },
      { status: 500 }
    );
  }
} 