import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Room from '@/models/Room';

export async function POST(
  request: Request,
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

    if (room.status !== 'waiting') {
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

    // Update room status to playing
    room.status = 'playing';
    room.currentRound = 1;
    await room.save();

    return NextResponse.json(room);
  } catch (error) {
    console.error('Error starting game:', error);
    return NextResponse.json(
      { error: 'Error starting game' },
      { status: 500 }
    );
  }
} 