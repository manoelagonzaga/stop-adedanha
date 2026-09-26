import type {
  GamePhase,
  Player,
  Category,
  Answer,
  RoomState,
  ClientCommand,
  ServerEvent,
} from './types';
import {
  computeCategoryScores,
  computeRoundScores,
  resolveInvalidation,
  buildFinalRanking,
  STOP_BONUS_PTS,
  type RoundSnapshot,
} from './scoring';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_PLAYERS = 20;
const DEFAULT_ROUNDS = 5;
const ROUND_DURATION_MS = 90_000; // 90 seconds per round
const REVIEW_CATEGORY_DURATION_MS = 30_000; // 30 seconds per category review

const DEFAULT_CATEGORIES: Category[] = [
  { id: 'cat-0', name: 'Nome' },
  { id: 'cat-1', name: 'Cidade' },
  { id: 'cat-2', name: 'Animal' },
  { id: 'cat-3', name: 'Comida' },
  { id: 'cat-4', name: 'Objeto' },
];

const ALLOWED_LETTERS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'L', 'M',
  'N', 'O', 'P', 'R', 'S', 'T', 'U', 'V',
];

// ── Per-round data ─────────────────────────────────────────────────────────────

interface RoundData {
  id: string;
  letter: string;
  answers: Map<string, Answer>; // key: `${playerId}:${categoryId}`
  stopperId: string | null; // who called stop
  stopTime: number | null;
  submittedPlayers: Set<string>;
}

// ── GameRoom Durable Object ────────────────────────────────────────────────────

export class GameRoom implements DurableObject {
  private readonly state: DurableObjectState;

  // In-memory state (reconstructed from Durable Storage on cold start)
  private room: RoomState;
  private rounds: Map<string, RoundData> = new Map();
  private currentRoundData: RoundData | null = null;

  // WebSocket session map: ws → playerId
  private sessions: Map<WebSocket, string> = new Map();

  constructor(state: DurableObjectState) {
    this.state = state;
    // Initialize with a blank room; will be populated on first join
    this.room = {
      code: '',
      phase: 'WAITING_PLAYERS',
      players: [],
      categories: DEFAULT_CATEGORIES,
      currentRound: 0,
      totalRounds: DEFAULT_ROUNDS,
    };

    // Restore persisted state (hibernation support)
    this.state.blockConcurrencyWhile(async () => {
      const persisted = await this.state.storage.get<RoomState>('room');
      if (persisted) this.room = persisted;
    });
  }

  // ── WebSocket lifecycle ─────────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return Response.json({ error: 'WEBSOCKET_REQUIRED' }, { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    const playerId = crypto.randomUUID();

    this.state.acceptWebSocket(server, [playerId]);
    this.sessions.set(server, playerId);

    // Send session ready
    this.sendTo(server, { type: 'session:ready', playerId });

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== 'string') return;

    const playerId = this.sessions.get(socket);
    if (!playerId) return;

    let cmd: ClientCommand;
    try {
      cmd = JSON.parse(message) as ClientCommand;
    } catch {
      this.sendTo(socket, { type: 'error', code: 'INVALID_JSON', message: 'Cannot parse JSON' });
      return;
    }

    this.handleCommand(socket, playerId, cmd).catch((err) => {
      console.error('[GameRoom] handleCommand error:', err);
      this.sendTo(socket, {
        type: 'error',
        code: 'INTERNAL_ERROR',
        message: String(err),
      });
    });
  }

  webSocketClose(socket: WebSocket): void {
    const playerId = this.sessions.get(socket);
    if (playerId) {
      this.sessions.delete(socket);
      this.setPlayerStatus(playerId, 'disconnected');
    }
  }

  webSocketError(socket: WebSocket): void {
    this.webSocketClose(socket);
  }

  // ── Command Dispatcher ─────────────────────────────────────────────────────

  private async handleCommand(
    socket: WebSocket,
    playerId: string,
    cmd: ClientCommand
  ): Promise<void> {
    switch (cmd.type) {
      case 'room:create':
        return this.handleRoomCreate(socket, playerId, cmd);
      case 'room:join':
        return this.handleRoomJoin(socket, playerId, cmd);
      case 'lobby:categories:update':
        return this.handleCategoriesUpdate(socket, playerId, cmd);
      case 'lobby:rounds:update':
        return this.handleRoundsUpdate(socket, playerId, cmd);
      case 'game:start':
        return this.handleGameStart(socket, playerId);
      case 'answer:submit':
        return this.handleAnswerSubmit(socket, playerId, cmd);
      case 'round:stop':
        return this.handleRoundStop(socket, playerId, cmd);
      case 'answer:invalidate':
        return this.handleAnswerInvalidate(socket, playerId, cmd);
      default:
        this.sendTo(socket, {
          type: 'error',
          code: 'UNKNOWN_COMMAND',
          message: `Unknown command type`,
        });
    }
  }

  // ── Room: Create ───────────────────────────────────────────────────────────

  private async handleRoomCreate(
    socket: WebSocket,
    playerId: string,
    cmd: { type: 'room:create'; requestId: string; nickname: string; totalRounds?: number }
  ): Promise<void> {
    if (this.room.phase !== 'WAITING_PLAYERS') {
      this.sendTo(socket, {
        type: 'error',
        code: 'ROOM_ALREADY_EXISTS',
        message: 'Room already initialized',
        requestId: cmd.requestId,
      });
      return;
    }

    const nickname = cmd.nickname.trim();
    if (!nickname) {
      this.sendTo(socket, {
        type: 'error',
        code: 'INVALID_NICKNAME',
        message: 'Nickname is required',
        requestId: cmd.requestId,
      });
      return;
    }

    // Use the DO id (url path segment) as room code
    const code = this.generateCode();

    const hostPlayer: Player = {
      id: playerId,
      nickname,
      isHost: true,
      status: 'active',
      score: 0,
    };

    this.room = {
      code,
      phase: 'CONFIGURING',
      players: [hostPlayer],
      categories: DEFAULT_CATEGORIES,
      currentRound: 0,
      totalRounds: cmd.totalRounds ?? DEFAULT_ROUNDS,
    };

    await this.persistRoom();
    this.broadcastRoomState();
  }

  // ── Room: Join ─────────────────────────────────────────────────────────────

  private async handleRoomJoin(
    socket: WebSocket,
    playerId: string,
    cmd: { type: 'room:join'; requestId: string; code: string; nickname: string }
  ): Promise<void> {
    const nickname = cmd.nickname.trim();

    if (!nickname) {
      this.sendTo(socket, {
        type: 'error',
        code: 'INVALID_NICKNAME',
        message: 'Nickname is required',
        requestId: cmd.requestId,
      });
      return;
    }

    if (this.room.players.length >= MAX_PLAYERS) {
      this.sendTo(socket, {
        type: 'error',
        code: 'ROOM_FULL',
        message: 'Room is full',
        requestId: cmd.requestId,
      });
      return;
    }

    if (
      this.room.players.some(
        (p) => p.nickname.toLowerCase() === nickname.toLowerCase() && p.status === 'active'
      )
    ) {
      this.sendTo(socket, {
        type: 'error',
        code: 'DUPLICATE_NICKNAME',
        message: 'Nickname already in use',
        requestId: cmd.requestId,
      });
      return;
    }

    // Allow rejoin if disconnected player with same ID
    const existing = this.room.players.find((p) => p.id === playerId);
    if (existing) {
      existing.status = 'active';
      existing.nickname = nickname;
    } else {
      this.room.players.push({
        id: playerId,
        nickname,
        isHost: this.room.players.length === 0,
        status: 'active',
        score: 0,
      });
    }

    await this.persistRoom();

    // Send full room state to the joining player
    this.sendTo(socket, { type: 'room:state', state: this.room });

    // Notify everyone of the join
    this.broadcast({
      type: 'player:presence',
      id: playerId,
      nickname,
      status: 'active',
    });

    this.broadcastRoomState();
  }

  // ── Lobby: Update Categories ───────────────────────────────────────────────

  private async handleCategoriesUpdate(
    socket: WebSocket,
    playerId: string,
    cmd: { type: 'lobby:categories:update'; requestId: string; categories: string[] }
  ): Promise<void> {
    if (!this.isHost(playerId)) {
      this.sendTo(socket, {
        type: 'error',
        code: 'NOT_HOST',
        message: 'Only the host can update categories',
        requestId: cmd.requestId,
      });
      return;
    }

    this.room.categories = cmd.categories
      .filter((c) => c.trim().length > 0)
      .map((name, i) => ({ id: `cat-${i}`, name: name.trim() }));

    await this.persistRoom();
    this.broadcastRoomState();
  }

  // ── Lobby: Update Rounds ───────────────────────────────────────────────────

  private async handleRoundsUpdate(
    socket: WebSocket,
    playerId: string,
    cmd: { type: 'lobby:rounds:update'; requestId: string; totalRounds: number }
  ): Promise<void> {
    if (!this.isHost(playerId)) {
      this.sendTo(socket, {
        type: 'error',
        code: 'NOT_HOST',
        message: 'Only the host can update rounds',
        requestId: cmd.requestId,
      });
      return;
    }

    this.room.totalRounds = Math.max(1, Math.min(20, cmd.totalRounds));
    await this.persistRoom();
    this.broadcastRoomState();
  }

  // ── Game: Start ────────────────────────────────────────────────────────────

  private async handleGameStart(socket: WebSocket, playerId: string): Promise<void> {
    if (!this.isHost(playerId)) {
      this.sendTo(socket, {
        type: 'error',
        code: 'NOT_HOST',
        message: 'Only the host can start the game',
      });
      return;
    }

    if (this.room.players.filter((p) => p.status === 'active').length < 1) {
      this.sendTo(socket, {
        type: 'error',
        code: 'NOT_ENOUGH_PLAYERS',
        message: 'Need at least 1 player to start',
      });
      return;
    }

    await this.startNextRound();
  }

  // ── Round: Start ───────────────────────────────────────────────────────────

  private async startNextRound(): Promise<void> {
    const nextRound = this.room.currentRound + 1;

    if (nextRound > this.room.totalRounds) {
      await this.finishGame();
      return;
    }

    const letter = this.pickLetter();
    const roundId = `round-${nextRound}`;
    const deadline = Date.now() + ROUND_DURATION_MS;

    this.room.phase = 'ROUND_ACTIVE';
    this.room.currentRound = nextRound;
    this.room.currentLetter = letter;
    this.room.roundDeadline = deadline;

    const roundData: RoundData = {
      id: roundId,
      letter,
      answers: new Map(),
      stopperId: null,
      stopTime: null,
      submittedPlayers: new Set(),
    };
    this.rounds.set(roundId, roundData);
    this.currentRoundData = roundData;

    await this.persistRoom();

    this.broadcast({
      type: 'round:started',
      id: roundId,
      letter,
      categories: this.room.categories,
      deadline,
    });

    // Auto-expire round after deadline
    this.state.storage.setAlarm(deadline);
  }

  // ── Answer: Submit ─────────────────────────────────────────────────────────

  private async handleAnswerSubmit(
    socket: WebSocket,
    playerId: string,
    cmd: { type: 'answer:submit'; requestId: string; roundId: string; answers: Record<string, string> }
  ): Promise<void> {
    const roundData = this.rounds.get(cmd.roundId) ?? this.currentRoundData;
    if (!roundData || this.room.phase !== 'ROUND_ACTIVE') return;

    // Store answers (can be updated until stop)
    for (const [categoryId, value] of Object.entries(cmd.answers)) {
      const key = `${playerId}:${categoryId}`;
      roundData.answers.set(key, {
        playerId,
        categoryId,
        value: value.trim().toUpperCase(),
        isValid: true,
        invalidations: [],
        score: 0,
      });
    }

    roundData.submittedPlayers.add(playerId);
  }

  // ── Round: Stop ────────────────────────────────────────────────────────────

  private async handleRoundStop(
    socket: WebSocket,
    playerId: string,
    cmd: { type: 'round:stop'; requestId: string; roundId: string }
  ): Promise<void> {
    const roundData = this.rounds.get(cmd.roundId) ?? this.currentRoundData;
    if (!roundData || this.room.phase !== 'ROUND_ACTIVE') return;

    // First stop wins
    if (!roundData.stopperId) {
      roundData.stopperId = playerId;
      roundData.stopTime = Date.now();
    }

    // Give all players a short grace period (2s) to submit final answers
    // then move to review
    await this.beginCategoryReview(roundData);
  }

  // ── Category Review ────────────────────────────────────────────────────────

  private async beginCategoryReview(roundData: RoundData): Promise<void> {
    this.room.phase = 'CATEGORY_REVIEW';
    this.room.currentReviewCategoryIndex = 0;
    await this.persistRoom();
    await this.broadcastCategoryReview(roundData, 0);
  }

  private async broadcastCategoryReview(roundData: RoundData, categoryIndex: number): Promise<void> {
    const category = this.room.categories[categoryIndex];
    if (!category) {
      // All categories reviewed — show final results for round
      await this.computeRoundScoresAndAdvance(roundData);
      return;
    }

    const deadline = Date.now() + REVIEW_CATEGORY_DURATION_MS;
    this.room.reviewDeadline = deadline;
    this.room.currentReviewCategoryIndex = categoryIndex;

    // Collect answers for this category from all active players
    const answers: import('./types').Answer[] = this.room.players
      .filter((p) => p.status === 'active')
      .map((p) => {
        const key = `${p.id}:${category.id}`;
        return (
          roundData.answers.get(key) ?? {
            playerId: p.id,
            categoryId: category.id,
            value: '',
            isValid: false,
            invalidations: [],
            score: 0,
          }
        );
      });

    this.broadcast({
      type: 'round:review:category',
      categoryIndex,
      totalCategories: this.room.categories.length,
      category,
      answers,
      eligibleVoters: this.room.players.filter((p) => p.status === 'active').length,
      deadline,
    });

    // Auto-advance category after deadline
    this.state.storage.setAlarm(deadline);
  }

  // ── Answer: Invalidate ─────────────────────────────────────────────────────

  private async handleAnswerInvalidate(
    socket: WebSocket,
    playerId: string,
    cmd: { type: 'answer:invalidate'; requestId: string; roundId: string; categoryId: string; answerId: string }
  ): Promise<void> {
    const roundData = this.rounds.get(cmd.roundId) ?? this.currentRoundData;
    if (!roundData || this.room.phase !== 'CATEGORY_REVIEW') return;

    // answerId is "playerId-categoryId" from client
    const parts = cmd.answerId.split('-');
    const targetPlayerId = parts[0];
    const key = `${targetPlayerId}:${cmd.categoryId}`;

    const answer = roundData.answers.get(key);
    if (!answer) return;

    // Toggle vote
    const alreadyVoted = answer.invalidations.includes(playerId);
    if (alreadyVoted) {
      answer.invalidations = answer.invalidations.filter((id) => id !== playerId);
    } else {
      answer.invalidations.push(playerId);
    }

    // Calculate if invalidated using scoring helper (majority vote)
    const activePlayers = this.room.players.filter((p) => p.status === 'active').length;
    answer.isValid = !resolveInvalidation(answer.invalidations.length, activePlayers);

    // Broadcast live score update for current category
    const categoryIndex = this.room.currentReviewCategoryIndex ?? 0;
    const catScores = this._computeCategoryScores(roundData, this.room.categories[categoryIndex]);

    this.broadcast({
      type: 'round:review:score_update',
      categoryIndex,
      categoryScores: catScores,
      scoreboard: this.room.players,
    });
  }

  // ── Score Computation (delegates to scoring.ts) ────────────────────────────

  private _computeCategoryScores(
    roundData: RoundData,
    category: Category | undefined
  ): Record<string, number> {
    if (!category) return {};
    return computeCategoryScores(roundData, category, this.room.players).scores;
  }

  private async computeRoundScoresAndAdvance(roundData: RoundData): Promise<void> {
    // Initialise scores
    for (const player of this.room.players) {
      player.score = player.score ?? 0;
    }

    const snapshot: RoundSnapshot = {
      letter: roundData.letter,
      answers: roundData.answers,
      stopperId: roundData.stopperId,
    };

    const { roundPts } = computeRoundScores(snapshot, this.room.categories, this.room.players);

    for (const [pid, pts] of Object.entries(roundPts)) {
      const player = this.room.players.find((p) => p.id === pid);
      if (player) player.score += pts;
    }

    this.room.phase = 'ROUND_RESULTS';
    await this.persistRoom();

    const allAnswers = Array.from(roundData.answers.values());
    const ranking = [...this.room.players].sort((a, b) => b.score - a.score);

    this.broadcast({ type: 'round:results', answers: allAnswers, ranking });

    if (this.room.currentRound >= this.room.totalRounds) {
      await this.finishGame();
    }
  }

  // ── Game: Finish ───────────────────────────────────────────────────────────

  private async finishGame(): Promise<void> {
    this.room.phase = 'GAME_OVER';
    await this.persistRoom();

    const { podium, list } = buildFinalRanking(this.room.players);
    this.broadcast({ type: 'game:final_results', podium, list });
  }

  // ── Alarm (timeout handling) ───────────────────────────────────────────────

  async alarm(): Promise<void> {
    const now = Date.now();

    if (this.room.phase === 'ROUND_ACTIVE' && this.room.roundDeadline) {
      if (now >= this.room.roundDeadline - 1000) {
        // Round timer expired — move to review
        if (this.currentRoundData) {
          await this.beginCategoryReview(this.currentRoundData);
        }
        return;
      }
    }

    if (this.room.phase === 'CATEGORY_REVIEW' && this.room.reviewDeadline) {
      if (now >= this.room.reviewDeadline - 1000) {
        // Category review timer expired — advance to next category
        const nextIdx = (this.room.currentReviewCategoryIndex ?? 0) + 1;
        if (nextIdx < this.room.categories.length) {
          this.room.currentReviewCategoryIndex = nextIdx;
          if (this.currentRoundData) {
            await this.broadcastCategoryReview(this.currentRoundData, nextIdx);
          }
        } else {
          // All categories reviewed
          if (this.currentRoundData) {
            await this.computeRoundScoresAndAdvance(this.currentRoundData);
          }
        }
      }
    }
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  private isHost(playerId: string): boolean {
    return this.room.players.some((p) => p.id === playerId && p.isHost);
  }

  private setPlayerStatus(playerId: string, status: 'active' | 'disconnected'): void {
    const player = this.room.players.find((p) => p.id === playerId);
    if (player) {
      player.status = status;
      this.broadcast({
        type: 'player:presence',
        id: playerId,
        nickname: player.nickname,
        status,
      });
      this.persistRoom();
    }
  }

  private sendTo(socket: WebSocket, event: ServerEvent): void {
    try {
      socket.send(JSON.stringify(event));
    } catch (e) {
      console.error('[GameRoom] sendTo error:', e);
    }
  }

  private broadcast(event: ServerEvent): void {
    const msg = JSON.stringify(event);
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(msg);
      } catch {
        // ignore disconnected sockets
      }
    }
  }

  private broadcastRoomState(): void {
    this.broadcast({ type: 'room:state', state: this.room });
  }

  private async persistRoom(): Promise<void> {
    await this.state.storage.put('room', this.room);
  }

  private generateCode(): string {
    const chars = 'ABCDEFGHJKLMNPRSTUVWXY23456789';
    return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }

  private pickLetter(): string {
    return ALLOWED_LETTERS[Math.floor(Math.random() * ALLOWED_LETTERS.length)];
  }
}
