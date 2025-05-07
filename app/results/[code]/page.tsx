'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { IRoom } from '@/models/Room';

interface IGameState {
  currentRound: number;
  scores: Record<string, number>;
}

export default function ResultsPage() {
  const { code } = useParams();
  const router = useRouter();
  const [room, setRoom] = useState<IRoom | null>(null);
  const [gameState, setGameState] = useState<IGameState | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchResults = async () => {
      try {
        const response = await fetch(`/api/game/${code}/results`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to fetch results');
        }

        setRoom(data.room);
        setGameState(data.gameState);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch results');
      } finally {
        setIsLoading(false);
      }
    };

    fetchResults();
  }, [code]);

  const createNewGame = () => {
    router.push('/');
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
        <div className="text-xl">Results not found</div>
      </div>
    );
  }

  // Sort players by score
  const sortedPlayers = Object.entries(gameState.scores)
    .sort(([, scoreA], [, scoreB]) => scoreB - scoreA);

  return (
    <main className="min-h-screen p-8 bg-gray-50">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-md p-6">
          <h1 className="text-3xl font-bold mb-6 text-center">Game Results</h1>
          
          <div className="mb-8">
            <h2 className="text-xl font-semibold mb-4">Final Scores</h2>
            <div className="space-y-4">
              {sortedPlayers.map(([player, score], index) => (
                <div
                  key={player}
                  className={`p-4 rounded-lg ${
                    index === 0
                      ? 'bg-yellow-100 border-2 border-yellow-400'
                      : 'bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <span className="text-2xl font-bold text-gray-500">
                        #{index + 1}
                      </span>
                      <span className="font-medium text-lg">{player}</span>
                    </div>
                    <span className="text-2xl font-bold">{score}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="text-center">
            <button
              onClick={createNewGame}
              className="bg-indigo-600 text-white py-3 px-6 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              Play Again
            </button>
          </div>
        </div>
      </div>
    </main>
  );
} 