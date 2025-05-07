'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

export default function HomePage() {
  const router = useRouter();
  const [roomCode, setRoomCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingRoom, setCheckingRoom] = useState(true);
  const [recentlyLeft, setRecentlyLeft] = useState(false);

  // Check for existing room connection
  useEffect(() => {
    const checkExistingRoom = async () => {
      try {
        // Get all room keys from localStorage
        const roomKeys = Object.keys(localStorage).filter(key => key.startsWith('room_'));
        
        for (const key of roomKeys) {
          const code = key.split('_')[1];
          const playerId = localStorage.getItem(`room_${code}_playerId`);
          const nickname = localStorage.getItem(`room_${code}_nickname`);

          if (playerId && nickname) {
            // Verify the room still exists and player is still in it
            const response = await fetch(`/api/rooms?code=${code}`);
            if (response.ok) {
              const room = await response.json();
              const player = room.players.find((p: any) => p.id === playerId);
              
              if (player) {
                // Room exists and player is still in it, but don't auto-redirect
                // Instead, show a message that they can rejoin
                console.log('Found existing room connection:', { code, playerId, nickname });
                // Clean up localStorage to prevent auto-rejoin
                localStorage.removeItem(`room_${code}_playerId`);
                localStorage.removeItem(`room_${code}_nickname`);
              } else {
                // Player not found in room, clean up localStorage
                localStorage.removeItem(`room_${code}_playerId`);
                localStorage.removeItem(`room_${code}_nickname`);
              }
            } else {
              // Room doesn't exist, clean up localStorage
              localStorage.removeItem(`room_${code}_playerId`);
              localStorage.removeItem(`room_${code}_nickname`);
            }
          }
        }

        // Check if player just left a room (within last few seconds)
        const leftTimestamp = localStorage.getItem('leftRoomAt');
        if (leftTimestamp) {
          const leftTime = parseInt(leftTimestamp, 10);
          const now = Date.now();
          const timeSinceLeft = now - leftTime;
          
          // If left within last 3 seconds, show temporary message
          if (timeSinceLeft < 3000) {
            setRecentlyLeft(true);
            setTimeout(() => setRecentlyLeft(false), 3000 - timeSinceLeft);
          } else {
            // Clear the timestamp if it's older
            localStorage.removeItem('leftRoomAt');
          }
        }
      } catch (error) {
        console.error('Error checking existing room:', error);
      } finally {
        setCheckingRoom(false);
      }
    };

    checkExistingRoom();
  }, [router]);

  const handleCreateRoom = async () => {
    if (!nickname.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const response = await fetch('/api/rooms/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          nickname: nickname.trim(),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create room');
      }

      const data = await response.json();
      
      // Clear any existing room info first
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('room_') || key === 'playerInfo') {
          localStorage.removeItem(key);
        }
      });
      
      // Set room-specific localStorage entries
      localStorage.setItem(`room_${data.room.code}_playerId`, data.playerId);
      localStorage.setItem(`room_${data.room.code}_nickname`, nickname.trim());
      
      // Set playerInfo
      const playerInfo = {
        playerId: data.playerId,
        roomCode: data.room.code,
        nickname: nickname.trim()
      };
      console.log('Setting playerInfo in localStorage:', playerInfo);
      localStorage.setItem('playerInfo', JSON.stringify(playerInfo));
      
      router.push(`/room/${data.room.code}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to create room');
    } finally {
      setCreating(false);
    }
  };

  const handleJoinRoom = async () => {
    if (!roomCode.trim() || !nickname.trim()) return;
    setJoining(true);
    setError(null);
    try {
      const response = await fetch('/api/rooms/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code: roomCode.trim(),
          nickname: nickname.trim(),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        
        // If the server tells us to clear storage, do it
        if (errorData.clearStorage) {
          console.log('Server requested storage cleanup for this room');
          localStorage.removeItem(`room_${roomCode.trim()}_playerId`);
          localStorage.removeItem(`room_${roomCode.trim()}_nickname`);
          localStorage.removeItem('playerInfo');
        }
        
        throw new Error(errorData.error || 'Failed to join room');
      }

      const data = await response.json();
      
      // Clear any existing room info first
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('room_') || key === 'playerInfo') {
          localStorage.removeItem(key);
        }
      });
      
      // Set room-specific localStorage entries
      localStorage.setItem(`room_${data.room.code}_playerId`, data.playerId);
      localStorage.setItem(`room_${data.room.code}_nickname`, nickname.trim());
      
      // Set playerInfo
      const playerInfo = {
        playerId: data.playerId,
        roomCode: data.room.code,
        nickname: nickname.trim()
      };
      console.log('Setting playerInfo in localStorage:', playerInfo);
      localStorage.setItem('playerInfo', JSON.stringify(playerInfo));
      
      // Small delay to ensure localStorage is set before navigation
      setTimeout(() => {
        router.push(`/room/${data.room.code}`);
      }, 100);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to join room');
    } finally {
      setJoining(false);
    }
  };

  if (checkingRoom) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-8 p-4">
      <h1 className="text-4xl font-bold text-center">What Would You Do?</h1>
      <p className="text-xl text-muted-foreground text-center max-w-md">
        Join a room or create your own to start playing!
      </p>

      <Card className="w-full max-w-md p-6">
        <div className="space-y-4">
          <div>
            <label htmlFor="nickname" className="block text-sm font-medium mb-2">
              Your Nickname
            </label>
            <Input
              id="nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Enter your nickname"
              className="w-full"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && nickname.trim()) {
                  if (roomCode.trim()) {
                    handleJoinRoom();
                  } else {
                    handleCreateRoom();
                  }
                }
              }}
            />
          </div>

          <div>
            <label htmlFor="roomCode" className="block text-sm font-medium mb-2">
              Room Code (Optional)
            </label>
            <Input
              id="roomCode"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value)}
              placeholder="Enter room code to join"
              className="w-full"
            />
          </div>

          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}

          {recentlyLeft && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md mb-4">
              <p className="text-sm text-yellow-800">
                You've just left a room. Please wait a moment before rejoining with the same nickname.
              </p>
            </div>
          )}

          <div className="flex gap-4">
            <Button
              onClick={handleCreateRoom}
              disabled={creating || joining || !nickname.trim()}
              className="flex-1"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Create Room
            </Button>
            <Button
              onClick={handleJoinRoom}
              disabled={creating || joining || !roomCode.trim() || !nickname.trim()}
              className="flex-1"
            >
              {joining ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Join Room
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
