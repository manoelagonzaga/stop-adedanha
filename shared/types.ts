export type GamePhase = 'WAITING_PLAYERS' | 'CONFIGURING' | 'ROUND_ACTIVE' | 'VOTING' | 'ROUND_RESULTS' | 'GAME_OVER';

export interface Player {
  id: string;
  nickname: string;
  isHost: boolean;
  status: 'active' | 'disconnected';
  score: number;
}

export interface Category {
  id: string;
  name: string;
}

export interface Answer {
  playerId: string;
  categoryId: string;
  value: string;
  isValid: boolean;
  invalidations: string[]; // array of playerIds who invalidated it
  score: number;
}

export interface RoomState {
  code: string;
  phase: GamePhase;
  players: Player[];
  categories: Category[];
  currentRound: number;
  totalRounds: number;
  currentLetter?: string;
  roundDeadline?: number;
}

// Client to Server Commands
export type ClientCommand =
  | { type: 'room:create'; requestId: string; nickname: string; totalRounds?: number }
  | { type: 'room:join'; requestId: string; code: string; nickname: string }
  | { type: 'lobby:categories:update'; requestId: string; categories: string[] }
  | { type: 'game:start'; requestId: string }
  | { type: 'answer:submit'; requestId: string; roundId: string; answers: Record<string, string> }
  | { type: 'round:stop'; requestId: string; roundId: string }
  | { type: 'answer:invalidate'; requestId: string; roundId: string; answerId: string };

// Server to Client Events
export type ServerEvent =
  | { type: 'room:state'; state: RoomState }
  | { type: 'round:started'; id: string; letter: string; categories: Category[]; deadline: number }
  | { type: 'round:review'; answers: Answer[]; eligibleVoters: number; deadline: number }
  | { type: 'round:results'; answers: Answer[]; ranking: Player[] }
  | { type: 'player:presence'; id: string; nickname: string; status: 'active' | 'disconnected' }
  | { type: 'error'; code: string; message: string };

