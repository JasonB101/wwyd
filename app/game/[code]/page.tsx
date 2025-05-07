'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSocket } from '@/lib/hooks/useSocket';
import type { IRoom } from '@/models/Room';

interface IGameState {
  currentRound: number;
  currentQuestion: string;
  currentAnswers: Array<{
    player: string;
    answer: string;
  }>;
  scores: Record<string, number>;
  status: 'waiting' | 'answering' | 'judging' | 'finished';
  timeLeft?: number;
}

const ANSWER_TIMEOUT = 60; // 60 seconds for answering
const JUDGE_TIMEOUT = 30; // 30 seconds for judging

export default function GamePage() {
  const { code } = useParams();
  const router = useRouter();
  const { socket, isConnected, error: socketError } = useSocket(code as string);
  const [room, setRoom] = useState<IRoom | null>(null);
  const [gameState, setGameState] = useState<IGameState | null>(null);
  const [answer, setAnswer] = useState('');
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  // Handle disconnection
  useEffect(() => {
    if (!isConnected) {
      setError('Connection lost. Please refresh the page.');
    }
  }, [isConnected]);

  // Handle socket errors
  useEffect(() => {
    if (socketError) {
      setError(socketError);
    }
  }, [socketError]);

  // Timer effect
  useEffect(() => {
    if (!gameState || !timeLeft) return;

    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev === null || prev <= 0) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [gameState, timeLeft]);

  // Update timer when game state changes
  useEffect(() => {
    if (!gameState) return;

    switch (gameState.status) {
      case 'answering':
        setTimeLeft(ANSWER_TIMEOUT);
        break;
      case 'judging':
        setTimeLeft(JUDGE_TIMEOUT);
        break;
      default:
        setTimeLeft(null);
    }
  }, [gameState?.status]);

  const fetchGameState = useCallback(async () => {
    try {
      const response = await fetch(`/api/game/${code}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch game state');
      }

      setRoom(data.room);
      setGameState(data.gameState);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch game state');
    } finally {
      setIsLoading(false);
    }
  }, [code]);

  useEffect(() => {
    fetchGameState();
  }, [fetchGameState]);

  useEffect(() => {
    if (!socket) return;

    socket.on('gameStateUpdate', (newState: IGameState) => {
      setGameState(newState);
    });

    socket.on('gameFinished', () => {
      router.push(`/results/${code}`);
    });

    socket.on('playerDisconnected', () => {
      fetchGameState(); // Refresh game state when a player disconnects
    });

    return () => {
      socket.off('gameStateUpdate');
      socket.off('gameFinished');
      socket.off('playerDisconnected');
    };
  }, [socket, code, router, fetchGameState]);

  const submitAnswer = async () => {
    if (!answer.trim()) return;

    try {
      const response = await fetch(`/api/game/${code}/answer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ answer: answer.trim() }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to submit answer');
      }

      setAnswer('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit answer');
    }
  };

  const submitJudgment = async (selectedAnswer: string) => {
    try {
      const response = await fetch(`/api/game/${code}/judge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ selectedAnswer }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to submit judgment');
      }

      setSelectedAnswer(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit judgment');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl text-red-600">{error}</div>
      </div>
    );
  }

  if (!room || !gameState) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">Game not found</div>
      </div>
    );
  }

  return (
    <main className="min-h-screen p-8 bg-gray-50">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="mb-6">
            <h1 className="text-3xl font-bold mb-2">Round {gameState.currentRound}</h1>
            <p className="text-gray-600">Room Code: {code}</p>
            {timeLeft !== null && (
              <p className="text-sm text-gray-500 mt-2">
                Time left: {timeLeft} seconds
              </p>
            )}
          </div>

          <div className="mb-8">
            <h2 className="text-xl font-semibold mb-4">Current Question</h2>
            <p className="text-lg">{gameState.currentQuestion}</p>
          </div>

          {gameState.status === 'answering' && (
            <div className="mb-8">
              <h2 className="text-xl font-semibold mb-4">Your Answer</h2>
              <div className="flex gap-4">
                <input
                  type="text"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder="Type your answer..."
                  className="flex-1 p-2 border rounded-md"
                  disabled={timeLeft === 0}
                />
                <button
                  onClick={submitAnswer}
                  disabled={!answer.trim() || timeLeft === 0}
                  className="bg-indigo-600 text-white py-2 px-4 rounded-md hover:bg-indigo-700 disabled:opacity-50"
                >
                  Submit
                </button>
              </div>
            </div>
          )}

          {gameState.status === 'judging' && (
            <div className="mb-8">
              <h2 className="text-xl font-semibold mb-4">Select the Best Answer</h2>
              <div className="space-y-4">
                {gameState.currentAnswers.map(({ player, answer }) => (
                  <button
                    key={player}
                    onClick={() => submitJudgment(answer)}
                    disabled={selectedAnswer === answer || timeLeft === 0}
                    className={`w-full p-4 text-left rounded-lg ${
                      selectedAnswer === answer
                        ? 'bg-indigo-100 border-2 border-indigo-400'
                        : 'bg-gray-50 hover:bg-gray-100'
                    } ${timeLeft === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <p className="font-medium">{player}</p>
                    <p className="text-gray-600">{answer}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mb-8">
            <h2 className="text-xl font-semibold mb-4">Scores</h2>
            <div className="space-y-2">
              {Object.entries(gameState.scores).map(([player, score]) => (
                <div
                  key={player}
                  className="flex justify-between items-center p-2 bg-gray-50 rounded"
                >
                  <span className="font-medium">{player}</span>
                  <span className="text-indigo-600 font-bold">{score}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
} 