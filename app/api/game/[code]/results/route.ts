import { NextResponse } from 'next/server';
import { dbConnect } from '@/lib/db';
import Room from '@/models/Room';

export async function GET(
  request: Request,
  { params }: { params: { code: string } }
) {
  try {
    await dbConnect();

    const room = await Room.findOne({ code: params.code });

    if (!room) {
      return NextResponse.json(
        { error: 'Room not found' },
        { status: 404 }
      );
    }

    if (room.status !== 'finished') {
      return NextResponse.json(
        { error: 'Game is not finished' },
        { status: 400 }
      );
    }

    // Calculate final scores
    const scores: Record<string, number> = {};
    room.players.forEach(player => {
      scores[player.nickname] = player.score || 0;
    });

    return NextResponse.json({
      room,
      gameState: {
        currentRound: room.currentRound,
        scores
      }
    });
  } catch (error) {
    console.error('Error fetching game results:', error);
    return NextResponse.json(
      { error: 'Failed to fetch game results' },
      { status: 500 }
    );
  }
} 