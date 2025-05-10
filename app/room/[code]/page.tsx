// Add export const dynamic = 'force-dynamic' at the top of the file

'use client';

// Tell Next.js this is a dynamic route that should not be statically generated
export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
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
import { GetRoom } from '@/types/apiTypes';

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
  const { socket, isConnected, reconnect, leaveRoom } = useSocket();
  const [room, setRoom] = useState<Room | null>(null);
  const { playerId, nickname, isHost, setPlayerId, setIsHost } = useAuth(params.code, room);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [submittingAnswer, setSubmittingAnswer] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [answerCount, setAnswerCount] = useState<{count: number, total: number}>({count: 0, total: 0});
  const [judgingTimeout, setJudgingTimeout] = useState<number | null>(null);
  const [gameResults, setGameResults] = useState<any>(null);
  
  // Environment flags for debug panel
  const isProduction = process.env.NODE_ENV === 'production';
  const isLocal = process.env.NODE_ENV === 'development';

  // Helper functions
  const fetchRoom = async (code: string) => {
    try {
      const response = await fetch(`/api/rooms?code=${code}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Failed to fetch room');
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching room:', error);
      return null;
    }
  };

  // Force refresh the game state
  const forceRefreshGameState = useCallback(async () => {
    console.log("Forcing game state refresh");
    setLoading(true);
    try {
      const freshRoom = await fetchRoom(params.code);
      if (freshRoom) {
        console.log("Fresh room state:", freshRoom.gameState?.status);
        setRoom(freshRoom);
      }
    } catch (error) {
      console.error("Error refreshing game state:", error);
    } finally {
      setLoading(false);
    }
  }, [params.code]);

  // Fetch initial room data
  useEffect(() => {
    const loadRoom = async () => {
      setLoading(true);
      try {
        const data = await fetchRoom(params.code);
        if (data) {
          setRoom(data);
          console.log('Initial room data loaded, state:', data.gameState?.status);
          
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
            console.log('No player info found during fetch, redirecting to home');
            router.push('/');
            return;
          }
        } else {
          setError('Failed to load room');
        }
      } catch (error) {
        console.error('Error in loadRoom:', error);
        setError('Failed to load room');
      } finally {
        setLoading(false);
      }
    };
    
    loadRoom();
  }, [params.code, router]);

  // Redirect to home if not joined
  useEffect(() => {
    // Skip this check during initial loading
    if (loading) return;
    
    const storedPlayerId = localStorage.getItem(`room_${params.code}_playerId`);
    const storedNickname = localStorage.getItem(`room_${params.code}_nickname`);
    
    // Only redirect if we have no player data at all
    if (!storedPlayerId || !storedNickname) {
      console.log('No player info found in storage, redirecting to home');
      // First clean up any storage to prevent redirect loops
      localStorage.removeItem('playerInfo');
      localStorage.removeItem(`room_${params.code}_playerId`);
      localStorage.removeItem(`room_${params.code}_nickname`);
      router.push('/');
    }
  }, [loading, router, params.code]);

  // Socket events
  useEffect(() => {
    if (!socket) return;

    // Consolidated socket event handler for all game state updates
    const handleSocketEvents = () => {
      // Enhanced room update handler with detailed logging
      const handleRoomUpdate = (updatedRoom: Room) => {
        console.log(`Room update received, game state: ${updatedRoom.gameState?.status}`);
        
        // Check if game state has changed
        if (room?.gameState?.status !== updatedRoom.gameState?.status) {
          console.log(`Game state transition: ${room?.gameState?.status || 'none'} -> ${updatedRoom.gameState?.status}`);
        }
        
        // Update room state
        setRoom(updatedRoom);
        
        // Also update gameState for consistency
        if (updatedRoom.gameState) {
          setGameState(updatedRoom.gameState);
        }
        
        // Update answer count if in answering state
        if (updatedRoom.gameState?.status === 'answering') {
          const total = updatedRoom.players.filter(p => p.isConnected).length;
          const count = updatedRoom.gameState.answers ? Object.keys(updatedRoom.gameState.answers).length : 0;
          setAnswerCount({ count, total });
        }
        
        // Update UI based on game state
        if (updatedRoom.gameState?.status === 'results') {
          setShowResults(true);
        } else if (['category-selection', 'question-display', 'answering'].includes(updatedRoom.gameState?.status || '')) {
          setShowResults(false);
        }
      };

      // Game state-specific event handlers
      const handleGameStateUpdate = (gameState: GameState) => {
        console.log(`Game state update received: ${gameState.status}`);
        setGameState(gameState);
      };

      // FIX: QuestionReady now expects a GameState object (not a string)
      const handleQuestionReady = (gameState: GameState) => {
        console.log(`Question ready event received: ${gameState.question}`);
        setGameState(gameState);
        
        // Reset UI state for question display
        setSubmittingAnswer(false);
        setCurrentAnswer('');
        setShowResults(false);
      };

      const handleAnsweringStarted = () => {
        console.log("Answering started event received");
        // Clear answer fields and prepare UI
        setCurrentAnswer('');
        setSubmittingAnswer(false);
        setAnswerCount({count: 0, total: 0});
        setTimeLeft(180); // Default timer
      };

      const handleJudgingStarted = () => {
        console.log("Judging started event received");
      };

      const handleJudgingComplete = (data: { judgingResult: any; scores: Record<string, number> }) => {
        console.log("Judging complete event received:", data);
        setShowResults(true);
      };

      const handleRoundResults = (results: any) => {
        console.log("Round results event received:", results);
        setShowResults(true);
      };

      const handleTimeUpdate = (seconds: number) => {
        console.log(`Time update: ${seconds}s remaining`);
        setTimeLeft(seconds);
      };

      const handleGameEnded = (results: any) => {
        console.log("Game ended event received:", results);
        setGameResults(results);
        setShowResults(true);
      };

      const handleAnswerCountUpdate = (data: { count: number; total: number }) => {
        console.log(`Answer count update: ${data.count}/${data.total}`);
        setAnswerCount(data);
      };

      // Register all event handlers
      socket.on('roomUpdate', handleRoomUpdate);
      socket.on('gameStarted', handleGameStateUpdate);
      socket.on('roundStarted', handleGameStateUpdate);
      socket.on('questionReady', handleQuestionReady);
      socket.on('answeringStarted', handleAnsweringStarted);
      socket.on('judgingStarted', handleJudgingStarted);
      socket.on('judgingComplete', handleJudgingComplete);
      socket.on('roundResults', handleRoundResults);
      socket.on('timerUpdate', handleTimeUpdate);
      socket.on('answerCountUpdate', handleAnswerCountUpdate);
      socket.on('gameEnded', handleGameEnded);

      // Error and room management events
      socket.on('error', (errorMessage: any) => {
        console.error('Socket error received:', errorMessage);
        // Handle both string and object error messages
        if (typeof errorMessage === 'object' && errorMessage.message) {
          setError(errorMessage.message);
        } else if (typeof errorMessage === 'string') {
          setError(errorMessage);
        } else {
          setError('An unexpected error occurred');
        }
      });

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

      socket.on('roomEnded', (message: string) => {
        console.log('Room ended:', message);
        // Clean up localStorage
        localStorage.removeItem(`room_${params.code}_playerId`);
        localStorage.removeItem(`room_${params.code}_nickname`);
        localStorage.removeItem('playerInfo');
        // Redirect to home
        router.push('/');
      });

      socket.on('roomJoined', (data: { 
        roomCode: string;
        playerId: string;
        isHost: boolean;
        message: string;
      }) => {
        console.log('Room joined:', data);
        
        // Store playerId in localStorage for reconnection
        localStorage.setItem(`room_${data.roomCode}_playerId`, data.playerId);
        
        // Set player info in state
        setPlayerId(data.playerId);
        setIsHost(data.isHost);
        
        // Fetch the latest room state
        forceRefreshGameState();
      });

      // Clean up function to remove all event listeners
      return () => {
        socket.off('roomUpdate');
        socket.off('gameStarted');
        socket.off('roundStarted');
        socket.off('questionReady');
        socket.off('answeringStarted');
        socket.off('judgingStarted');
        socket.off('judgingComplete');
        socket.off('roundResults');
        socket.off('timerUpdate');
        socket.off('answerCountUpdate');
        socket.off('gameEnded');
        socket.off('error');
        socket.off('kicked');
        socket.off('roomEnded');
        socket.off('roomJoined');
      };
    };

    // Initialize event handlers
    const cleanup = handleSocketEvents();
    
    // Return cleanup function
    return cleanup;
  }, [socket, room?.gameState?.status, params.code, router, forceRefreshGameState]);

  // Effect to sync the game state and UI
  useEffect(() => {
    // Only run if we have a valid game state
    if (!room?.gameState) return;
    
    const { status, timeRemaining } = room.gameState;
    console.log(`Game state change detected: ${status}, time remaining: ${timeRemaining || 'none'}`);
    
    // Track and handle state changes explicitly
    switch (status) {
      case 'category-selection':
        // Reset any previous UI states
        setShowResults(false);
        setSubmittingAnswer(false);
        setCurrentAnswer('');
        setTimeLeft(null);
        console.log('UI updated for category selection state');
        break;
        
      case 'question-display':
        // Preparing for the question
        setShowResults(false);
        setSubmittingAnswer(false);
        setCurrentAnswer('');
        setTimeLeft(null);
        console.log('UI updated for question display state');
        break;
        
      case 'answering':
        // Answering phase - initialize timer
        setShowResults(false);
        if (typeof timeRemaining === 'number') {
          console.log(`Setting timer to ${timeRemaining} seconds from game state`);
          setTimeLeft(timeRemaining);
        }
        console.log('UI updated for answering state');
        break;
        
      case 'judging':
        // Judging phase - AI is evaluating answers
        setShowResults(false);
        console.log('UI updated for judging phase');
        break;
        
      case 'results':
        // Results phase - show the round results
        setShowResults(true);
        setTimeLeft(null);
        console.log('UI updated for results phase, showing results screen');
        break;
        
      case 'game-over':
        // Game over phase
        setShowResults(true);
        setTimeLeft(null);
        console.log('UI updated for game over phase, showing final results');
        break;
        
      default:
        console.log(`Unknown game status: ${status}, unable to update UI`);
    }
  }, [room?.gameState?.status, room?.gameState?.timeRemaining]);

  // React to host status changes
  useEffect(() => {
    if (!playerId || !room) return;
    
    const currentPlayer = room.players.find(p => p.id === playerId);
    if (currentPlayer?.isHost) {
      console.log('Current player is now the host');
      // Show a toast notification when becoming host
      toast.success('You are now the host!');
    }
  }, [isHost, playerId, room]);

  // Effect to handle automatic reconnection
  useEffect(() => {
    if (!isConnected && room && playerId) {
      console.log('Detected disconnection with active room and playerId, attempting reconnection');
      // Wait a moment before attempting reconnect
      const reconnectTimer = setTimeout(() => {
        if (reconnect) {
          console.log('Auto-reconnecting...');
          reconnect();
        }
      }, 2000);
      
      return () => clearTimeout(reconnectTimer);
    }
  }, [isConnected, room, playerId, reconnect]);

  // Additional effect to check if user is properly connected
  useEffect(() => {
    // Skip during initial loading
    if (loading) return;

    if (room && playerId) {
      const playerInRoom = room.players.find(p => p.id === playerId);
      
      if (playerInRoom && !playerInRoom.isConnected && isConnected) {
        console.log('Player in room but marked as disconnected while socket is connected - forcing sync');
        // This state is inconsistent - try to force a sync
        setTimeout(() => {
          if (reconnect) reconnect();
        }, 1000);
      }
    }
  }, [room, playerId, isConnected, loading, reconnect]);

  // Add a useEffect to immediately refresh UI when player connection states change
  // Place this after other useEffects
  useEffect(() => {
    // This effect runs when room.players changes
    // It specifically watches for changes in the player connection states
    if (room?.players) {
      console.log('Player list changed, players in room:', room.players.length);
      console.log('Connected players:', room.players.filter(p => p.isConnected).length);
      
      // Force a UI update by toggling a state
      // This isn't technically needed, but it helps ensure the UI refreshes
      const forceUpdate = () => setLoading(prev => {
        setTimeout(() => setLoading(prev), 0); // Reset loading back after 0ms
        return !prev;
      });
      
      // If we just had a player disconnect, force an immediate UI update
      const disconnectedPlayers = room.players.filter(p => !p.isConnected);
      if (disconnectedPlayers.length > 0) {
        console.log(`Immediately showing ${disconnectedPlayers.length} disconnected players in UI`);
        forceUpdate();
      }
    }
  }, [room?.players]);

  // Add the useEffect callback for game state changes
  useEffect(() => {
    console.log(`[DEBUG] Game state triggered render: ${room?.gameState?.status}`);
    
    // Log detailed game state for debugging
    if (room?.gameState) {
      console.log('Current game state:', {
        status: room.gameState.status,
        round: room.gameState.round,
        question: room.gameState.question?.substring(0, 30) + '...',
        categorySelector: room.gameState.categorySelector,
        answerCount: room.gameState.answers ? Object.keys(room.gameState.answers).length : 0
      });
    }
  }, [room?.gameState]);

  // Add effect to track when judging state begins and enable debug button after 5 seconds
  useEffect(() => {
    if (room?.gameState?.status === 'judging') {
      // Start a timeout to enable the debug button after 5 seconds
      const timeoutId = window.setTimeout(() => {
        setJudgingTimeout(Date.now());
      }, 5000);
      
      return () => {
        window.clearTimeout(timeoutId);
      };
    } else {
      // Reset the timeout state when not in judging
      setJudgingTimeout(null);
    }
  }, [room?.gameState?.status]);

  /**
   * Event Handlers
   */
  const handleStartGame = async () => {
    if (!socket) return;
    socket.emit('startGame');
  };

  const handleSelectCategory = (category: string) => {
    if (!socket) return;
    
    console.log(`Selecting category: ${category}`);
    setLoading(true);
    
    try {
      socket.emit('selectCategory', category);
      
      // Show immediate feedback 
      toast.success(`Category "${category}" selected!`);
      
      // Client-side UI update to show waiting state
      setSubmittingAnswer(false);
      setCurrentAnswer('');
      
    } catch (error) {
      console.error('Error selecting category:', error);
      toast.error('Failed to select category. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitAnswer = async () => {
    if (!socket || !currentAnswer.trim() || submittingAnswer) return;
    setSubmittingAnswer(true);
    try {
      socket.emit('submitAnswer', currentAnswer.trim());
      setCurrentAnswer('');
      // Leave submittingAnswer as true to keep the waiting UI until game state changes
      toast.success('Your answer has been submitted!');
    } catch (error) {
      console.error('Error submitting answer:', error);
      setSubmittingAnswer(false); // Only reset on error
      toast.error('Failed to submit your answer');
    }
  };

  const handleNextRound = async () => {
    if (!socket) return;
    socket.emit('nextRound');
  };

  const handleKickPlayer = (playerId: string) => {
    if (!socket) return;
    
    // Add confirmation dialog
    if (window.confirm('Are you sure you want to remove this player?')) {
      console.log(`Kicking player: ${playerId}`);
      socket.emit('kickPlayer', playerId);
    }
  };

  const handleLeaveRoom = async () => {
    console.log('===== LEAVE ROOM BUTTON CLICKED =====');
    
    try {
      // Set timestamp that we left the room
      localStorage.setItem('leftRoomAt', Date.now().toString());
      console.log(`Room code to leave: ${params.code}`);
      
      // Clean up localStorage first
      localStorage.removeItem('playerInfo');
      localStorage.removeItem(`room_${params.code}_playerId`);
      localStorage.removeItem(`room_${params.code}_nickname`);

      // Use the socket hook's leaveRoom function if available
      if (socket && socket.connected) {
        console.log(`Socket connected: ${socket.id}, sending leave room event`);
        
        if (typeof leaveRoom === 'function') {
          // Make sure the leaveRoom function gets the room code as a parameter
          console.log('Using leaveRoom function from hook');
          
          // Store room code in localStorage before calling leaveRoom
          // This ensures the hook function can access the correct room code
          const playerInfo = {
            roomCode: params.code,
            playerId: playerId
          };
          localStorage.setItem('playerInfo', JSON.stringify(playerInfo));
          
          // Now call the hook's leaveRoom function
          leaveRoom();
        } else {
          // Fallback to manual method
          console.log('Using fallback method for leaving room');
          socket.emit('leaveRoom', params.code);
          
          // Add delay before disconnecting
          setTimeout(() => {
            console.log('Disconnecting socket after leave room event');
            socket.disconnect();
          }, 300);
        }
      } else {
        console.log('Socket not connected, cannot emit leaveRoom event');
      }

      // Wait a moment before redirecting to allow the socket event to be sent
      console.log('Waiting 500ms before redirecting to home page');
      setTimeout(() => {
        console.log('Redirecting to home page');
        router.push('/');
      }, 500);
    } catch (error) {
      console.error('Error leaving room:', error);
      // Even if there's an error, try to clean up and redirect
      router.push('/');
    }
  };

  // Add improved logging for game state transitions
  useEffect(() => {
    if (room?.gameState?.status) {
      console.log(`Game state changed to: ${room.gameState.status}`);
      
      // Reset UI states based on game state changes
      if (room.gameState.status === 'category-selection') {
        setShowResults(false);
        setCurrentAnswer('');
        setSubmittingAnswer(false);
      } else if (room.gameState.status === 'question-display') {
        setShowResults(false);
        setCurrentAnswer('');
        setSubmittingAnswer(false);
      } else if (room.gameState.status === 'results') {
        setShowResults(true);
      }
    }
  }, [room?.gameState?.status]);

  // Function to manually trigger the judging process
  const handleManualJudging = () => {
    if (!socket) return;
    
    console.log('Manually triggering judging process');
    socket.emit('triggerJudging');
    
    toast.success('Attempting to restart judging process...');
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

  // Bottom of the debug panel
  const DebugPanel = () => {
    if (!isLocal) return null;
    
    return (
      <div className="fixed bottom-4 right-4 p-4 bg-gray-800 text-white text-xs rounded-md opacity-70 hover:opacity-100 transition-opacity">
        <div className="space-y-1">
          <p>Room: {params.code} / Player: {nickname} ({playerId})</p>
          <p>Connection: {isConnected ? '🟢 Connected' : '🔴 Disconnected'}</p>
          <p>Host: {isHost ? '✅ Yes' : '❌ No'}</p>
          <p>Game State: {gameState?.status || 'none'}</p>
          {timeLeft !== null && <p>Time Left: {timeLeft}s</p>}
          <div className="pt-2 flex flex-col gap-1">
            <Button 
              size="sm" 
              variant="outline" 
              onClick={forceRefreshGameState}
              className="text-xs"
            >
              Refresh Game State
            </Button>
            <Button 
              size="sm" 
              variant="outline" 
              onClick={() => reconnect && reconnect()}
              className="text-xs bg-blue-700 hover:bg-blue-800"
            >
              Force Reconnect
            </Button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <div className="container mx-auto px-4 py-8">
        <header className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-2xl font-bold">Room: {params.code}</h1>
            <p>{room.status === 'waiting' ? 'Waiting for players' : 'Game in progress'}</p>
          </div>
          <div className="flex items-center gap-4">
            {!isConnected && (
              <Button
                variant="destructive"
                onClick={() => reconnect && reconnect()}
                className="flex items-center gap-2"
              >
                <span className="animate-pulse">●</span> Reconnect
              </Button>
            )}
            <Button variant="outline" onClick={handleLeaveRoom}>
              Leave Room
            </Button>
          </div>
        </header>

        <div className="space-y-6">
          {/* Game UI */}
          {room?.status === 'playing' ? (
            // Game Layout
            <div className="w-full max-w-md mx-auto flex flex-col gap-4">
              {/* Game status */}
              <Card className="p-6">
                {/* Display current game status for debugging */}
                {process.env.NODE_ENV === 'development' && (
                  <div className="mb-2 p-2 bg-blue-50 rounded text-xs">
                    <p>Current game state: {room?.gameState?.status}</p>
                    <p>Players connected: {room.players.filter(p => p.isConnected).length}/{room.players.length}</p>
                  </div>
                )}
                
                {showResults ? (
                  // Results view
                  <div className="text-center">
                    <h2 className="text-2xl font-bold mb-4">
                      {room?.gameState?.status === 'game-over' ? 'Game Over' : 'Results'}
                    </h2>
                    
                    {room?.gameState?.status === 'game-over' && gameResults ? (
                      // Final Game Results
                      <div>
                        <p className="mb-4 text-lg">Final Standings</p>
                        <div className="my-4 space-y-3">
                          {Object.entries(gameResults.finalScores || {})
                            .sort(([, a], [, b]) => (Number(b) - Number(a)))
                            .map(([playerId, score], index) => {
                              const player = room.players.find(p => p.id === playerId);
                              return (
                                <div key={playerId} className={`p-4 ${index === 0 ? 'bg-yellow-100' : 'bg-gray-100'} rounded-lg flex justify-between items-center`}>
                                  <div className="flex items-center gap-2">
                                    {index === 0 && <Trophy className="w-5 h-5 text-yellow-600" />}
                                    <span className="font-semibold">{index + 1}. {player?.nickname || 'Unknown'}</span>
                                    {player?.id === playerId && <span className="text-blue-600 text-sm">(You)</span>}
                                  </div>
                                  <span className="px-3 py-1.5 bg-blue-100 text-blue-800 font-bold rounded-full">
                                    {score} pts
                                  </span>
                                </div>
                              );
                            })}
                        </div>
                        
                        <div className="mt-8">
                          <Button 
                            variant="outline" 
                            className="w-full"
                            onClick={handleLeaveRoom}
                          >
                            Return to Home
                          </Button>
                        </div>
                      </div>
                    ) : room?.gameState?.round ? (
                      // Round Results
                      <div>
                        <p className="mb-2 text-lg">Round {room.gameState.round} / {room.gameState.totalRounds || 5}</p>
                        <div className="my-4">
                          <h3 className="font-semibold text-lg mb-2">Question:</h3>
                          <p className="text-lg">{room.gameState.question}</p>
                        </div>
                        <div className="my-4">
                          <h3 className="font-semibold text-lg mb-2">Answers:</h3>
                          <ul className="space-y-2">
                            {room.gameState.answers && Object.entries(room.gameState.answers).map(([playerId, answer]) => {
                              const playerName = room.players.find(p => p.id === playerId)?.nickname || 'Unknown';
                              const points = room.gameState?.scores?.[playerId] || 0;
                              const isWinner = room.gameState?.judgingResult?.winners?.includes(playerId);
                              return (
                                <li key={playerId} className={`p-3 ${isWinner ? 'bg-green-100' : 'bg-gray-100'} rounded-lg flex justify-between items-center`}>
                                  <span><strong>{playerName}:</strong> {answer}</span>
                                  <span className={`px-2 py-1 ${isWinner ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'} rounded-full text-sm flex items-center gap-1`}>
                                    {isWinner && <Trophy className="w-4 h-4" />}
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
                            {loading ? 'Loading...' : room.gameState.round >= (room.gameState.totalRounds || 5) ? 'Show Final Results' : 'Next Question'}
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
                    {room?.gameState?.status === 'category-selection' ? (
                      <div className="text-center">
                        <h2 className="text-xl font-bold mb-4">Category Selection</h2>
                        
                        {room.gameState.categorySelector === playerId ? (
                          <div className="space-y-4">
                            <p>You've been selected to choose the category for this round!</p>
                            <div className="grid grid-cols-1 gap-2 mt-4">
                              {room.gameState.categories?.map((category) => (
                                <Button
                                  key={category}
                                  onClick={() => handleSelectCategory(category)}
                                  className="w-full p-4 text-left"
                                  variant="outline"
                                >
                                  {category === 'business' && 'Business Scenario'}
                                  {category === 'scenario' && 'Hypothetical Scenario'}
                                  {category === 'wouldYouRather' && 'Would You Rather...'}
                                  {category === 'pleadForYourLife' && 'Plead For Your Life'}
                                  {category === 'escape' && 'Escape Situation'}
                                </Button>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div>
                            <p className="mb-2">Waiting for a category to be selected...</p>
                            <p className="text-sm text-gray-500">
                              {room.players.find(p => p.id === room.gameState?.categorySelector)?.nickname || 'Another player'} is choosing the category.
                            </p>
                            <div className="animate-pulse mt-4">
                              <div className="h-4 bg-gray-200 rounded w-3/4 mx-auto mb-2.5"></div>
                              <div className="h-4 bg-gray-200 rounded mx-auto"></div>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : room?.gameState?.status === 'question-display' ? (
                      <div className="text-center">
                        <h2 className="text-xl font-bold mb-4">Question Preview</h2>
                        <div className="mb-4">
                          <h3 className="text-2xl font-bold mb-2">Round {room.gameState.round} / {room.gameState.totalRounds || 5}</h3>
                          <p className="text-lg">{room.gameState.question}</p>
                        </div>
                        <p className="text-sm italic mt-4">Answering will begin shortly...</p>
                        <div className="animate-pulse mt-4">
                          <div className="h-4 bg-gray-200 rounded w-1/2 mx-auto"></div>
                        </div>
                      </div>
                    ) : room?.gameState?.status === 'answering' ? (
                      <div className="text-center">
                        <div className="mb-4">
                          <h2 className="text-2xl font-bold mb-2">Round {room.gameState.round} / {room.gameState.totalRounds || 5}</h2>
                          <p className="text-lg">{room.gameState.question}</p>
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
                        
                        {submittingAnswer ? (
                          <div className="mt-4 p-6 bg-blue-50 rounded-lg border border-blue-200">
                            <div className="flex items-center justify-center mb-3">
                              <CheckCircle2 className="text-green-500 w-6 h-6 mr-2" />
                              <p className="text-center text-blue-700 font-medium">Your answer has been submitted!</p>
                            </div>
                            
                            <div className="my-4">
                              <p className="text-sm text-blue-500 mb-2">Waiting for other players to answer...</p>
                              <div className="w-full bg-gray-200 rounded-full h-2.5 mb-1">
                                <div 
                                  className="h-2.5 rounded-full bg-blue-600 transition-all duration-500"
                                  style={{ width: `${answerCount.total > 0 ? (answerCount.count / answerCount.total) * 100 : 0}%` }}
                                ></div>
                              </div>
                              <p className="text-xs text-gray-500 mt-1">
                                {answerCount.count} of {answerCount.total} players have answered
                              </p>
                            </div>
                          </div>
                        ) : (
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
                        )}
                      </div>
                    ) : room?.gameState?.status === 'judging' ? (
                      <div className="text-center p-6">
                        <h2 className="text-xl font-bold mb-4">Judging Answers</h2>
                        <div className="flex flex-col items-center justify-center">
                          <Loader2 className="h-8 w-8 animate-spin mb-4" />
                          <p>The AI is judging all the answers...</p>
                          <p className="text-sm text-gray-500 mt-2">This may take a few moments</p>
                        </div>
                        {judgingTimeout && (
                          <div className="mt-4">
                            <p className="text-yellow-500 mb-2">Seems like judging is taking too long...</p>
                            <Button 
                              variant="destructive" 
                              onClick={handleManualJudging}
                              className="w-full"
                            >
                              Debug: Force Complete Judging
                            </Button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-center p-6">
                        <h2 className="text-xl font-bold mb-4">Game in Progress</h2>
                        <div className="flex flex-col items-center">
                          <p>Please wait for the current phase to complete.</p>
                          <p className="text-sm text-gray-500 mt-2">Current game phase: {room?.gameState?.status || 'unknown'}</p>
                          <Loader2 className="h-6 w-6 animate-spin mt-4" />
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
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-sm">
                              {points} pts
                            </span>
                          </div>
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
              {/* Player List */}
              <Card className="p-6">
                <h2 className="text-xl font-bold mb-4">Players ({room?.players?.length || 0})</h2>
                {room?.players && room.players.length > 0 ? (
                  <ul className="space-y-2">
                    {room.players.map(player => (
                      <li 
                        key={`player-${player.id}-${player.isConnected ? 'connected' : 'disconnected'}`} 
                        className={`p-3 ${player.id === playerId ? 'bg-blue-100' : 'bg-gray-100'} 
                          ${!player.isConnected ? 'opacity-60' : 'opacity-100'}
                          rounded-lg flex justify-between items-center transition-all duration-300`}
                      >
                        <span className="font-medium flex items-center gap-2">
                          {player.nickname} 
                          {player.id === playerId ? ' (You)' : ''} 
                          {player.isHost ? (
                            <span className="flex items-center gap-1 text-yellow-600">
                              <Crown size={16} />
                              <span className="text-xs">(Host)</span>
                            </span>
                          ) : null}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-1 flex items-center gap-1
                            ${player.isConnected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'} 
                            rounded-full text-xs`}
                          >
                            {player.isConnected ? (
                              <>
                                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                                Connected
                              </>
                            ) : (
                              <>
                                <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                                Disconnected
                              </>
                            )}
                          </span>
                          {isHost && player.id !== playerId && !player.isHost && (
                            <Button 
                              variant="destructive" 
                              size="sm"
                              onClick={() => handleKickPlayer(player.id)}
                              className="flex items-center gap-1"
                            >
                              <XCircle size={14} />
                              Remove
                            </Button>
                          )}
                        </div>
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

          {/* Debug information */}
          {!(!isProduction && !isLocal) && (
            <div className="fixed bottom-0 left-0 right-0 bg-black text-white p-2 text-xs overflow-auto max-h-[30vh]">
              <div className="mb-2 flex justify-between">
                <div>
                  <strong>Debug Controls:</strong>{" "}
                  <button className="bg-red-500 text-white px-2 py-1 rounded ml-2" onClick={forceRefreshGameState}>
                    Force Refresh
                  </button>
                </div>
                <div>
                  <strong>Room Status:</strong> {room?.status} | <strong>Game Status:</strong> {room?.gameState?.status}
                </div>
              </div>
              
              <div>
                <strong>Local Player ID:</strong> {playerId} | <strong>isHost:</strong> {isHost ? "true" : "false"} | <strong>isConnected:</strong> {isConnected ? "true" : "false"}
              </div>
              
              <div>
                <pre>{JSON.stringify({ room, gameState: room?.gameState, players: room?.players }, null, 2)}</pre>
              </div>
            </div>
          )}
        </div>
      </div>
      <DebugPanel />
    </div>
  );
} 