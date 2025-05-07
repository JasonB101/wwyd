import mongoose from 'mongoose';
import { GameState, GameCategory, JudgingStyle } from '@/types/gameState';

interface IPlayer {
  id: string;
  nickname: string;
  isHost: boolean;
  isConnected: boolean;
}

interface IRoom {
  code: string;
  players: IPlayer[];
  status: 'waiting' | 'playing' | 'finished';
  currentRound: number;
  scores: { [key: string]: number };
  createdAt: Date;
  updatedAt: Date;
  gameState: GameState;
}

const PlayerSchema = new mongoose.Schema<IPlayer>({
  id: { type: String, required: true },
  nickname: { type: String, required: true },
  isHost: { type: Boolean, default: false },
  isConnected: { type: Boolean, default: true }
});

const roomSchema = new mongoose.Schema<IRoom>({
  code: { type: String, required: true, unique: true },
  players: [PlayerSchema],
  status: { type: String, enum: ['waiting', 'playing', 'finished'], default: 'waiting' },
  currentRound: { type: Number, default: 0 },
  scores: { type: Map, of: Number, default: {} },
  gameState: {
    status: { 
      type: String, 
      enum: ['waiting', 'category-selection', 'question-display', 'answering', 'judging', 'results', 'game-over'],
      default: 'waiting'
    },
    round: { type: Number, default: 0 },
    totalRounds: { type: Number, default: 5 },
    currentCategory: { 
      type: String, 
      enum: ['business', 'scenario', 'wouldYouRather', 'pleadForYourLife', 'escape'],
    },
    judgingStyle: {
      type: String,
      enum: ['creativity', 'realism', 'humor', 'practicality', 'originality']
    },
    question: { type: String },
    questionContext: { type: String },
    timeRemaining: { type: Number },
    answers: { type: Map, of: String, default: () => new Map() },
    judgingResult: {
      explanation: { type: String },
      winners: [{ type: String }]
    },
    scores: { type: Map, of: Number, default: () => new Map() },
    categorySelector: { type: String },
    categories: [{ 
      type: String, 
      enum: ['business', 'scenario', 'wouldYouRather', 'pleadForYourLife', 'escape']
    }],
    roundHistory: [{
      round: { type: Number },
      category: { 
        type: String, 
        enum: ['business', 'scenario', 'wouldYouRather', 'pleadForYourLife', 'escape'] 
      },
      question: { type: String },
      answers: { type: Map, of: String },
      winners: [{ type: String }],
      explanation: { type: String }
    }]
  }
}, { timestamps: true });

const Room = mongoose.models.Room || mongoose.model<IRoom>('Room', roomSchema);

export { Room, type IPlayer, type IRoom }; 