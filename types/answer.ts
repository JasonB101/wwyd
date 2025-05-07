export interface Answer {
  questionId: string;
  playerId: string;
  text: string;
  isCorrect?: boolean;
  timestamp: number;
} 