import mongoose from 'mongoose';

// Track the connection status
let isConnected = false;

/**
 * Connect to MongoDB with improved error handling and connection management
 */
export async function connectToDatabase() {
  // If already connected, return the existing connection
  if (isConnected) {
    console.log('Using existing database connection');
    return mongoose.connection;
  }

  // Get connection string from environment variables
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not defined in environment variables');
  }

  // Clear any previous listeners to avoid memory leaks
  mongoose.connection.removeAllListeners();

  console.log('Connecting to MongoDB...');
  console.log(`Connection string: ${uri.replace(/:[^:]*@/, ':****@')}`);

  try {
    // Set connection options
    const options = {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000, // Timeout after 5 seconds instead of 30
      heartbeatFrequencyMS: 10000, // Check server health every 10 seconds
      maxPoolSize: 10, // Maintain up to 10 socket connections
    };

    await mongoose.connect(uri, options);
    
    isConnected = true;
    console.log('Connected to MongoDB successfully');

    // Set up event listeners for connection issues
    mongoose.connection.on('disconnected', () => {
      console.log('MongoDB disconnected');
      isConnected = false;
    });

    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
      isConnected = false;
    });

    mongoose.connection.on('reconnected', () => {
      console.log('MongoDB reconnected');
      isConnected = true;
    });

    // Return the connection
    return mongoose.connection;
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
    isConnected = false;
    throw error;
  }
}

/**
 * Helper function to disconnect from MongoDB
 */
export async function disconnectFromDatabase() {
  if (!isConnected) {
    console.log('No active MongoDB connection to close');
    return;
  }
  
  try {
    await mongoose.connection.close();
    isConnected = false;
    console.log('MongoDB connection closed');
  } catch (error) {
    console.error('Error closing MongoDB connection:', error);
    throw error;
  }
} 