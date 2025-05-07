import { NextResponse } from 'next/server';
import { cleanupInactiveRooms } from '@/lib/cleanup';

// Simple API key check - in production, use a more secure method
const API_KEY = process.env.ADMIN_API_KEY || 'your-secret-key';

export async function POST(req: Request) {
  try {
    // Check for API key in headers
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const providedKey = authHeader.split(' ')[1];
    if (providedKey !== API_KEY) {
      return NextResponse.json(
        { error: 'Invalid API key' },
        { status: 401 }
      );
    }

    const deletedCount = await cleanupInactiveRooms();

    return NextResponse.json({
      success: true,
      deletedCount
    });
  } catch (error) {
    console.error('Error in cleanup endpoint:', error);
    return NextResponse.json(
      { error: 'Failed to clean up rooms' },
      { status: 500 }
    );
  }
} 