import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Room from '@/models/Room';
import { getAIProvider } from '@/lib/ai/factory';
import { emitQuestionUpdate, emitRoomUpdate } from '@/lib/socket';

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

    if (room.gameStatus !== 'playing') {
      return NextResponse.json(
        { error: 'Game is not in progress' },
        { status: 400 }
      );
    }

    const aiProvider = getAIProvider();
    const question = await aiProvider.generateQuestion();

    room.currentQuestion = question;
    room.currentAnswers = [];
    await room.save();

    // Emit question update to all connected clients
    emitQuestionUpdate(code, question);
    emitRoomUpdate(code, room);

    return NextResponse.json({ question });
  } catch (error) {
    console.error('Error generating question:', error);
    return NextResponse.json(
      { error: 'Failed to generate question' },
      { status: 500 }
    );
  }
} 