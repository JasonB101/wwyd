// clean.js - Script to safely clean Next.js cache
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const rimraf = require('rimraf');

// Define paths
const nextDir = path.join(process.cwd(), '.next');
const cacheDirs = [
  path.join(process.cwd(), '.next', 'cache'),
  path.join(process.cwd(), 'node_modules', '.next', 'cache')
];

console.log('Starting Next.js cache cleanup...');

// Function to check if directory exists
function dirExists(dir) {
  try {
    return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
  } catch (err) {
    return false;
  }
}

// Safer directory removal - only remove cache dirs, not entire .next folder
async function cleanCacheDirs() {
  for (const dir of cacheDirs) {
    try {
      if (dirExists(dir)) {
        console.log(`Removing Next.js cache directory: ${dir}`);
        rimraf.sync(dir);
        console.log(`Successfully removed cache: ${dir}`);
      } else {
        console.log(`Cache directory does not exist: ${dir}`);
      }
    } catch (error) {
      console.error(`Failed to clean ${dir}: ${error.message}`);
    }
  }
  
  // Create necessary Next.js directories to prevent ENOENT errors
  try {
    const requiredDirs = [
      path.join(process.cwd(), '.next'),
      path.join(process.cwd(), '.next', 'cache'),
      path.join(process.cwd(), '.next', 'server'),
      path.join(process.cwd(), '.next', 'static')
    ];
    
    for (const dir of requiredDirs) {
      if (!dirExists(dir)) {
        console.log(`Creating directory: ${dir}`);
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    
    // Create empty middleware-manifest.json to prevent errors
    const manifestPath = path.join(process.cwd(), '.next', 'server', 'middleware-manifest.json');
    if (!fs.existsSync(manifestPath)) {
      console.log(`Creating empty middleware manifest`);
      fs.writeFileSync(manifestPath, JSON.stringify({
        version: 1,
        sortedMiddleware: [],
        middleware: {},
        functions: {},
        pages: {}
      }));
    }
  } catch (error) {
    console.error(`Error creating directories: ${error.message}`);
  }
  
  console.log('Cache cleanup completed.');
  console.log('You can now restart your development server.');
}

cleanCacheDirs(); 