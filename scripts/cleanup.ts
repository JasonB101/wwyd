import { cleanupInactiveRooms } from '../lib/cleanup';

async function runCleanup() {
  try {
    console.log('Starting room cleanup...');
    const deletedCount = await cleanupInactiveRooms();
    console.log(`Cleanup completed. Deleted ${deletedCount} inactive rooms.`);
  } catch (error) {
    console.error('Cleanup failed:', error);
  }
}

// Run cleanup immediately
runCleanup();

// Then run every 6 hours
setInterval(runCleanup, 6 * 60 * 60 * 1000); 