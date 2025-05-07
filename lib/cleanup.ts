import { dbConnect } from './db';
import Room from '@/models/Room';

const INACTIVE_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

export async function cleanupInactiveRooms() {
  try {
    await dbConnect();
    
    const cutoffTime = new Date(Date.now() - INACTIVE_THRESHOLD);
    
    // Find and delete rooms that haven't been updated in the last 24 hours
    const result = await Room.deleteMany({
      updatedAt: { $lt: cutoffTime }
    });

    console.log(`Cleaned up ${result.deletedCount} inactive rooms`);
    return result.deletedCount;
  } catch (error) {
    console.error('Error cleaning up inactive rooms:', error);
    throw error;
  }
} 