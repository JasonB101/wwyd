const fs = require('fs');
const path = require('path');

// Directory to delete
const dotNextDir = path.join(__dirname, '.next');

console.log('Checking if .next directory exists...');

if (fs.existsSync(dotNextDir)) {
  console.log('Found .next directory, attempting to delete...');
  
  try {
    // Use recursive deletion (requires Node.js 14.14.0+)
    fs.rmSync(dotNextDir, { recursive: true, force: true });
    console.log('Successfully deleted .next directory');
    process.exit(0);
  } catch (err) {
    console.error('Error deleting .next directory:', err);
    process.exit(1);
  }
} else {
  console.log('.next directory does not exist, nothing to do');
  process.exit(0);
} 