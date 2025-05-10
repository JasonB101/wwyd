import { initializeAIProvider } from './factory';

// Initialize AI provider with Gemini
initializeAIProvider({
  type: 'gemini',
  config: {
    apiKey: process.env.GEMINI_API_KEY
  }
}); 