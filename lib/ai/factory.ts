import { AIProvider, AIProviderConfig } from './types';
import { MockAIProvider } from './providers/mock';
import { HuggingFaceProvider } from './providers/huggingface';
import { GeminiProvider } from './providers/gemini';

let currentProvider: AIProvider | null = null;

export function initializeAIProvider(config?: AIProviderConfig): AIProvider {
  // If no config provided, use Gemini provider (our new default)
  if (!config) {
    currentProvider = new GeminiProvider({
      apiKey: process.env.GEMINI_API_KEY
    });
    return currentProvider;
  }

  switch (config.type) {
    case 'gemini':
      currentProvider = new GeminiProvider(config.config);
      break;
    case 'huggingface':
      if (!config.config.apiKey) {
        console.warn('Hugging Face API key not provided, falling back to Gemini provider');
        currentProvider = new GeminiProvider({});
      } else {
        currentProvider = new HuggingFaceProvider(config.config);
      }
      break;
    case 'mock':
      currentProvider = new MockAIProvider();
      break;
    default:
      console.warn(`Unsupported AI provider type: ${config.type}, falling back to Gemini provider`);
      currentProvider = new GeminiProvider({});
  }
  return currentProvider;
}

export function getAIProvider(): AIProvider {
  if (!currentProvider) {
    // Initialize with Gemini provider if none is initialized
    currentProvider = new GeminiProvider({});
  }
  return currentProvider;
}

export async function generateQuestion(): Promise<string> {
  return getAIProvider().generateQuestion();
}

export async function generateAnswer(question: string): Promise<string> {
  return getAIProvider().generateAnswer(question);
} 