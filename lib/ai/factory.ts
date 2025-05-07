import { AIProvider, AIProviderConfig } from './types';
import { MockAIProvider } from './providers/mock';
import { HuggingFaceProvider } from './providers/huggingface';

let currentProvider: AIProvider | null = null;

export function initializeAIProvider(config?: AIProviderConfig): AIProvider {
  // If no config provided, use Hugging Face provider
  if (!config) {
    currentProvider = new HuggingFaceProvider({
      apiKey: process.env.HUGGINGFACE_API_KEY
    });
    return currentProvider;
  }

  switch (config.type) {
    case 'huggingface':
      if (!config.config.apiKey) {
        console.warn('Hugging Face API key not provided, falling back to mock provider');
        currentProvider = new MockAIProvider();
      } else {
        currentProvider = new HuggingFaceProvider(config.config);
      }
      break;
    case 'mock':
      currentProvider = new MockAIProvider();
      break;
    default:
      console.warn(`Unsupported AI provider type: ${config.type}, falling back to mock provider`);
      currentProvider = new MockAIProvider();
  }
  return currentProvider;
}

export function getAIProvider(): AIProvider {
  if (!currentProvider) {
    // Initialize with Hugging Face provider if none is initialized
    currentProvider = new HuggingFaceProvider({
      apiKey: process.env.HUGGINGFACE_API_KEY
    });
  }
  return currentProvider;
}

export async function generateQuestion(): Promise<string> {
  return getAIProvider().generateQuestion();
}

export async function generateAnswer(question: string): Promise<string> {
  return getAIProvider().generateAnswer(question);
} 