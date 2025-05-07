import { initializeAIProvider } from './factory';

// Initialize AI provider with Hugging Face
initializeAIProvider({
  type: 'huggingface',
  config: {
    apiKey: process.env.HUGGINGFACE_API_KEY
  }
}); 