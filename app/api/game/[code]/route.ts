import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Room from '@/models/Room';
import { getAIProvider } from '@/lib/ai/factory';

const MAX_ROUNDS = 5;

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

    if (room.status !== 'playing') {
      return NextResponse.json(
        { error: 'Game is not in progress' },
        { status: 400 }
      );
    }

    // Calculate scores
    const scores: Record<string, number> = {};
    room.players.forEach(player => {
      scores[player.nickname] = player.score || 0;
    });

    return NextResponse.json({
      room,
      gameState: {
        currentRound: room.currentRound,
        currentQuestion: room.currentQuestion,
        currentAnswers: room.currentAnswers,
        scores,
        status: room.gameStatus
      }
    });
  } catch (error) {
    console.error('Error fetching game state:', error);
    return NextResponse.json(
      { error: 'Failed to fetch game state' },
      { status: 500 }
    );
  }
}

export async function POST(
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

    if (room.status !== 'playing') {
      return NextResponse.json(
        { error: 'Game is not in progress' },
        { status: 400 }
      );
    }

    const aiProvider = getAIProvider();
    const question = await aiProvider.generateQuestion();

    // Update room with new question
    room.currentQuestion = question;
    room.currentAnswers = [];
    room.gameStatus = 'answering';
    room.currentRound += 1;

    // Check if game is finished
    if (room.currentRound > MAX_ROUNDS) {
      room.status = 'finished';
      room.gameStatus = 'finished';
    }

    await room.save();

    // Calculate scores
    const scores: Record<string, number> = {};
    room.players.forEach(player => {
      scores[player.nickname] = player.score || 0;
    });

    return NextResponse.json({
      room,
      gameState: {
        currentRound: room.currentRound,
        currentQuestion: room.currentQuestion,
        currentAnswers: room.currentAnswers,
        scores,
        status: room.gameStatus
      }
    });
  } catch (error) {
    console.error('Error updating game state:', error);
    return NextResponse.json(
      { error: 'Failed to update game state' },
      { status: 500 }
    );
  }
} 