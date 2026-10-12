export type GamePhase =
  | 'WAITING_PLAYERS'
  | 'CONFIGURING'
  | 'ROUND_ACTIVE'
  | 'CATEGORY_REVIEW'
  | 'ROUND_RESULTS'
  | 'GAME_OVER';

export type ProtocolVersion = 1;

export const AVATAR_OPTIONS = ['🦊', '🐙', '🐵', '🦁', '🐯', '🐼', '🐨', '🐸', '🦄'] as const;
export type Avatar = (typeof AVATAR_OPTIONS)[number];

export interface Player {
  id: string;
  nickname: string;
  isHost: boolean;
  status: 'active' | 'disconnected';
  score: number;
  joinedAt?: number;
  avatar?: Avatar;
}

export interface Category {
  id: string;
  name: string;
}

export type VoteDecision = 'valid' | 'invalidate';

export interface Answer {
  playerId: string;
  categoryId: string;
  value: string;
  isValid: boolean;
  invalidations: string[]; // array of playerIds who invalidated it
  votes?: Record<string, VoteDecision>;
  eligibleVoters?: string[];
  score: number;
}

export interface PodiumItem {
  position: 1 | 2 | 3;
  playerId: string;
  nickname: string;
  score: number;
  tier: 'gold' | 'silver' | 'bronze';
  avatar?: Avatar;
}

export interface RankingListItem {
  position: number;
  playerId: string;
  nickname: string;
  score: number;
  avatar?: Avatar;
}

export interface FinalResults {
  podium: PodiumItem[];
  list: RankingListItem[];
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
  lastActivityAt?: number;
  completedAt?: number;
  expiresAt?: number;
  roundDurationSeconds?: 0 | 60 | 90 | 120;
  allowedLetters?: string[];
  currentRoundId?: string;
}

export interface CommandRequest {
  requestId: string;
  protocolVersion?: ProtocolVersion;
}

export interface RoomSettings {
  totalRounds: number;
  roundDurationSeconds: 0 | 60 | 90 | 120;
  allowedLetters: string[];
}

// Client to Server Commands
export type ClientCommand =
  | ({ type: 'session:hello'; protocolVersion: ProtocolVersion } & CommandRequest)
  | ({ type: 'session:resume'; resumeToken: string } & CommandRequest)
  | ({
      type: 'room:create';
      nickname: string;
      avatar?: Avatar;
      totalRounds?: number;
      roundDurationSeconds?: 0 | 60 | 90 | 120;
      allowedLetters?: string[];
    } & CommandRequest)
  | ({ type: 'room:join'; code: string; nickname: string; avatar?: Avatar } & CommandRequest)
  | ({ type: 'lobby:categories:update'; categories: string[] } & CommandRequest)
  | ({ type: 'lobby:rounds:update'; totalRounds: number } & CommandRequest)
  | ({
      type: 'lobby:options:update';
      roundDurationSeconds: 0 | 60 | 90 | 120;
      allowedLetters: string[];
    } & CommandRequest)
  | ({ type: 'game:start' } & CommandRequest)
  | ({ type: 'answer:submit'; roundId: string; answers: Record<string, string> } & CommandRequest)
  | ({ type: 'round:stop'; roundId: string } & CommandRequest)
  | ({
      type: 'answer:vote';
      roundId: string;
      categoryId: string;
      answerPlayerId: string;
      decision: VoteDecision;
    } & CommandRequest)
  | ({ type: 'round:next'; roundId: string } & CommandRequest)
  | ({ type: 'round:review:next'; roundId: string } & CommandRequest)
  | ({ type: 'room:leave' } & CommandRequest)
  | ({ type: 'room:close' } & CommandRequest);

export type RoomClosedReason = 'host_closed' | 'empty' | 'purged';

// Server to Client Events
export type ServerEvent =
  | {
      type: 'session:ready';
      playerId?: string;
      supportedProtocolVersions?: ProtocolVersion[];
      negotiatedProtocolVersion?: ProtocolVersion;
    }
  | {
      type: 'room:joined';
      requestId: string;
      playerId: string;
      resumeToken: string;
    }
  | {
      type: 'session:resumed';
      requestId: string;
      playerId: string;
      resumeToken: string;
      state: RoomState;
    }
  | { type: 'room:state'; state: RoomState }
  | {
      type: 'room:closed';
      reason: RoomClosedReason;
      requestId?: string;
    }
  | {
      type: 'command:ack';
      requestId: string;
      commandType: ClientCommand['type'];
      status: 'committed' | 'duplicate';
    }
  | {
      type: 'round:started';
      id: string;
      roundId?: string;
      roundNumber?: number;
      letter: string;
      categories: Category[];
      deadline?: number;
    }
  | {
      type: 'round:review:category';
      categoryIndex: number;
      totalCategories: number;
      category: Category;
      answers: Answer[];
      eligibleVoters: number;
      deadline?: number;
    }
  | {
      type: 'round:review:score_update';
      categoryIndex: number;
      categoryScores: Record<string, number>;
      scoreboard: Player[];
    }
  | { type: 'round:results'; answers: Answer[]; ranking: Player[]; roundScores?: Record<string, number> }
  | { type: 'game:final_results'; podium: PodiumItem[]; list: RankingListItem[] }
  | { type: 'player:presence'; id: string; nickname: string; status: 'active' | 'disconnected' }
  | { type: 'error'; code: string; message: string; requestId?: string };
