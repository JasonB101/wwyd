import { Player } from './player';

export interface Room {
  code: string;
  players: Player[];
  status: 'waiting' | 'playing' | 'finished';
  currentRound: number;
  scores: Record<string, number>;
  createdAt?: Date;
  updatedAt?: Date;
} 