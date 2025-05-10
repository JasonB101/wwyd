import { GameCategory, JudgingStyle } from '@/types/gameState';

/**
 * AI Service for handling question generation and answer judging
 * using Google Gemini API
 */

interface AIJudgingResult {
  winners: string[];
  explanation: string;
}

// Interface for question responses
interface QuestionItem {
  questionText: string;
  judgingStyle: JudgingStyle;
}

// Interface for cached questions
interface CategoryQuestions {
  [category: string]: string[];
}

// Global state for API usage tracking
const GEMINI_API_KEY = "AIzaSyDNFjEhfZAK9f8D2vPLUoIfOoDNuTOsZOs"; // Direct value instead of environment reference
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent";
let questionsCache: CategoryQuestions | null = null;
let apiCallsInCurrentSession = 0;
const MAX_API_CALLS_PER_SESSION = 100; // Gemini has a very generous free tier
let isUsingAiJudging = true;

export class AIService {
  /**
   * Makes an API call to Google Gemini with comprehensive logging
   */
  private static async makeApiCall(prompt: string, maxTokens: number = 250): Promise<string> {
    // Check API call budget
    if (apiCallsInCurrentSession >= MAX_API_CALLS_PER_SESSION) {
      console.log(`[AIService] API call limit reached (${apiCallsInCurrentSession}/${MAX_API_CALLS_PER_SESSION})`);
      throw new Error('API call limit reached');
    }

    // Check for API key
    if (!GEMINI_API_KEY) {
      console.error('[AIService] GEMINI_API_KEY is not valid');
      throw new Error('API key not set');
    }
    
    // Update tracking
    apiCallsInCurrentSession++;
    console.log(`[AIService] Making API call (${apiCallsInCurrentSession}/${MAX_API_CALLS_PER_SESSION}) to Gemini`);
    console.log(`[AIService] Prompt length: ${prompt.length} characters`);
    
    // Call Gemini API with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      console.log('[AIService] API call timed out after 15 seconds');
    }, 15000);
    
    try {
      console.log('[AIService] Sending request to Gemini API...');
      const startTime = Date.now();
      
      // Format API URL with API key
      const apiUrlWithKey = `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`;
      
      const response = await fetch(
        apiUrlWithKey,
        {
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
              maxOutputTokens: maxTokens,
              topP: 0.95,
              topK: 40
            }
          }),
          signal: controller.signal
        }
      );
      
      const elapsed = Date.now() - startTime;
      console.log(`[AIService] Response received in ${elapsed}ms with status ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[AIService] API error: ${response.status} ${response.statusText}`);
        console.error(`[AIService] Error details: ${errorText}`);
        throw new Error(`API request failed with status ${response.status}: ${errorText}`);
      }

      // Parse Gemini response
      const result = await response.json();
      console.log('[AIService] Raw API response:', JSON.stringify(result).substring(0, 200) + '...');
      
      // Extract the text from Gemini's response
      let generatedText = '';
      
      if (result.candidates && 
          result.candidates[0] && 
          result.candidates[0].content && 
          result.candidates[0].content.parts && 
          result.candidates[0].content.parts[0] && 
          result.candidates[0].content.parts[0].text) {
        generatedText = result.candidates[0].content.parts[0].text;
      } else {
        throw new Error('Unexpected API response format');
      }
      
      console.log(`[AIService] Generated text length: ${generatedText.length} characters`);
      console.log(`[AIService] Generated text sample: ${generatedText.substring(0, 100)}...`);
      
      return generatedText;
    } catch (error) {
      console.error(`[AIService] API call failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  
  /**
   * Fetch all category questions in a single API call
   */
  static async fetchAllCategoryQuestions(): Promise<CategoryQuestions> {
    // Return cached questions if available
    if (questionsCache) {
      console.log('[AIService] Using cached questions');
      return questionsCache;
    }

    console.log('[AIService] No cached questions available, fetching from API');
    
    try {
      // Create a prompt
      const prompt = this.createBatchQuestionsPrompt();
      
      // Call Gemini API
      const generatedText = await this.makeApiCall(prompt);
      console.log("[AIService] Successfully received response for questions");
      
      // Parse questions
      const questions = this.parseQuestionsFromResponse(generatedText);
      
      // Cache questions
      questionsCache = questions;
      console.log('[AIService] Questions cached for future use');
      
      return questions;
    } catch (error) {
      console.error("[AIService] Error getting AI questions:", error instanceof Error ? error.message : "Unknown error");
      console.log("[AIService] Using fallback questions");
      return this.getFallbackQuestions();
    }
  }

  /**
   * Create a prompt for batch question generation
   */
  private static createBatchQuestionsPrompt(): string {
    return `Generate 5 fun questions for a party game.
Use clear language, avoid overly complex vocabulary, and keep questions concise.
Format your response exactly with category headers and questions:

BUSINESS CATEGORY:
[Write a business scenario question that's easy to understand]

SCENARIO CATEGORY:
[Write a hypothetical scenario that uses straightforward language]

WOULD YOU RATHER CATEGORY:
[Write a would-you-rather question with two interesting but clear choices]

PLEAD FOR YOUR LIFE CATEGORY:
[Write a scenario where someone must convince someone not to harm them]

ESCAPE CATEGORY:
[Write a scenario where someone must escape from a situation]

Keep all questions brief (1-2 sentences) and use straightforward language.`;
  }

  /**
   * Parse the AI response to extract one question for each category
   */
  private static parseQuestionsFromResponse(text: string): CategoryQuestions {
    console.log('[AIService] Parsing AI response to extract questions');
    console.log('[AIService] Full response: ' + text);
    const defaultQuestions = this.getFallbackQuestions();
    let questions: CategoryQuestions = {
      business: [],
      scenario: [],
      wouldYouRather: [],
      pleadForYourLife: [],
      escape: []
    };
    
    try {
      // Extract each category section using simplified regex for the new format
      const businessMatch = text.match(/BUSINESS CATEGORY:([^]+?)(?=SCENARIO CATEGORY:|$)/i);
      const scenarioMatch = text.match(/SCENARIO CATEGORY:([^]+?)(?=WOULD YOU RATHER CATEGORY:|$)/i);
      const wyrMatch = text.match(/WOULD YOU RATHER CATEGORY:([^]+?)(?=PLEAD FOR YOUR LIFE CATEGORY:|$)/i);
      const pleadMatch = text.match(/PLEAD FOR YOUR LIFE CATEGORY:([^]+?)(?=ESCAPE CATEGORY:|$)/i);
      const escapeMatch = text.match(/ESCAPE CATEGORY:([^]+?)(?=$)/i);

      // Process each match
      if (businessMatch && businessMatch[1]) {
        const question = businessMatch[1].trim();
        if (question.length >= 20) {
          questions.business = [question];
          console.log(`[AIService] Extracted business question: "${question.substring(0, 50)}..."`);
        }
      }
      
      if (scenarioMatch && scenarioMatch[1]) {
        const question = scenarioMatch[1].trim();
        if (question.length >= 20) {
          questions.scenario = [question];
          console.log(`[AIService] Extracted scenario question: "${question.substring(0, 50)}..."`);
        }
      }
      
      if (wyrMatch && wyrMatch[1]) {
        const question = wyrMatch[1].trim();
        if (question.length >= 20) {
          questions.wouldYouRather = [question];
          console.log(`[AIService] Extracted would you rather question: "${question.substring(0, 50)}..."`);
        }
      }
      
      if (pleadMatch && pleadMatch[1]) {
        const question = pleadMatch[1].trim();
        if (question.length >= 20) {
          questions.pleadForYourLife = [question];
          console.log(`[AIService] Extracted plead question: "${question.substring(0, 50)}..."`);
        }
      }
      
      if (escapeMatch && escapeMatch[1]) {
        const question = escapeMatch[1].trim();
        if (question.length >= 20) {
          questions.escape = [question];
          console.log(`[AIService] Extracted escape question: "${question.substring(0, 50)}..."`);
        }
      }

      // If we didn't get any properly formatted output, check if there are simply sections of text
      // we could use as questions (common with T5 models that may ignore formatting instructions)
      const allCategoriesEmpty = 
        questions.business.length === 0 && 
        questions.scenario.length === 0 && 
        questions.wouldYouRather.length === 0 && 
        questions.pleadForYourLife.length === 0 && 
        questions.escape.length === 0;
        
      if (allCategoriesEmpty) {
        console.log(`[AIService] Couldn't extract formatted questions, trying to extract plain text sections`);
        
        // Split by multiple newlines to separate potential questions
        const sections = text.split(/\n\s*\n/);
        if (sections.length >= 5) {
          const cleanSections = sections.map(s => s.trim()).filter(s => s.length >= 20);
          if (cleanSections.length >= 5) {
            questions.business = [cleanSections[0]];
            questions.scenario = [cleanSections[1]];
            questions.wouldYouRather = [cleanSections[2]];
            questions.pleadForYourLife = [cleanSections[3]];
            questions.escape = [cleanSections[4]];
            console.log(`[AIService] Extracted ${cleanSections.length} plain text questions`);
          }
        }
      }

      // Validate extracted questions
      let validCategories = 0;
      if (questions.business.length > 0) validCategories++;
      if (questions.scenario.length > 0) validCategories++;
      if (questions.wouldYouRather.length > 0) validCategories++;
      if (questions.pleadForYourLife.length > 0) validCategories++;
      if (questions.escape.length > 0) validCategories++;
      
      console.log(`[AIService] Successfully extracted ${validCategories}/5 valid questions`);
      
      if (validCategories < 3) {
        console.log(`[AIService] Not enough valid questions extracted, using more fallbacks`);
        // Start with default questions
        const result: CategoryQuestions = {
          business: defaultQuestions.business,
          scenario: defaultQuestions.scenario,
          wouldYouRather: defaultQuestions.wouldYouRather,
          pleadForYourLife: defaultQuestions.pleadForYourLife,
          escape: defaultQuestions.escape
        };
        
        // Replace with extracted questions where available
        if (questions.business.length > 0) result.business = questions.business;
        if (questions.scenario.length > 0) result.scenario = questions.scenario;
        if (questions.wouldYouRather.length > 0) result.wouldYouRather = questions.wouldYouRather;
        if (questions.pleadForYourLife.length > 0) result.pleadForYourLife = questions.pleadForYourLife;
        if (questions.escape.length > 0) result.escape = questions.escape;
        
        return result;
      }

      return questions;
    } catch (error) {
      console.error('[AIService] Error parsing questions from response:', error instanceof Error ? error.message : "Unknown error");
      return defaultQuestions;
    }
  }

  /**
   * Get a question for a specific category
   */
  static async generateQuestion(category: GameCategory): Promise<QuestionItem> {
    console.log(`[AIService] Generating question for category: ${category}`);
    
    try {
      // Initialize questionsCache if needed, but don't use it as the first option
      if (!questionsCache) {
        questionsCache = this.getHardcodedQuestions();
      }
      
      // Select random judging style and log it
      const judgingStyle: JudgingStyle = this.getRandomJudgingStyle();
      console.log(`[AIService] Selected judging style: ${judgingStyle}`);
      
      // Generate a question using the AI first - don't check cache until API fails
      console.log(`[AIService] Attempting to generate fresh question via API`);
      const prompt = this.createPromptForCategory(category);
      
      try {
        // Make the API call with retry logic - try up to 3 times with exponential backoff
        let attempt = 0;
        const maxAttempts = 3;
        let lastError: Error | null = null;
        
        while (attempt < maxAttempts) {
          attempt++;
          try {
            console.log(`[AIService] API attempt ${attempt}/${maxAttempts}`);
            const aiResponse = await this.makeApiCall(prompt);
            
            // Extract a well-formed question from the AI response
            const question = this.extractQuestionFromResponse(aiResponse, category);
            
            if (question && question.length > 10) {
              // If we got a valid question, update the cache
              if (!questionsCache[category]) {
                questionsCache[category] = [];
              }
              questionsCache[category].push(question);
              
              console.log(`[AIService] Generated fresh question for ${category}: "${question.substring(0, 30)}..."`);
              return {
                questionText: question,
                judgingStyle
              };
            } else {
              console.warn(`[AIService] Invalid question generated: "${question}"`);
              throw new Error(`Invalid question generated: "${question}"`);
            }
          } catch (error) {
            console.error(`[AIService] Attempt ${attempt} failed:`, error);
            lastError = error instanceof Error ? error : new Error(String(error));
            
            // If not the last attempt, wait before retrying
            if (attempt < maxAttempts) {
              const backoffMs = Math.pow(2, attempt) * 1000;
              console.log(`[AIService] Retrying in ${backoffMs}ms...`);
              await new Promise(resolve => setTimeout(resolve, backoffMs));
            }
          }
        }
        
        // If we got here, all API attempts failed - NOW try cached questions
        console.log(`[AIService] All API attempts failed, checking for cached questions`);
        
        // Check if we have cached questions for this category as a fallback
        const cachedQuestionsForCategory = questionsCache[category];
        if (cachedQuestionsForCategory && cachedQuestionsForCategory.length > 0) {
          console.log(`[AIService] Falling back to ${cachedQuestionsForCategory.length} cached questions for ${category}`);
          const randomIndex = Math.floor(Math.random() * cachedQuestionsForCategory.length);
          const selectedQuestion = cachedQuestionsForCategory[randomIndex];
          console.log(`[AIService] Selected cached question: "${selectedQuestion.substring(0, 30)}..."`);
          return {
            questionText: selectedQuestion,
            judgingStyle
          };
        }
        
        // If no cached questions either, throw the original error
        throw lastError || new Error('All API attempts failed for unknown reasons');
      } catch (error) {
        console.error(`[AIService] Error getting AI questions:`, error);
        // Fall back to hardcoded questions
        return this.getFallbackQuestion(category, judgingStyle);
      }
    } catch (error) {
      console.error(`[AIService] Uncaught error in generateQuestion:`, error);
      // Emergency fallback
      const fallbackQuestion = {
        questionText: `If you were stranded on a desert island with only three items, what would they be and why?`,
        judgingStyle: 'creativity' as JudgingStyle
      };
      return fallbackQuestion;
    }
  }

  private static extractQuestionFromResponse(response: string, category: GameCategory): string {
    try {
      // Log a preview of the response for debugging
      console.log(`[AIService] Extracting question from response (${response.length} chars): "${response.substring(0, 100)}..."`);
      
      // Try to find a direct question in the response
      const questionRegex = /([^.!?]*\?)/g;
      const matches = [...response.matchAll(questionRegex)];
      
      if (matches.length > 0) {
        // Find the longest question that includes a "you" or "your" reference
        const candidateQuestions = matches
          .map(m => m[1].trim())
          .filter(q => q.length > 15); // Filter out very short questions
        
        // Sort by relevance and length (prioritize questions with "you/your" and longer questions)
        const sortedQuestions = candidateQuestions.sort((a, b) => {
          const aHasYou = a.toLowerCase().includes('you');
          const bHasYou = b.toLowerCase().includes('you');
          
          if (aHasYou && !bHasYou) return -1;
          if (!aHasYou && bHasYou) return 1;
          
          // If both have or don't have "you", sort by length (prefer longer)
          return b.length - a.length;
        });
        
        if (sortedQuestions.length > 0) {
          return sortedQuestions[0];
        }
      }
      
      // If no good question found, just return the first section of text that looks reasonable
      const cleanedResponse = response
        .replace(/^.*?:/, '') // Remove any prefix like "Question:"
        .trim()
        .replace(/^\s*["']|["']\s*$/g, ''); // Remove surrounding quotes
      
      // Ensure it ends with a question mark
      return cleanedResponse.endsWith('?') 
        ? cleanedResponse 
        : `${cleanedResponse}?`;
    } catch (error) {
      console.error('[AIService] Error extracting question:', error);
      // Return a cleaned version of the original response
      return response.trim().replace(/^.*?:/, '').trim();
    }
  }

  /**
   * Get fallback questions for all categories
   */
  private static getFallbackQuestions(): CategoryQuestions {
    console.log('[AIService] Using fallback questions');
    return {
      business: [
        "You are homeless with no ID. You need to make $2,000 in a day and have a good outcome. What would you do?"
      ],
      scenario: [
        "You wake up one morning to find you can understand and speak to animals, but only for 24 hours. How do you spend your day?"
      ],
      wouldYouRather: [
        "Would you rather have to sing everything you want to say or dance everywhere you go? Explain your choice."
      ],
      pleadForYourLife: [
        "You've been captured by aliens who are deciding whether to experiment on you or let you go. You have 30 seconds to convince them of your value. What do you say?"
      ],
      escape: [
        "You wake up locked in a windowless room with only a desk, a chair, a pen, and an old computer that's not connected to the internet. How do you escape?"
      ]
    };
  }

  /**
   * Clear the questions cache to force fetching new questions
   */
  static clearCache(): void {
    console.log('[AIService] Clearing questions cache');
    questionsCache = null;
  }

  /**
   * Create a prompt for judging answers
   */
  private static createJudgingPrompt(
    category: GameCategory,
    judgingStyle: JudgingStyle,
    question: string,
    answers: Record<string, string>
  ): string {
    // Convert player IDs to simple numbers for the prompt
    const players = Object.keys(answers);
    const numberedAnswers = players.map((playerId, index) => {
      return `Player ${index + 1}: ${answers[playerId]}`;
    });
    
    return `You are judging answers for a party game. Select the best answer(s) based on ${judgingStyle}.

QUESTION: ${question}
CATEGORY: ${category}
JUDGING CRITERIA: ${judgingStyle}

ANSWERS:
${numberedAnswers.join('\n')}

Your response must strictly follow this format:
WINNER: Player [number]
or if it's a tie:
TIE: Player [number] and Player [number]

Then explain your decision in 2-3 sentences.`;
  }

  /**
   * Judge answers based on the category and judging style
   */
  static async judgeAnswers(
    category: GameCategory, 
    judgingStyle: JudgingStyle,
    question: string, 
    answers: Record<string, string>
  ): Promise<AIJudgingResult> {
    console.log(`[AIService] Judging answers for question: "${question.substring(0, 50)}..."`);
    console.log(`[AIService] Category: ${category}, Judging style: ${judgingStyle}`);
    console.log(`[AIService] Total answers: ${Object.keys(answers).length}`);
    
    const playerIds = Object.keys(answers);
    
    if (playerIds.length === 0) {
      console.log(`[AIService] No answers submitted, returning empty winners array`);
      return {
        winners: [],
        explanation: 'No answers were submitted.'
      };
    }
    
    // If there's only one player, they automatically win
    if (playerIds.length === 1) {
      console.log(`[AIService] Only one answer submitted, automatic win for player ${playerIds[0]}`);
      return {
        winners: [playerIds[0]],
        explanation: `${answers[playerIds[0]]} was the only answer submitted and wins by default.`
      };
    }
    
    // Use AI judging if available
    if (isUsingAiJudging && apiCallsInCurrentSession < MAX_API_CALLS_PER_SESSION) {
      try {
        console.log('[AIService] Using AI to judge answers');
        
        // Create judging prompt
        const prompt = this.createJudgingPrompt(category, judgingStyle, question, answers);
        
        // Call Gemini API
        const generatedText = await this.makeApiCall(prompt, 400);
        console.log("[AIService] Successfully received AI judgment");
        
        // Parse the AI's judging response
        const result = this.parseJudgingResponse(generatedText, playerIds, answers);
        
        return result;
      } catch (error) {
        console.error("[AIService] Error with AI judging:", error);
        console.log("[AIService] Falling back to random judging");
        
        // If we hit an API error, toggle to random judging for the rest of the session
        if (error instanceof Error && 
            (error.message.includes('API call limit') || 
             error.message.includes('rate limited'))) {
          isUsingAiJudging = false;
          console.log("[AIService] Switched to random judging for the remainder of the session");
        }
        
        // Fall back to random judging
        return this.randomJudging(playerIds, answers);
      }
    } else {
      console.log("[AIService] Using random judging (AI judging disabled or API limit reached)");
      return this.randomJudging(playerIds, answers);
    }
  }
  
  /**
   * Parse the AI's response to determine winners and explanation
   */
  private static parseJudgingResponse(
    text: string, 
    playerIds: string[], 
    answers: Record<string, string>
  ): AIJudgingResult {
    console.log('[AIService] Parsing AI judgment response');
    console.log(`[AIService] Full response text: "${text}"`);
    
    try {
      // Extract the winner line - more flexible patterns for T5 model
      const winnerMatch = text.match(/WINNER:?\s*(?:Player)?\s*(\d+)/i) || 
                          text.match(/(?:The\s)?winner\s(?:is|was)?\s*(?:Player)?\s*(\d+)/i);
                          
      const tieMatch = text.match(/TIE:?\s*(?:Player)?\s*(\d+)\s*and\s*(?:Player)?\s*(\d+)/i) ||
                       text.match(/(?:It's\s)?a\stie\sbetween\s*(?:Player)?\s*(\d+)\s*and\s*(?:Player)?\s*(\d+)/i);
      
      let winners: string[] = [];
      if (winnerMatch && winnerMatch[1]) {
        // Convert the player number back to the player ID
        const playerIndex = parseInt(winnerMatch[1]) - 1;
        if (playerIndex >= 0 && playerIndex < playerIds.length) {
          winners = [playerIds[playerIndex]];
          console.log(`[AIService] AI selected winner: Player ${playerIndex + 1} (ID: ${playerIds[playerIndex]})`);
        }
      } else if (tieMatch && tieMatch[1] && tieMatch[2]) {
        // Handle a tie between two players
        const playerIndex1 = parseInt(tieMatch[1]) - 1;
        const playerIndex2 = parseInt(tieMatch[2]) - 1;
        
        if (playerIndex1 >= 0 && playerIndex1 < playerIds.length &&
            playerIndex2 >= 0 && playerIndex2 < playerIds.length) {
          winners = [playerIds[playerIndex1], playerIds[playerIndex2]];
          console.log(`[AIService] AI declared tie between: Player ${playerIndex1 + 1} and Player ${playerIndex2 + 1}`);
        }
      }
      
      // If we couldn't parse the response or we're using a simple T5 model
      // that might just return a number, check if the entire response is just a number
      if (winners.length === 0) {
        const numberMatch = text.trim().match(/^(\d+)$/);
        if (numberMatch && numberMatch[1]) {
          const playerIndex = parseInt(numberMatch[1]) - 1;
          if (playerIndex >= 0 && playerIndex < playerIds.length) {
            winners = [playerIds[playerIndex]];
            console.log(`[AIService] Extracted player number directly: ${playerIndex + 1}`);
          }
        }
      }
      
      // If we still couldn't parse winners properly, fall back to random selection
      if (winners.length === 0) {
        console.log("[AIService] Couldn't parse winners from AI response, using random selection");
        return this.randomJudging(playerIds, answers);
      }
      
      // Extract the explanation - everything after the WINNER/TIE line or just use the whole text
      let explanationText = '';
      if (winnerMatch || tieMatch) {
        explanationText = text.replace(/WINNER:.*|TIE:.*/i, '').trim();
        // If the model just returned the winner designation, generate a simple explanation
        if (!explanationText) {
          explanationText = winners.length === 1 ? 
            `${answers[winners[0]]} provided the best answer.` :
            `${answers[winners[0]]} and ${answers[winners[1]]} provided equally good answers.`;
        }
      } else {
        // Use the whole text as explanation if we couldn't detect specific patterns
        explanationText = text.trim();
      }
      
      console.log(`[AIService] Extracted explanation: "${explanationText.substring(0, 100)}..."`);
      
      return {
        winners,
        explanation: explanationText
      };
    } catch (error) {
      console.error("[AIService] Error parsing judging response:", error instanceof Error ? error.message : "Unknown error");
      return this.randomJudging(playerIds, answers);
    }
  }
  
  /**
   * Fallback to random judging when AI judging fails
   */
  private static randomJudging(
    playerIds: string[],
    answers: Record<string, string>
  ): AIJudgingResult {
    console.log('[AIService] Using random judging as fallback');
    
    // Randomly determine if there will be a tie (20% chance)
    const isTie = Math.random() < 0.2 && playerIds.length > 1;
    
    let winners: string[];
    if (isTie) {
      // Select 2 random winners for a tie
      winners = this.getRandomElements(playerIds, 2);
      console.log(`[AIService] Randomly selected tie between players: ${winners.join(', ')}`);
    } else {
      // Select 1 random winner
      winners = [this.getRandomElement(playerIds)];
      console.log(`[AIService] Randomly selected winner: ${winners[0]}`);
    }
    
    const explanation = this.generateRandomExplanation(winners, answers);
    console.log(`[AIService] Generated random explanation: "${explanation.substring(0, 100)}..."`);
    
    return {
      winners,
      explanation
    };
  }
  
  /**
   * Generate a random explanation for why certain answers won
   */
  private static generateRandomExplanation(
    winners: string[], 
    answers: Record<string, string>
  ): string {
    const explanationPhrases = [
      "showed exceptional creativity and insight",
      "demonstrated incredible problem-solving skills",
      "presented a unique and compelling perspective",
      "combined humor and practicality in a brilliant way",
      "approached the challenge with remarkable originality"
    ];
    
    const phrase = this.getRandomElement(explanationPhrases);
    
    if (winners.length === 1) {
      const winner = winners[0];
      return `"${answers[winner]}" ${phrase}. The response stood out for its thoughtfulness and engaging approach.`;
    } else {
      const winnerTexts = winners.map(id => `"${answers[id]}"`).join(' and ');
      return `It was a tie between ${winnerTexts}. Both answers ${phrase} and were equally impressive in their approach to the challenge.`;
    }
  }
  
  /**
   * Get a random judging style
   */
  static getRandomJudgingStyle(): JudgingStyle {
    // Make sure to use the values from the imported type
    const styles: JudgingStyle[] = ['creativity', 'realism', 'humor', 'practicality', 'originality'];
    return this.getRandomElement(styles);
  }
  
  /**
   * Get a random element from an array
   */
  private static getRandomElement<T>(array: T[]): T {
    return array[Math.floor(Math.random() * array.length)];
  }
  
  /**
   * Get random elements from an array
   */
  private static getRandomElements<T>(array: T[], count: number): T[] {
    const shuffled = [...array].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, Math.min(count, shuffled.length));
  }
  
  /**
   * Reset API call counter - should be called when server restarts
   */
  static resetApiCallCounter(): void {
    apiCallsInCurrentSession = 0;
    isUsingAiJudging = true;
    console.log('[AIService] API call counter reset');
  }
  
  /**
   * Get current API usage stats
   */
  static getApiUsageStats(): {
    callsMade: number;
    maxCalls: number;
    aiJudgingEnabled: boolean;
  } {
    return {
      callsMade: apiCallsInCurrentSession,
      maxCalls: MAX_API_CALLS_PER_SESSION,
      aiJudgingEnabled: isUsingAiJudging
    };
  }

  private static getFallbackQuestion(category: GameCategory, judgingStyle: JudgingStyle): QuestionItem {
    const fallbackQuestions = this.getHardcodedQuestions();
    const questionsForCategory = fallbackQuestions[category] || [];
    
    if (questionsForCategory.length === 0) {
      console.log(`[AIService] No fallback questions for ${category}, using generic question`);
      return {
        questionText: "If you could have any superpower, what would it be and how would you use it?",
        judgingStyle
      };
    }
    
    const randomIndex = Math.floor(Math.random() * questionsForCategory.length);
    const selectedQuestion = questionsForCategory[randomIndex];
    console.log(`[AIService] Selected question for ${category}: "${selectedQuestion.substring(0, 50)}..."`);
    
    return {
      questionText: selectedQuestion,
      judgingStyle
    };
  }

  private static getHardcodedQuestions(): CategoryQuestions {
    return {
      business: [
        "You are homeless with no ID. You need to make $2,000 in a day and have a good outcome. What would you do?",
        "Your company is hours away from bankruptcy. You have $100 left in the business account. How do you save it?",
        "You need to start a profitable business with only $50. What business would you start and how?"
      ],
      scenario: [
        "You wake up one morning to find you can understand and speak to animals, but only for 24 hours. How do you spend your day?",
        "You discover a secret door in your house that leads to a parallel universe where everything is the same except one small detail. What is that detail and how do you react?",
        "You're given the ability to stop time for everyone except yourself for 1 hour each day. How would you use this power?"
      ],
      wouldYouRather: [
        "Would you rather have the ability to see 10 minutes into the future or be able to rewind time by 10 minutes once per day?",
        "Would you rather have unlimited money but be unable to spend it on yourself, or live exactly at your current means but with perfect health forever?",
        "Would you rather be able to teleport anywhere but arrive completely naked, or be able to fly but only 1 foot off the ground?"
      ],
      pleadForYourLife: [
        "You've been kidnapped by someone who will only let you go if you can make them laugh. What's your strategy?",
        "You've accidentally stepped through a portal to hell. Explain to the devil why he should send you back to Earth instead of keeping you.",
        "You've been sentenced to death for a crime you didn't commit. You have one minute to convince the judge to spare your life."
      ],
      escape: [
        "You're locked in a room with nothing but a rubber duck, a paperclip, and a shoe. How do you escape?",
        "You're trapped in a video game and must complete three increasingly difficult levels to escape. What game is it and how do you beat it?",
        "You wake up in a strange laboratory with no memory of how you got there. The door is locked and there's a ticking bomb. How do you escape?"
      ]
    };
  }

  /**
   * Create a prompt for a specific category
   */
  private static createPromptForCategory(category: GameCategory): string {
    console.log(`[AIService] Creating prompt for category: ${category}`);
    
    const prompts = {
      business: "Generate a business scenario question that uses clear language. Keep it brief and easy to understand.",
      
      scenario: "Create a hypothetical scenario using straightforward language. Keep it short and avoid overly complex vocabulary.",
      
      wouldYouRather: "Generate a 'Would you rather' question with two interesting choices. Use clear language anyone can understand.",
      
      pleadForYourLife: "Create a scenario where someone must convince another not to harm them. Use straightforward language and keep it brief.",
      
      escape: "Generate a scenario where someone must escape from a situation. Keep it concise and use clear language."
    };
    
    return prompts[category] || "Generate a concise question using clear, straightforward language.";
  }
} 