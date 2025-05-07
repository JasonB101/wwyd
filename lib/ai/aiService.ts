import { GameCategory, JudgingStyle } from '@/types/gameState';

/**
 * AI Service for handling AI-related functionality
 * Using Hugging Face or similar service to generate questions and judge answers
 */

interface AIJudgingResult {
  winners: string[];
  explanation: string;
}

// For now, using a simple implementation that mocks AI responses
// To be replaced with actual API call to AI service
export class AIService {
  /**
   * Generate a question based on the category
   */
  static async generateQuestion(category: GameCategory): Promise<{ question: string; context?: string }> {
    console.log(`Generating question for category: ${category}`);
    
    // Generate a random judging style for this question
    const judgingStyle = this.getRandomJudgingStyle();
    
    // This would be replaced with an actual API call to AI service
    switch(category) {
      case 'business':
        return {
          question: `You are homeless with no ID. You need to make $2,000 in a day and have a good outcome. What would you do?`,
          context: `You will be judged on ${judgingStyle}.`
        };
      case 'scenario':
        return {
          question: `You are walking home from school and two lions approach. You have a backpack with books, a water bottle, and a smartphone. What do you do?`,
          context: `You will be judged on ${judgingStyle}.`
        };
      case 'wouldYouRather':
        return {
          question: `Would you rather have to sing everything you want to say or dance everywhere you go? Explain your choice.`,
          context: `You will be judged on ${judgingStyle}.`
        };
      case 'pleadForYourLife':
        return {
          question: `You've been captured by aliens who are deciding whether to experiment on you or let you go. You have 30 seconds to convince them of your value. What do you say?`,
          context: `You will be judged on ${judgingStyle}.`
        };
      case 'escape':
        return {
          question: `You wake up locked in a windowless room with only a desk, a chair, a pen, and an old computer that's not connected to the internet. How do you escape?`,
          context: `You will be judged on ${judgingStyle}.`
        };
      default:
        return {
          question: `Generic question for ${category}`,
          context: `You will be judged on ${judgingStyle}.`
        };
    }
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
    console.log(`Judging answers for question: ${question} based on ${judgingStyle}`);
    
    // This would be replaced with an actual API call to AI service
    // For now, we'll simulate AI by picking a random winner
    const playerIds = Object.keys(answers);
    
    if (playerIds.length === 0) {
      return {
        winners: [],
        explanation: 'No answers were submitted.'
      };
    }
    
    // Randomly determine if there will be a tie (20% chance)
    const isTie = Math.random() < 0.2;
    
    let winners: string[];
    if (isTie && playerIds.length > 1) {
      // Select 2 random winners for a tie
      winners = this.getRandomElements(playerIds, 2);
    } else {
      // Select 1 random winner
      winners = [this.getRandomElement(playerIds)];
    }
    
    return {
      winners,
      explanation: this.generateExplanation(category, judgingStyle, winners, answers)
    };
  }
  
  /**
   * Generate a fake explanation for why certain answers won
   */
  private static generateExplanation(
    category: GameCategory, 
    judgingStyle: JudgingStyle,
    winners: string[], 
    answers: Record<string, string>
  ): string {
    if (winners.length === 0) return 'No answers were submitted.';
    
    if (winners.length === 1) {
      const winner = winners[0];
      return `${answers[winner]} was judged to be the best answer based on ${judgingStyle}. The response showed exceptional problem-solving abilities and creative thinking.`;
    } else {
      const winnerTexts = winners.map(id => `"${answers[id]}"`).join(' and ');
      return `There was a tie between ${winnerTexts}. Both answers demonstrated outstanding ${judgingStyle} and were equally impressive in their approach to the problem.`;
    }
  }
  
  /**
   * Get a random judging style
   */
  static getRandomJudgingStyle(): JudgingStyle {
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
} 