import { Question } from './question';

export type GameCategory = 'business' | 'scenario' | 'wouldYouRather' | 'pleadForYourLife' | 'escape';

export type JudgingStyle = 'creativity' | 'realism' | 'humor' | 'practicality' | 'originality';

export interface GameState {
  status: 'waiting' | 'category-selection' | 'question-display' | 'answering' | 'judging' | 'results' | 'game-over';
  round: number;
  totalRounds: number;
  currentCategory?: GameCategory;
  judgingStyle?: JudgingStyle;
  question?: string;
  questionContext?: string;
  timeRemaining?: number;
  answers: Record<string, string>; // playerId -> answer
  judgingResult?: {
    explanation: string;
    winners: string[]; // playerIds
  };
  scores: Record<string, number>; // playerId -> score
  categorySelector?: string; // playerId of player selecting category
  categories?: GameCategory[]; // Available categories
  roundHistory: {
    round: number;
    category: GameCategory;
    question: string;
    answers: Record<string, string>;
    winners: string[];
    explanation: string;
  }[];
} 