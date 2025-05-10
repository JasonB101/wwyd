export interface AIProvider {
  generateQuestion(): Promise<string>;
  generateAnswer(question: string): Promise<string>;
}

export interface AIProviderConfig {
  type: 'huggingface' | 'mock' | 'gemini' | 'custom';
  config: {
    apiKey?: string;
    [key: string]: any;
  };
} 