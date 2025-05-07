import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import { Room } from '@/models/Room';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');

    if (!code) {
      return NextResponse.json({ error: 'Room code is required' }, { status: 400 });
    }

    // Ensure database connection is established
    await connectToDatabase();
    console.log('Database connected, searching for room:', code);

    const room = await Room.findOne({ code });
    console.log('Room search result:', room ? 'found' : 'not found');

    if (!room) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }

    return NextResponse.json(room);
  } catch (error) {
    console.error('Error fetching room:', error);
    return NextResponse.json({ error: 'Failed to fetch room' }, { status: 500 });
  }
} 