import { AIProvider } from '../types';

const API_URL = "https://api-inference.huggingface.co/models/";
const QUESTION_MODEL = "gpt2";  // Using GPT-2 for creative text generation
const ANSWER_MODEL = "gpt2";    // Using GPT-2 for creative responses

export class HuggingFaceProvider implements AIProvider {
  private apiKey: string;

  constructor(config: { apiKey: string }) {
    this.apiKey = config.apiKey;
  }

  private async query(prompt: string, model: string): Promise<string> {
    try {
      const response = await fetch(API_URL + model, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ 
          inputs: prompt,
          parameters: {
            max_length: 100,
            temperature: 0.9,
            top_p: 0.9,
            do_sample: true
          }
        }),
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.statusText}`);
      }

      const result = await response.json();
      return result[0]?.generated_text || "I would probably just stand there and stare.";
    } catch (error) {
      console.error('Error querying Hugging Face API:', error);
      return "I would probably just stand there and stare.";
    }
  }

  async generateQuestion(): Promise<string> {
    const prompts = [
      "What would you do if you could speak to animals?",
      "What would you do if you could time travel for one day?",
      "What would you do if you found a genie lamp?",
      "What would you do if you could read minds?",
      "What would you do if you could fly?",
      "What would you do if you were invisible for a day?",
      "What would you do if you could control the weather?",
      "What would you do if you could talk to plants?",
      "What would you do if you could breathe underwater?",
      "What would you do if you could teleport anywhere?"
    ];

    return prompts[Math.floor(Math.random() * prompts.length)];
  }

  async generateAnswer(question: string): Promise<string> {
    const prompt = `Question: ${question}\nAnswer: I would`;
    const response = await this.query(prompt, ANSWER_MODEL);
    
    // Clean up the response
    let answer = response.replace(prompt, "").trim();
    if (!answer.startsWith("I would")) {
      answer = "I would " + answer;
    }
    
    return answer;
  }
} 