import { useEffect, useState } from 'react';

interface AuthState {
  playerId: string | null;
  nickname: string | null;
  isHost: boolean;
}

export function useAuth(roomCode: string): AuthState {
  const [authState, setAuthState] = useState<AuthState>({
    playerId: null,
    nickname: null,
    isHost: false
  });

  useEffect(() => {
    console.log('useAuth effect running, roomCode:', roomCode);
    
    const playerId = localStorage.getItem(`room_${roomCode}_playerId`);
    const nickname = localStorage.getItem(`room_${roomCode}_nickname`);

    console.log('Local storage values:', { playerId, nickname });

    if (playerId && nickname) {
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
          
          setAuthState({
            playerId,
            nickname,
            isHost
          });
        })
        .catch(error => {
          console.error('Error checking host status:', error);
          setAuthState({
            playerId,
            nickname,
            isHost: false
          });
        });
    }
  }, [roomCode]);

  return authState;
} 