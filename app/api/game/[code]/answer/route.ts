import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Room from '@/models/Room';
import { emitAnswerUpdate, emitRoomUpdate } from '@/lib/socket';

export async function POST(
  req: Request,
  { params }: { params: { code: string } }
) {
  try {
    await dbConnect();
    const { code } = params;
    const { playerId, answer } = await req.json();

    if (!playerId || !answer) {
      return NextResponse.json(
        { error: 'Player ID and answer are required' },
        { status: 400 }
      );
    }

    const room = await Room.findOne({ code });

    if (!room) {
      return NextResponse.json(
        { error: 'Room not found' },
        { status: 404 }
      );
    }

    if (room.gameStatus !== 'playing') {
      return NextResponse.json(
        { error: 'Game is not in progress' },
        { status: 400 }
      );
    }

    if (!room.currentQuestion) {
      return NextResponse.json(
        { error: 'No active question' },
        { status: 400 }
      );
    }

    const player = room.players.find(p => p.id === playerId);
    if (!player) {
      return NextResponse.json(
        { error: 'Player not found' },
        { status: 404 }
      );
    }

    // Check if player has already submitted an answer
    if (room.currentAnswers.some(a => a.playerId === playerId)) {
      return NextResponse.json(
        { error: 'Answer already submitted' },
        { status: 400 }
      );
    }

    room.currentAnswers.push({
      playerId,
      answer,
      isAI: false
    });

    await room.save();

    // Emit answer update to all connected clients
    emitAnswerUpdate(code, playerId, answer);
    emitRoomUpdate(code, room);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error submitting answer:', error);
    return NextResponse.json(
      { error: 'Failed to submit answer' },
      { status: 500 }
    );
  }
} 