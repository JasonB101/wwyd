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
      // Check if we have playerInfo in localStorage
      const playerInfoStr = localStorage.getItem('playerInfo');
      
      if (playerInfoStr) {
        try {
          const playerInfo = JSON.parse(playerInfoStr);
          if (playerInfo.roomCode && playerInfo.playerId && playerInfo.nickname) {
            // Check if room still exists
            const response = await fetch(`/api/rooms?code=${playerInfo.roomCode}`);
            if (response.ok) {
              router.push(`/room/${playerInfo.roomCode}`);
              return;
            } else {
              console.log('Previously joined room no longer exists, clearing localStorage');
              localStorage.removeItem('playerInfo');
              Object.keys(localStorage).forEach(key => {
                if (key.startsWith('room_')) {
                  localStorage.removeItem(key);
                }
              });
            }
          }
        } catch (error) {
          console.error('Error checking existing room:', error);
          localStorage.removeItem('playerInfo');
        }
      }
      
      // Check if user recently left a room
      const leftRoomAt = localStorage.getItem('leftRoomAt');
      if (leftRoomAt) {
        const leftTime = parseInt(leftRoomAt, 10);
        const now = Date.now();
        const timeSinceLeft = now - leftTime;
        
        // If left less than 2 seconds ago, show a warning
        if (timeSinceLeft < 2000) {
          setRecentlyLeft(true);
          setTimeout(() => setRecentlyLeft(false), 2000 - timeSinceLeft);
        }
        
        // Clean up the leftRoomAt value after 5 seconds
        if (timeSinceLeft > 5000) {
          localStorage.removeItem('leftRoomAt');
        }
      }
      
      setCheckingRoom(false);
    };
    
    checkExistingRoom();
  }, [router]);

  // Add room code validation function
  const isValidRoomCode = (code: string) => {
    // Room code must be exactly 4 digits
    return /^\d{4}$/.test(code);
  };

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
                  // If the room code is valid, join room
                  if (isValidRoomCode(roomCode)) {
                    handleJoinRoom();
                  } 
                  // If the room code field is empty, create room
                  else if (roomCode.trim().length === 0) {
                    handleCreateRoom();
                  }
                  // Otherwise, do nothing (neither button would be enabled)
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
              onChange={(e) => {
                // Only allow digits and limit to 4 characters
                const value = e.target.value.replace(/\D/g, '').slice(0, 4);
                setRoomCode(value);
              }}
              placeholder="Enter 4-digit room code"
              className="w-full"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
            />
            {roomCode.trim().length > 0 && !isValidRoomCode(roomCode) && (
              <p className="mt-1 text-xs text-amber-600">Room code must be exactly 4 digits</p>
            )}
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
              disabled={creating || joining || !nickname.trim() || roomCode.trim().length > 0}
              className="flex-1"
              title={roomCode.trim().length > 0 ? "Clear room code to create a new room" : "Create a new room"}
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Create Room
            </Button>
            <Button
              onClick={handleJoinRoom}
              disabled={creating || joining || !isValidRoomCode(roomCode) || !nickname.trim()}
              className="flex-1"
              title={!isValidRoomCode(roomCode) ? "Room code must be exactly 4 digits" : "Join an existing room"}
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
