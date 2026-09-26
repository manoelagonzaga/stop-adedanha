// ── Shared domain types for backend (mirrors shared/types.ts) ──────────────

export type GamePhase =
  | 'WAITING_PLAYERS'
  | 'CONFIGURING'
  | 'ROUND_ACTIVE'
  | 'CATEGORY_REVIEW'
  | 'ROUND_RESULTS'
  | 'GAME_OVER';

export interface Player {
  id: string;
  nickname: string;
  isHost: boolean;
  status: 'active' | 'disconnected';
  score: number;
  avatar?: string;
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
  invalidations: string[];
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
  currentReviewCategoryIndex?: number;
  reviewDeadline?: number;
}

// Client → Server
export type ClientCommand =
  | { type: 'room:create'; requestId: string; nickname: string; totalRounds?: number }
  | { type: 'room:join'; requestId: string; code: string; nickname: string }
  | { type: 'lobby:categories:update'; requestId: string; categories: string[] }
  | { type: 'lobby:rounds:update'; requestId: string; totalRounds: number }
  | { type: 'game:start'; requestId: string }
  | { type: 'answer:submit'; requestId: string; roundId: string; answers: Record<string, string> }
  | { type: 'round:stop'; requestId: string; roundId: string }
  | { type: 'answer:invalidate'; requestId: string; roundId: string; categoryId: string; answerId: string };

// Server → Client
export type ServerEvent =
  | { type: 'session:ready'; playerId: string }
  | { type: 'room:state'; state: RoomState }
  | { type: 'round:started'; id: string; letter: string; categories: Category[]; deadline: number }
  | {
      type: 'round:review:category';
      categoryIndex: number;
      totalCategories: number;
      category: Category;
      answers: Answer[];
      eligibleVoters: number;
      deadline: number;
    }
  | {
      type: 'round:review:score_update';
      categoryIndex: number;
      categoryScores: Record<string, number>;
      scoreboard: Player[];
    }
  | { type: 'round:results'; answers: Answer[]; ranking: Player[] }
  | {
      type: 'game:final_results';
      podium: PodiumItem[];
      list: RankingListItem[];
    }
  | { type: 'player:presence'; id: string; nickname: string; status: 'active' | 'disconnected' }
  | { type: 'error'; code: string; message: string; requestId?: string };

export interface PodiumItem {
  position: 1 | 2 | 3;
  playerId: string;
  nickname: string;
  score: number;
  tier: 'gold' | 'silver' | 'bronze';
}

export interface RankingListItem {
  position: number;
  playerId: string;
  nickname: string;
  score: number;
}
