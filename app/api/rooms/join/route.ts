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

    // Check if nickname is already taken by ANY player (not just connected ones)
    // This prevents conflicts if a player disconnects and another tries to take their name
    const existingPlayerWithSameNickname = room.players.find(
      p => p.nickname.toLowerCase() === nickname.toLowerCase()
    );
    
    if (existingPlayerWithSameNickname) {
      console.log(`Nickname "${nickname}" already taken in room ${code} by player ${existingPlayerWithSameNickname.id}`);
      return NextResponse.json(
        { 
          error: 'This nickname is already taken in this room. If you just left the room, please wait a moment or try a different nickname.',
          clearStorage: true // Signal to client to clear storage for this room
        },
        { status: 400 }
      );
    }

    // Generate a player ID
    const playerId = uuidv4();
    
    // Add the player to the room with isConnected=false initially
    // The socket connection will mark them as connected
    const updatedRoom = await Room.findOneAndUpdate(
      { code },
      {
        $push: {
          players: {
            id: playerId,
            nickname,
            isHost: false,
            isConnected: false // Socket will mark them connected when they actually connect
          }
        }
      },
      { new: true }
    );
    
    console.log('Player added to room via API:', {
      code: room.code,
      playerId,
      nickname,
      playerCount: updatedRoom?.players.length
    });

    return NextResponse.json({
      room: updatedRoom,
      playerId,
      isHost: false
    });
  } catch (error) {
    console.error('Error joining room:', error);
    return NextResponse.json(
      { error: 'Failed to join room' },
      { status: 500 }
    );
  }
} 