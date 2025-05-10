import { AIProvider } from '../types';

const API_URL = "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent";
const API_KEY = "AIzaSyDNFjEhfZAK9f8D2vPLUoIfOoDNuTOsZOs"; // Using hardcoded key for reliability

export class GeminiProvider implements AIProvider {
  private apiKey: string;

  constructor(config: { apiKey?: string }) {
    // Use provided key or fall back to hardcoded key
    this.apiKey = config.apiKey || API_KEY;
  }

  private async query(prompt: string): Promise<string> {
    try {
      // Format API URL with API key
      const apiUrlWithKey = `${API_URL}?key=${this.apiKey}`;
      
      const response = await fetch(apiUrlWithKey, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 250,
            topP: 0.95,
            topK: 40
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API request failed with status ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      
      if (result.candidates && 
          result.candidates[0] && 
          result.candidates[0].content && 
          result.candidates[0].content.parts && 
          result.candidates[0].content.parts[0] && 
          result.candidates[0].content.parts[0].text) {
        return result.candidates[0].content.parts[0].text;
      } else {
        throw new Error('Unexpected API response format');
      }
    } catch (error) {
      console.error('Error querying Gemini API:', error);
      return "I would come up with a creative solution to the problem.";
    }
  }

  async generateQuestion(): Promise<string> {
    const prompts = [
      "What would you do if you suddenly became invisible for a day?",
      "What would you do if you found $10,000 in a paper bag on the street?",
      "What would you do if you could read minds for 24 hours?",
      "What would you do if you woke up and were the only person left on Earth?",
      "What would you do if you could speak any language fluently?",
      "What would you do if you were trapped in an elevator for 3 hours?",
      "What would you do if you could be any fictional character for a week?",
      "What would you do if you switched bodies with your best friend?",
      "What would you do if you could control the weather?",
      "What would you do if you could travel back to any time period?"
    ];

    try {
      // Generate a custom question using Gemini
      const prompt = "Create a fun 'What would you do if...' question that's clear and concise.";
      const aiQuestion = await this.query(prompt);
      
      // Extract just the question part if it's not too long
      const extractedQuestion = aiQuestion.match(/What would you do if.+\?/i);
      if (extractedQuestion && extractedQuestion[0].length < 150) {
        return extractedQuestion[0];
      }
      
      // If AI question doesn't look right, use random from premade list
      return prompts[Math.floor(Math.random() * prompts.length)];
    } catch (error) {
      // Fall back to random question from list
      return prompts[Math.floor(Math.random() * prompts.length)];
    }
  }

  async generateAnswer(question: string): Promise<string> {
    try {
      const prompt = `Question: ${question}\nProvide a creative, interesting answer that starts with "I would"`;
      const response = await this.query(prompt);
      
      // Clean up the response
      let answer = response.trim();
      if (!answer.toLowerCase().startsWith("i would")) {
        answer = "I would " + answer;
      }
      
      return answer;
    } catch (error) {
      return "I would come up with a creative solution to the problem.";
    }
  }
} 