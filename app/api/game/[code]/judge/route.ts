import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Room from '@/models/Room';
import { emitScoreUpdate, emitRoomUpdate, emitGameEnd } from '@/lib/socket';

const MAX_ROUNDS = 5;

export async function POST(
  req: Request,
  { params }: { params: { code: string } }
) {
  try {
    await dbConnect();
    const { code } = params;
    const { playerId, selectedAnswerId } = await req.json();

    if (!playerId || !selectedAnswerId) {
      return NextResponse.json(
        { error: 'Player ID and selected answer ID are required' },
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

    const selectedAnswer = room.currentAnswers.find(a => a.playerId === selectedAnswerId);
    if (!selectedAnswer) {
      return NextResponse.json(
        { error: 'Selected answer not found' },
        { status: 404 }
      );
    }

    // Award point to the player who submitted the selected answer
    const player = room.players.find(p => p.id === selectedAnswerId);
    if (player) {
      player.score += 1;
    }

    // Check if game is over
    if (room.currentRound >= room.maxRounds) {
      room.gameStatus = 'finished';
      await room.save();

      // Emit game end event
      emitGameEnd(code);
    } else {
      room.currentRound += 1;
      room.currentQuestion = null;
      room.currentAnswers = [];
      await room.save();
    }

    // Emit score update to all connected clients
    const scores = room.players.reduce((acc, player) => {
      acc[player.id] = player.score;
      return acc;
    }, {} as Record<string, number>);

    emitScoreUpdate(code, scores);
    emitRoomUpdate(code, room);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error judging answer:', error);
    return NextResponse.json(
      { error: 'Failed to judge answer' },
      { status: 500 }
    );
  }
} 