'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSocket } from '@/lib/hooks/useSocket';
import { Room } from '@/types/room';
import { Player } from '@/types/player';
import { Question } from '@/types/question';
import { Answer } from '@/types/answer';
import { GameState, GameCategory, JudgingStyle } from '@/types/gameState';
import { useAuth } from '@/lib/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Loader2, Users, Crown, Trophy, CheckCircle2, XCircle, PlayCircle, Timer, Award } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'react-hot-toast';
import { CopyIcon } from 'lucide-react';

/**
 * Format time in MM:SS format
 */
function formatTime(seconds: number): string {
  if (seconds <= 0) return "00:00";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

/**
 * Room Page Component
 * Displays the waiting room and game interface for a specific room code
 */
export default function RoomPage({ params }: { params: { code: string } }) {
  const router = useRouter();
  const { socket, isConnected } = useSocket();
  const { playerId, nickname, isHost: authIsHost } = useAuth(params.code);
  const [room, setRoom] = useState<Room | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [submittingAnswer, setSubmittingAnswer] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  // Fetch initial room data
  useEffect(() => {
    const fetchRoom = async () => {
      try {
        const response = await fetch(`/api/rooms?code=${params.code}`);
        if (!response.ok) {
          throw new Error('Failed to fetch room');
        }
        const data = await response.json();
        setRoom(data);

        // Set playerInfo in localStorage
        const storedPlayerId = localStorage.getItem(`room_${params.code}_playerId`);
        const storedNickname = localStorage.getItem(`room_${params.code}_nickname`);
        if (storedPlayerId && storedNickname) {
          const playerInfo = {
            playerId: storedPlayerId,
            roomCode: params.code,
            nickname: storedNickname
          };
          localStorage.setItem('playerInfo', JSON.stringify(playerInfo));
        } else {
          // If we don't have the player info, redirect to home
          console.log('No player info found, redirecting to home');
          router.push('/');
          return;
        }
      } catch (error) {
        setError('Failed to load room');
        console.error('Error fetching room:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchRoom();
  }, [params.code, router]);

  // Update host status when room data changes
  useEffect(() => {
    if (room && playerId) {
      const player = room.players.find(p => p.id === playerId);
      if (player) {
        console.log(`Setting host status to ${player.isHost} for player ${player.nickname}`);
        setIsHost(player.isHost);
      }
    }
  }, [room, playerId]);

  // Redirect to home if not joined
  useEffect(() => {
    if (!loading && (!playerId || !nickname)) {
      console.log('No player info found, redirecting to home');
      // First clean up any storage to prevent redirect loops
      localStorage.removeItem('playerInfo');
      localStorage.removeItem(`room_${params.code}_playerId`);
      localStorage.removeItem(`room_${params.code}_nickname`);
      router.push('/');
    }
  }, [loading, playerId, nickname, router, params.code]);

  // Set up socket event listeners
  useEffect(() => {
    if (!socket) return;

    // Handle errors
    socket.on('error', (errorMessage: string) => {
      console.error('Socket error received:', errorMessage);
      setError(errorMessage);
    });

    // Handle room updates
    socket.on('roomUpdate', (updatedRoom: Room) => {
      console.log('Room update received');
      setRoom(updatedRoom);
      
      // Update host status when room data changes
      if (playerId) {
        const player = updatedRoom.players.find(p => p.id === playerId);
        if (player) {
          console.log(`Room update: setting host status to ${player.isHost} for player ${player.nickname}`);
          setIsHost(player.isHost);
        } else {
          console.log('Warning: Player not found in updated room data');
        }
      }
    });

    // Handle being kicked from the room
    socket.on('kicked', (message: string) => {
      console.log('Kicked from room:', message);
      
      // Clean up localStorage
      localStorage.removeItem(`room_${params.code}_playerId`);
      localStorage.removeItem(`room_${params.code}_nickname`);
      localStorage.removeItem('playerInfo');
      
      // Show alert and redirect to home
      alert('You have been kicked from the room by the host.');
      router.push('/');
    });

    // Handle room ended
    socket.on('roomEnded', (message: string) => {
      console.log('Room ended:', message);
      // Clean up localStorage
      localStorage.removeItem(`room_${params.code}_playerId`);
      localStorage.removeItem(`room_${params.code}_nickname`);
      localStorage.removeItem('playerInfo');
      // Redirect to home
      router.push('/');
    });

    // Handle game events
    socket.on('gameStarted', (gameState: GameState) => {
      console.log('Game started', gameState);
      setGameState(gameState);
    });

    socket.on('roundStarted', (gameState: GameState) => {
      console.log('Round started', gameState);
      setGameState(gameState);
    });

    socket.on('questionReady', (gameState: GameState) => {
      console.log('Question ready', gameState);
      setGameState(gameState);
    });

    socket.on('answeringStarted', () => {
      console.log('Answering started');
      // Ensure current answer is cleared at the start of answering phase
      setCurrentAnswer('');
      setSubmittingAnswer(false);
    });

    socket.on('timeUpdate', (timeRemaining: number) => {
      console.log(`Time update received: ${timeRemaining} seconds remaining`);
      setTimeLeft(timeRemaining);
    });

    socket.on('answerRecorded', (answeredPlayerId: string) => {
      console.log('Answer recorded for player', answeredPlayerId);
      if (answeredPlayerId === playerId) {
        setSubmittingAnswer(false);
      }
    });

    socket.on('answerCountUpdate', (data: { count: number; total: number }) => {
      console.log(`Answers received: ${data.count}/${data.total}`);
    });

    socket.on('judgingStarted', () => {
      console.log('Judging started');
    });

    socket.on('judgingComplete', (data: { judgingResult: any; scores: Record<string, number> }) => {
      console.log('Judging complete', data);
    });

    socket.on('gameOver', (gameState: GameState) => {
      console.log('Game over', gameState);
      setGameState(gameState);
    });

    return () => {
      // Clean up event listeners
      socket.off('roomUpdate');
      socket.off('roomEnded');
      socket.off('gameStarted');
      socket.off('roundStarted');
      socket.off('questionReady');
      socket.off('answeringStarted');
      socket.off('timeUpdate');
      socket.off('answerRecorded');
      socket.off('answerCountUpdate');
      socket.off('judgingStarted');
      socket.off('judgingComplete');
      socket.off('gameOver');
      socket.off('kicked');
      socket.off('error');
    };
  }, [socket, params.code, router]);

  // Effect to sync timer state with game state
  useEffect(() => {
    // Only run if we have a valid game state
    if (!room?.gameState) return;
    
    const { status, timeRemaining } = room.gameState;
    console.log(`Game status changed to: ${status}, time remaining: ${timeRemaining || 'none'}`);
    
    // Initialize timeLeft based on game state when in 'answering' status
    if (status === 'answering' && typeof timeRemaining === 'number') {
      console.log(`Initializing timer to ${timeRemaining} seconds from game state`);
      setTimeLeft(timeRemaining);
    } else if (status !== 'answering') {
      // Reset timer for other states
      setTimeLeft(0);
    }
    
    // If status changed from 'answering' to 'results', set showResults to true
    if (status === 'results') {
      console.log('Game state changed to results, showing results screen');
      setShowResults(true);
    } else {
      setShowResults(false);
    }
  }, [room?.gameState?.status, room?.gameState?.timeRemaining]);
  
  // Socket event listener for time updates
  useEffect(() => {
    if (!socket) return;
    
    const handleTimeUpdate = (seconds: number) => {
      console.log(`Time update received: ${seconds}s remaining`);
      setTimeLeft(seconds);
      
      // If time reaches zero, prepare for transition to results
      if (seconds === 0) {
        console.log('Timer reached zero, preparing for results view');
        // We don't immediately set showResults here as we wait for the server
        // to send the state update with status 'results'
      }
    };
    
    socket.on('timeUpdate', handleTimeUpdate);
    
    return () => {
      socket.off('timeUpdate', handleTimeUpdate);
    };
  }, [socket]);

  /**
   * Event Handlers
   */
  const handleStartGame = async () => {
    if (!socket) return;
    socket.emit('startGame');
  };

  const handleSelectCategory = async (category: GameCategory) => {
    if (!socket) return;
    console.log(`Selecting category: ${category}`);
    socket.emit('selectCategory', category);
  };

  const handleSubmitAnswer = async () => {
    if (!socket || !currentAnswer.trim()) return;
    setSubmittingAnswer(true);
    try {
      socket.emit('submitAnswer', currentAnswer.trim());
      setCurrentAnswer('');
    } catch (error) {
      console.error('Error submitting answer:', error);
    } finally {
      setSubmittingAnswer(false);
    }
  };

  const handleNextRound = async () => {
    if (!socket) return;
    socket.emit('nextRound');
  };

  const handleKickPlayer = (playerId: string) => {
    if (!socket) return;
    console.log(`Kicking player: ${playerId}`);
    socket.emit('kickPlayer', playerId);
  };

  const handleLeaveRoom = async () => {
    console.log('Leaving room');
    
    try {
      // Clean up localStorage first
      localStorage.removeItem('playerInfo');
      localStorage.removeItem(`room_${params.code}_playerId`);
      localStorage.removeItem(`room_${params.code}_nickname`);

      // If socket is connected, emit leave event
      if (socket && socket.connected) {
        socket.emit('leaveRoom', params.code);
        socket.disconnect();
      }

      // Redirect to home page
      router.push('/');
    } catch (error) {
      console.error('Error leaving room:', error);
      // Even if there's an error, try to clean up and redirect
      router.push('/');
    }
  };

  /**
   * Render UI
   */
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-red-500">{error}</p>
        <Button onClick={() => router.push('/')}>Return Home</Button>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p>Room not found</p>
        <Button onClick={() => router.push('/')}>Return Home</Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4">
      <div className="flex flex-col gap-4">
        {/* Game UI */}
        {room?.status === 'playing' ? (
          // Game Layout
          <div className="w-full max-w-md mx-auto flex flex-col gap-4">
            {/* Game status */}
            <Card className="p-6">
              {showResults ? (
                // Results view
                <div className="text-center">
                  <h2 className="text-2xl font-bold mb-4">Results</h2>
                  {room?.gameState?.currentRound ? (
                    <div>
                      <p className="mb-2 text-lg">Round {room.gameState.currentRound} / {room.rounds}</p>
                      <div className="my-4">
                        <h3 className="font-semibold text-lg mb-2">Question:</h3>
                        <p className="text-lg">{room.gameState.currentQuestion}</p>
                      </div>
                      <div className="my-4">
                        <h3 className="font-semibold text-lg mb-2">Answers:</h3>
                        <ul className="space-y-2">
                          {room.gameState.playerAnswers && Object.entries(room.gameState.playerAnswers).map(([playerId, answer]) => {
                            const playerName = room.players.find(p => p.id === playerId)?.nickname || 'Unknown';
                            const points = room.gameState?.points?.[playerId] || 0;
                            return (
                              <li key={playerId} className="p-3 bg-gray-100 rounded-lg flex justify-between items-center">
                                <span><strong>{playerName}:</strong> {answer}</span>
                                <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-sm">
                                  {points} pts
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                      {isHost && (
                        <Button 
                          className="w-full mt-4" 
                          size="lg"
                          onClick={handleNextRound}
                          disabled={loading}
                        >
                          {loading ? 'Loading...' : room.gameState.currentRound >= room.rounds ? 'Show Final Results' : 'Next Question'}
                        </Button>
                      )}
                    </div>
                  ) : (
                    <p className="text-gray-500">Waiting for results...</p>
                  )}
                </div>
              ) : (
                // Question and answer view
                <div>
                  {room?.gameState?.currentQuestion ? (
                    <div className="text-center">
                      <div className="mb-4">
                        <h2 className="text-2xl font-bold mb-2">Round {room.gameState.currentRound} / {room.rounds}</h2>
                        <p className="text-lg">{room.gameState.currentQuestion}</p>
                      </div>
                      {/* Timer display */}
                      {timeLeft !== null && (
                        <div className="mb-6">
                          <div className="flex justify-center items-center space-x-2 mb-2">
                            <span className="text-2xl font-bold">{formatTime(timeLeft)}</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2.5">
                            <div 
                              className={`h-2.5 rounded-full ${
                                timeLeft > 60 ? 'bg-green-600' : 
                                timeLeft > 30 ? 'bg-yellow-500' : 
                                'bg-red-600'
                              }`}
                              style={{ width: `${Math.min(100, (timeLeft / 180) * 100)}%` }}
                            ></div>
                          </div>
                        </div>
                      )}
                      <div className="mt-4">
                        <textarea
                          className="w-full p-3 border rounded-md min-h-[100px]"
                          placeholder="Type your answer here..."
                          value={currentAnswer}
                          onChange={(e) => setCurrentAnswer(e.target.value)}
                          disabled={submittingAnswer}
                        />
                        <Button 
                          className="w-full mt-2" 
                          onClick={handleSubmitAnswer}
                          disabled={!currentAnswer.trim() || submittingAnswer}
                        >
                          {submittingAnswer ? 'Submitting...' : 'Submit Answer'}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center p-6">
                      <h2 className="text-xl font-bold mb-2">Waiting for the host to start the game...</h2>
                      <div className="animate-pulse mt-4">
                        <div className="h-4 bg-gray-200 rounded w-3/4 mx-auto mb-2.5"></div>
                        <div className="h-4 bg-gray-200 rounded mx-auto"></div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>
            
            {/* Player List */}
            <Card className="p-6">
              <h2 className="text-xl font-bold mb-4">Players</h2>
              {room.players.length > 0 ? (
                <ul className="space-y-2">
                  {room.players.map(player => {
                    const points = room.gameState?.points?.[player.id] || 0;
                    const isCurrentPlayer = player.id === playerId;
                    return (
                      <li 
                        key={player.id} 
                        className={`p-3 rounded-lg flex justify-between items-center ${
                          isCurrentPlayer ? 'bg-blue-100' : 'bg-gray-100'
                        }`}
                      >
                        <span className="font-medium">
                          {player.nickname} 
                          {isCurrentPlayer ? ' (You)' : ''} 
                          {player.isHost ? ' (Host)' : ''}
                        </span>
                        <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-sm">
                          {points} pts
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-gray-500">No players have joined yet.</p>
              )}
            </Card>
          </div>
        ) : (
          // Waiting Room Layout
          <div className="max-w-md mx-auto flex flex-col gap-4">
            {/* Room Details */}
            <Card className="p-6">
              <h2 className="text-xl font-bold mb-4">Room: {room?.code}</h2>
              <p className="mb-4">Share this code with friends to join your game.</p>
              <div className="flex items-center gap-2 bg-gray-100 p-3 rounded-md mb-4">
                <pre className="font-medium text-lg flex-grow">{room?.code}</pre>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(room?.code || '');
                    toast.success('Room code copied to clipboard');
                  }}
                >
                  <CopyIcon className="h-4 w-4" />
                </Button>
              </div>
              <div className="mb-4">
                <p className="font-medium">Game Type: <span className="text-blue-600">{room?.gameType}</span></p>
                <p className="font-medium">Rounds: <span className="text-blue-600">{room?.rounds}</span></p>
              </div>
            </Card>
            
            {/* Player List */}
            <Card className="p-6">
              <h2 className="text-xl font-bold mb-4">Players</h2>
              {room?.players && room.players.length > 0 ? (
                <ul className="space-y-2">
                  {room.players.map(player => (
                    <li 
                      key={player.id} 
                      className={`p-3 ${player.id === playerId ? 'bg-blue-100' : 'bg-gray-100'} rounded-lg flex justify-between items-center`}
                    >
                      <span className="font-medium">
                        {player.nickname} 
                        {player.id === playerId ? ' (You)' : ''} 
                        {player.isHost ? ' (Host)' : ''}
                      </span>
                      <span className={`px-2 py-1 ${player.connected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'} rounded-full text-xs`}>
                        {player.connected ? 'Connected' : 'Disconnected'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-500">No players have joined yet.</p>
              )}
            </Card>

            {/* Game Controls for Waiting Room - Now at the top */}
            {isHost && room?.status === 'waiting' && (
              <Card className="p-6">
                <h2 className="text-xl font-bold mb-4">Host Controls</h2>
                <Button 
                  className="w-full" 
                  size="lg"
                  onClick={handleStartGame}
                  disabled={loading || !room?.players || room.players.length < 2}
                >
                  {loading ? 'Starting Game...' : 'Begin Game'}
                </Button>
                {room?.players && room.players.length < 2 && (
                  <p className="mt-2 text-sm text-amber-600">
                    You need at least 2 players to start the game.
                  </p>
                )}
              </Card>
            )}
          </div>
        )}

        {/* Debug information - Now with Force Refresh button */}
        {process.env.NODE_ENV === 'development' && (
          <Card className="p-4 mt-4 bg-yellow-50 text-xs w-full max-w-md mx-auto">
            <h3 className="font-bold mb-2">Debug Info</h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p><span className="font-medium">isHost:</span> {isHost ? 'true' : 'false'}</p>
                <p><span className="font-medium">room.status:</span> {room?.status}</p>
                <p><span className="font-medium">gameState.status:</span> {room?.gameState?.status || 'none'}</p>
                <p><span className="font-medium">showButton:</span> {isHost && room?.status === 'waiting' ? 'true' : 'false'}</p>
                <p><span className="font-medium">socket connected:</span> {socket?.connected ? 'true' : 'false'}</p>
                <p><span className="font-medium">playerId:</span> {playerId?.substring(0, 8)}...</p>
              </div>
              <div>
                <p><span className="font-medium">timeLeft state:</span> {timeLeft !== null ? timeLeft : 'null'}</p>
                <p><span className="font-medium">gameState.timeRemaining:</span> {room?.gameState?.timeRemaining ?? 'null'}</p>
                <p><span className="font-medium">showResults:</span> {showResults ? 'true' : 'false'}</p>
                <p><span className="font-medium">currentAnswer:</span> {currentAnswer || 'none'}</p>
                <p><span className="font-medium">submittingAnswer:</span> {submittingAnswer ? 'true' : 'false'}</p>
                <p><span className="font-medium">error:</span> {error || 'none'}</p>
              </div>
            </div>
            <Button 
              onClick={() => window.location.reload()} 
              className="mt-2 bg-blue-500 text-white text-xs py-1"
              size="sm"
            >
              Force Refresh
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
} 