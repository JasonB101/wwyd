import { useEffect, useState } from 'react';
import { Room } from '@/types/room';

interface AuthState {
  playerId: string | null;
  nickname: string | null;
  isHost: boolean;
  setPlayerId: (id: string) => void;
  setIsHost: (isHost: boolean) => void;
}

export function useAuth(roomCode: string, roomData?: Room): AuthState {
  const [authState, setAuthState] = useState<AuthState & { setPlayerId?: any, setIsHost?: any }>({
    playerId: null,
    nickname: null,
    isHost: false,
    setPlayerId: null,
    setIsHost: null
  });

  // Setter functions
  const setPlayerId = (id: string) => {
    console.log('Setting playerId to:', id);
    
    if (roomCode) {
      // Store in localStorage for persistence
      localStorage.setItem(`room_${roomCode}_playerId`, id);
    }
    
    // Update state
    setAuthState(prev => ({
      ...prev,
      playerId: id
    }));
    
    // Also update the playerInfo
    const playerInfo = JSON.parse(localStorage.getItem('playerInfo') || '{}');
    localStorage.setItem('playerInfo', JSON.stringify({
      ...playerInfo,
      playerId: id
    }));
  };
  
  const setIsHost = (isHost: boolean) => {
    console.log('Setting isHost to:', isHost);
    
    // Update state
    setAuthState(prev => ({
      ...prev,
      isHost
    }));
  };

  // Initial auth check directly from localStorage to avoid blank states during refreshes
  useEffect(() => {
    if (!roomCode) return;
    
    const playerId = localStorage.getItem(`room_${roomCode}_playerId`);
    const nickname = localStorage.getItem(`room_${roomCode}_nickname`);
    
    if (playerId && nickname) {
      console.log('Loading auth from localStorage:', { playerId, nickname });
      
      // Always set these values immediately from localStorage to avoid flashing UI
      setAuthState(prev => ({
        ...prev,
        playerId,
        nickname
      }));
      
      // Also ensure playerInfo is set
      const playerInfo = {
        playerId,
        roomCode,
        nickname
      };
      localStorage.setItem('playerInfo', JSON.stringify(playerInfo));
    }
  }, [roomCode]);

  // Update auth state when room data changes
  useEffect(() => {
    if (roomData && roomData.players && roomData.players.length > 0) {
      const storedPlayerId = localStorage.getItem(`room_${roomCode}_playerId`);
      
      if (storedPlayerId) {
        // Find the player in the room data by ID
        const player = roomData.players.find(p => p.id === storedPlayerId);
        
        if (player) {
          console.log(`Player found in room data update. isHost: ${player.isHost}, nickname: ${player.nickname}`);
          
          // Update auth state with the latest host status from room data
          setAuthState(prev => ({
            ...prev,
            playerId: storedPlayerId,
            nickname: player.nickname,
            isHost: player.isHost
          }));
        } else {
          console.log(`Player ID ${storedPlayerId} not found in updated room data`);
        }
      }
    }
  }, [roomData, roomCode]);

  // Fetch room data if needed
  useEffect(() => {
    console.log('useAuth effect running, roomCode:', roomCode);
    
    const playerId = localStorage.getItem(`room_${roomCode}_playerId`);
    const nickname = localStorage.getItem(`room_${roomCode}_nickname`);

    if (!roomData && playerId && nickname) {
      console.log('Fetching room data to check host status for player:', playerId);
      // Check if player is the host by fetching room data
      fetch(`/api/rooms?code=${roomCode}`)
        .then(response => {
          console.log('Room API response status:', response.status);
          return response.json();
        })
        .then(roomData => {
          console.log('Room data received:', JSON.stringify(roomData, null, 2));
          
          // Find the player in the room and check if they're the host
          const player = roomData.players.find((p: any) => p.id === playerId);
          
          if (player) {
            console.log('Player found in room data:', JSON.stringify(player, null, 2));
          } else {
            console.log('Player NOT found in room data. PlayerId:', playerId);
            console.log('Available players:', roomData.players.map((p: any) => ({ id: p.id, nickname: p.nickname, isHost: p.isHost })));
          }
          
          const isHost = player ? player.isHost : false;
          
          console.log('Auth status updated:', { playerId, nickname, isHost });
          
          setAuthState(prev => ({
            ...prev,
            playerId,
            nickname,
            isHost
          }));
        })
        .catch(error => {
          console.error('Error checking host status:', error);
          // Don't clear player info on error - just keep what we have from localStorage
        });
    }
  }, [roomCode, roomData]);

  // Return auth state with setter functions
  return {
    ...authState,
    setPlayerId,
    setIsHost
  };
} 