import type {
  Player,
  Category,
  Answer,
  RoomState,
  ClientCommand,
  ServerEvent,
} from './types';
import {
  passesLetterCheck,
  computeRoundScores,
  buildFinalRanking,
  type RoundSnapshot,
} from './scoring';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_PLAYERS = 20;
const MAX_COMMAND_BYTES = 16 * 1024;
const MAX_REQUEST_IDS = 4096;
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_NICKNAME_CODE_POINTS = 24;
const MAX_CATEGORY_CODE_POINTS = 40;
const MAX_CATEGORIES = 20;
const RESUME_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_ROUNDS = 5;
const DEFAULT_ROUND_DURATION_SECONDS = 60;
const ROUND_DURATIONS = [0, 60, 90, 120] as const;
const DEFAULT_ALLOWED_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const REVIEW_CATEGORY_DURATION_MS = 30_000; // 30 seconds per category review

const DEFAULT_CATEGORIES: Category[] = [
  { id: 'cat-0', name: 'Nome' },
  { id: 'cat-1', name: 'Cidade' },
  { id: 'cat-2', name: 'Animal' },
  { id: 'cat-3', name: 'Comida' },
  { id: 'cat-4', name: 'Objeto' },
];

// ── Per-round data ─────────────────────────────────────────────────────────────

interface RoundData {
  id: string;
  letter: string;
  answers: Map<string, Answer>; // key: `${playerId}:${categoryId}`
  stopperId: string | null; // who called stop
  stopTime: number | null;
  submittedPlayers: Set<string>;
  eligibleVoterIds: string[];
}

interface ResumeCredential {
  playerId: string;
  tokenVerifier: string;
  issuedAt: number;
  expiresAt: number;
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
  private sessionRoomCodes = new Map<WebSocket, string>();
  private negotiatedSockets = new Set<WebSocket>();
  private requestIds = new Set<string>();
  private requestIdOrder: string[] = [];
  private inFlightRequests = new Set<string>();
  private failedRequests = new Set<string>();

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
      roundDurationSeconds: DEFAULT_ROUND_DURATION_SECONDS,
      allowedLetters: [...DEFAULT_ALLOWED_LETTERS],
    };

    // Restore persisted state (hibernation support)
    this.state.blockConcurrencyWhile(async () => {
      const persisted = await this.state.storage.get<RoomState>('room');
      if (persisted) {
        this.room = {
          ...persisted,
          roundDurationSeconds: persisted.roundDurationSeconds ?? DEFAULT_ROUND_DURATION_SECONDS,
          allowedLetters: persisted.allowedLetters ?? [...DEFAULT_ALLOWED_LETTERS],
        };
      }
    });
  }

  // ── WebSocket lifecycle ─────────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/__allocate') {
      let allocation: unknown;
      try {
        allocation = await request.json();
      } catch {
        return Response.json({ error: 'INVALID_ALLOCATION' }, { status: 400 });
      }

      const code =
        allocation && typeof allocation === 'object' && 'code' in allocation
          ? String(allocation.code).toUpperCase()
          : '';
      if (!/^[ABCDEFGHJKLMNPRSTUVWXY23456789]{6}$/.test(code)) {
        return Response.json({ error: 'INVALID_ALLOCATION' }, { status: 400 });
      }
      if (this.room.code || this.room.phase !== 'WAITING_PLAYERS') {
        return Response.json({ error: 'ROOM_ALREADY_EXISTS' }, { status: 409 });
      }

      this.room.code = code;
      await this.persistRoom();
      return Response.json({ code }, { status: 201 });
    }

    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return Response.json({ error: 'WEBSOCKET_REQUIRED' }, { status: 426 });
    }

    const roomCode = url.pathname.match(/^\/rooms\/([A-Za-z0-9-]+)\/?$/)?.[1]?.toUpperCase() ?? '';
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    const playerId = crypto.randomUUID();

    this.state.acceptWebSocket(server, [playerId]);
    this.sessions.set(server, playerId);
    this.sessionRoomCodes.set(server, roomCode);

    this.sendTo(server, {
      type: 'session:ready',
      playerId,
      supportedProtocolVersions: [1],
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    const playerId = this.sessions.get(socket);
    if (!playerId) return;

    if (typeof message !== 'string') {
      this.sendError(socket, 'INVALID_MESSAGE', 'Only text messages are supported');
      return;
    }

    if (new TextEncoder().encode(message).byteLength > MAX_COMMAND_BYTES) {
      this.sendError(socket, 'PAYLOAD_TOO_LARGE', 'Command payload exceeds 16 KiB');
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(message);
    } catch {
      this.sendError(socket, 'INVALID_JSON', 'Cannot parse JSON');
      return;
    }

    if (
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      typeof (payload as Record<string, unknown>).type !== 'string'
    ) {
      this.sendError(socket, 'INVALID_COMMAND', 'Command must be a JSON object with a type');
      return;
    }

    const commandPayload = payload as Record<string, unknown>;
    const requestId = commandPayload.requestId;
    if (
      typeof requestId !== 'string' ||
      requestId.trim().length === 0 ||
      requestId.length > MAX_REQUEST_ID_LENGTH
    ) {
      this.sendError(socket, 'INVALID_REQUEST_ID', 'A valid requestId is required');
      return;
    }

    if (commandPayload.type === 'session:hello') {
      if (this.negotiatedSockets.has(socket)) {
        this.sendError(socket, 'INVALID_PHASE', 'Protocol negotiation already completed', requestId);
        return;
      }
      if (commandPayload.protocolVersion !== 1) {
        this.sendError(socket, 'PROTOCOL_UNSUPPORTED', 'Protocol version is not supported', requestId);
        return;
      }
      if (!this.rememberRequestId(playerId, requestId)) {
        this.sendError(socket, 'ALREADY_PROCESSED', 'This request was already processed', requestId);
        return;
      }

      this.negotiatedSockets.add(socket);
      this.sendTo(socket, {
        type: 'session:ready',
        playerId,
        supportedProtocolVersions: [1],
        negotiatedProtocolVersion: 1,
      });
      this.sendTo(socket, {
        type: 'command:ack',
        requestId,
        commandType: 'session:hello',
        status: 'committed',
      });
      return;
    }

    if (!this.negotiatedSockets.has(socket)) {
      this.sendError(socket, 'PROTOCOL_REQUIRED', 'Send session:hello before room commands', requestId);
      return;
    }

    if (!this.rememberRequestId(playerId, requestId)) {
      this.sendError(socket, 'ALREADY_PROCESSED', 'This request was already processed', requestId, false);
      return;
    }

    const cmd = payload as ClientCommand;
    const requestKey = this.requestKey(playerId, requestId);
    this.inFlightRequests.add(requestKey);
    this.handleCommand(socket, playerId, cmd).then(() => {
      this.inFlightRequests.delete(requestKey);
      if (this.failedRequests.delete(requestKey)) return;
      this.sendTo(socket, {
        type: 'command:ack',
        requestId,
        commandType: cmd.type,
        status: 'committed',
      });
    }).catch((err) => {
      console.error('[GameRoom] handleCommand error:', err);
      this.sendError(socket, 'INTERNAL_ERROR', 'An unexpected server error occurred', requestId);
      this.inFlightRequests.delete(requestKey);
      this.failedRequests.delete(requestKey);
    });
  }

  webSocketClose(socket: WebSocket): void {
    const playerId = this.sessions.get(socket);
    if (playerId) {
      this.sessions.delete(socket);
      this.sessionRoomCodes.delete(socket);
      this.negotiatedSockets.delete(socket);
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
      case 'session:resume':
        return this.handleSessionResume(socket, playerId, cmd);
      case 'room:create':
        return this.handleRoomCreate(socket, playerId, cmd);
      case 'room:join':
        return this.handleRoomJoin(socket, playerId, cmd);
      case 'lobby:categories:update':
        return this.handleCategoriesUpdate(socket, playerId, cmd);
      case 'lobby:rounds:update':
        return this.handleRoundsUpdate(socket, playerId, cmd);
      case 'lobby:options:update':
        return this.handleOptionsUpdate(socket, playerId, cmd);
      case 'game:start':
        return this.handleGameStart(socket, playerId, cmd);
      case 'answer:submit':
        return this.handleAnswerSubmit(socket, playerId, cmd);
      case 'round:stop':
        return this.handleRoundStop(socket, playerId, cmd);
      case 'answer:vote':
        return this.handleAnswerVote(socket, playerId, cmd);
      default:
        this.sendError(socket, 'UNKNOWN_COMMAND', 'Unknown command type', cmd.requestId);
    }
  }

  // ── Room: Create ───────────────────────────────────────────────────────────

  private async handleRoomCreate(
    socket: WebSocket,
    playerId: string,
    cmd: {
      type: 'room:create';
      requestId: string;
      nickname: string;
      totalRounds?: number;
      roundDurationSeconds?: 0 | 60 | 90 | 120;
      allowedLetters?: string[];
    }
  ): Promise<void> {
    const requestedCode = this.sessionRoomCodes.get(socket);
    if (!this.room.code || !requestedCode || requestedCode !== this.room.code) {
      this.sendError(socket, 'ROOM_NOT_FOUND', 'Room code has not been allocated', cmd.requestId);
      return;
    }
    if (this.room.phase !== 'WAITING_PLAYERS' || this.room.players.length > 0) {
      this.sendError(socket, 'ROOM_ALREADY_EXISTS', 'Room already initialized', cmd.requestId);
      return;
    }

    const nickname = cmd.nickname.trim();
    if (!this.isValidNickname(nickname)) {
      this.sendError(socket, 'INVALID_NICKNAME', 'Nickname must contain 1 to 24 characters', cmd.requestId);
      return;
    }
    const roundDurationSeconds = cmd.roundDurationSeconds ?? DEFAULT_ROUND_DURATION_SECONDS;
    const allowedLetters = cmd.allowedLetters ?? DEFAULT_ALLOWED_LETTERS;
    const normalizedAllowedLetters = this.validateAllowedLetters(allowedLetters);
    if (!this.isValidRoundDuration(roundDurationSeconds) || !normalizedAllowedLetters) {
      this.sendError(socket, 'INVALID_CONFIGURATION', 'Round duration or allowed letters are invalid', cmd.requestId);
      return;
    }

    const hostPlayer: Player = {
      id: playerId,
      nickname,
      isHost: true,
      status: 'active',
      score: 0,
    };

    this.room = {
      code: requestedCode,
      phase: 'CONFIGURING',
      players: [hostPlayer],
      categories: DEFAULT_CATEGORIES,
      currentRound: 0,
      totalRounds: cmd.totalRounds ?? DEFAULT_ROUNDS,
      roundDurationSeconds,
      allowedLetters: normalizedAllowedLetters,
    };

    await this.persistRoom();
    this.broadcastRoomState();
    await this.issueResumeCredential(socket, playerId, cmd.requestId);
  }

  // ── Room: Join ─────────────────────────────────────────────────────────────

  private async handleRoomJoin(
    socket: WebSocket,
    playerId: string,
    cmd: { type: 'room:join'; requestId: string; code: string; nickname: string }
  ): Promise<void> {
    const requestedCode = this.sessionRoomCodes.get(socket);
    if (
      !this.room.code ||
      !requestedCode ||
      requestedCode !== this.room.code ||
      cmd.code.trim().toUpperCase() !== this.room.code
    ) {
      this.sendError(socket, 'ROOM_NOT_FOUND', 'Room does not exist', cmd.requestId);
      return;
    }
    if (this.room.phase !== 'CONFIGURING') {
      this.sendError(socket, 'INVALID_PHASE', 'Room is not accepting new players', cmd.requestId);
      return;
    }

    const nickname = cmd.nickname.trim();

    if (!this.isValidNickname(nickname)) {
      this.sendError(socket, 'INVALID_NICKNAME', 'Nickname must contain 1 to 24 characters', cmd.requestId);
      return;
    }

    if (this.room.players.filter((player) => player.status === 'active').length >= MAX_PLAYERS) {
      this.sendError(socket, 'ROOM_FULL', 'Room is full', cmd.requestId);
      return;
    }

    if (
      this.room.players.some(
        (p) => p.nickname.toLowerCase() === nickname.toLowerCase() && p.status === 'active'
      )
    ) {
      this.sendError(socket, 'DUPLICATE_NICKNAME', 'Nickname already in use', cmd.requestId);
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
    await this.issueResumeCredential(socket, playerId, cmd.requestId);
  }

  private async handleSessionResume(
    socket: WebSocket,
    temporaryPlayerId: string,
    cmd: Extract<ClientCommand, { type: 'session:resume' }>,
  ): Promise<void> {
    if (!cmd.resumeToken || cmd.resumeToken.length > 256) {
      this.sendError(socket, 'SESSION_INVALID', 'This room session is invalid or expired', cmd.requestId);
      return;
    }

    const tokenVerifier = await this.hashResumeToken(cmd.resumeToken);
    const credentials = await this.state.storage.get<ResumeCredential[]>('resumeCredentials') ?? [];
    const now = Date.now();
    const credential = credentials.find(
      (entry) => entry.tokenVerifier === tokenVerifier && entry.expiresAt > now,
    );
    const player = credential
      ? this.room.players.find((entry) => entry.id === credential.playerId)
      : undefined;
    if (!credential || !player) {
      const remaining = credentials.filter((entry) => entry.expiresAt > now);
      await this.state.storage.put('resumeCredentials', remaining);
      this.sendError(socket, 'SESSION_INVALID', 'This room session is invalid or expired', cmd.requestId);
      return;
    }

    for (const [existingSocket, existingPlayerId] of this.sessions) {
      if (existingPlayerId === player.id && existingSocket !== socket) {
        this.sessions.delete(existingSocket);
        this.sessionRoomCodes.delete(existingSocket);
        this.negotiatedSockets.delete(existingSocket);
        try {
          existingSocket.close(1000, 'Session resumed on another connection');
        } catch (error) {
          console.error('[GameRoom] Failed to close replaced session:', error);
        }
      }
    }

    this.sessions.set(socket, player.id);
    player.status = 'active';
    const rotatedToken = await this.rotateResumeCredential(credentials, credential, now);
    await this.persistRoom();

    this.sendTo(socket, {
      type: 'session:resumed',
      requestId: cmd.requestId,
      playerId: player.id,
      resumeToken: rotatedToken,
      state: this.room,
    });
    this.broadcast({
      type: 'player:presence',
      id: player.id,
      nickname: player.nickname,
      status: 'active',
    });
    this.broadcastRoomState();
    this.replayCurrentPhase(socket);
  }

  private async issueResumeCredential(
    socket: WebSocket,
    playerId: string,
    requestId: string,
  ): Promise<void> {
    const now = Date.now();
    const token = this.createResumeToken();
    const credentials = (await this.state.storage.get<ResumeCredential[]>('resumeCredentials') ?? [])
      .filter((entry) => entry.expiresAt > now && entry.playerId !== playerId);
    credentials.push({
      playerId,
      tokenVerifier: await this.hashResumeToken(token),
      issuedAt: now,
      expiresAt: now + RESUME_TOKEN_TTL_MS,
    });
    await this.state.storage.put('resumeCredentials', credentials);
    this.sendTo(socket, {
      type: 'room:joined',
      requestId,
      playerId,
      resumeToken: token,
    });
  }

  private async rotateResumeCredential(
    credentials: ResumeCredential[],
    current: ResumeCredential,
    now: number,
  ): Promise<string> {
    const token = this.createResumeToken();
    const updated = credentials.filter(
      (entry) => entry.expiresAt > now && entry.playerId !== current.playerId,
    );
    updated.push({
      playerId: current.playerId,
      tokenVerifier: await this.hashResumeToken(token),
      issuedAt: now,
      expiresAt: now + RESUME_TOKEN_TTL_MS,
    });
    await this.state.storage.put('resumeCredentials', updated);
    return token;
  }

  private createResumeToken(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  private async hashResumeToken(token: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  private replayCurrentPhase(socket: WebSocket): void {
    const round = this.currentRoundData;
    if (!round) return;

    if (this.room.phase === 'ROUND_ACTIVE') {
      this.sendTo(socket, {
        type: 'round:started',
        id: round.id,
        roundId: round.id,
        roundNumber: this.room.currentRound,
        letter: round.letter,
        categories: this.room.categories,
        deadline: this.room.roundDeadline,
      });
    } else if (this.room.phase === 'CATEGORY_REVIEW') {
      const event = this.buildCategoryReviewEvent(
        round,
        this.room.currentReviewCategoryIndex ?? 0,
      );
      if (event) this.sendTo(socket, event);
    } else if (this.room.phase === 'ROUND_RESULTS') {
      this.sendTo(socket, {
        type: 'round:results',
        answers: Array.from(round.answers.values()),
        ranking: [...this.room.players].sort((a, b) => b.score - a.score),
      });
    }
  }

  // ── Lobby: Update Categories ───────────────────────────────────────────────

  private async handleCategoriesUpdate(
    socket: WebSocket,
    playerId: string,
    cmd: { type: 'lobby:categories:update'; requestId: string; categories: string[] }
  ): Promise<void> {
    if (!this.validateLobbyMutation(socket, playerId, cmd.requestId)) {
      return;
    }

    const categories = this.validateCategories(cmd.categories);
    if (!categories) {
      this.sendError(
        socket,
        'INVALID_CONFIGURATION',
        'Choose 1 to 20 unique category names, each 1 to 40 characters long',
        cmd.requestId,
      );
      return;
    }

    this.room.categories = categories.map((name, index) => ({ id: `cat-${index}`, name }));

    await this.persistRoom();
    this.broadcastRoomState();
  }

  // ── Lobby: Update Rounds ───────────────────────────────────────────────────

  private async handleRoundsUpdate(
    socket: WebSocket,
    playerId: string,
    cmd: { type: 'lobby:rounds:update'; requestId: string; totalRounds: number }
  ): Promise<void> {
    if (!this.validateLobbyMutation(socket, playerId, cmd.requestId)) {
      return;
    }

    if (!Number.isInteger(cmd.totalRounds) || cmd.totalRounds < 1 || cmd.totalRounds > 20) {
      this.sendError(
        socket,
        'INVALID_CONFIGURATION',
        'Round count must be an integer from 1 to 20',
        cmd.requestId,
      );
      return;
    }

    this.room.totalRounds = cmd.totalRounds;
    await this.persistRoom();
    this.broadcastRoomState();
  }

  private async handleOptionsUpdate(
    socket: WebSocket,
    playerId: string,
    cmd: Extract<ClientCommand, { type: 'lobby:options:update' }>,
  ): Promise<void> {
    if (!this.validateLobbyMutation(socket, playerId, cmd.requestId)) {
      return;
    }

    const allowedLetters = this.validateAllowedLetters(cmd.allowedLetters);
    if (!this.isValidRoundDuration(cmd.roundDurationSeconds) || !allowedLetters) {
      this.sendError(
        socket,
        'INVALID_CONFIGURATION',
        'Choose a duration of 0, 60, 90, or 120 seconds and at least one unique letter from A to Z',
        cmd.requestId,
      );
      return;
    }

    this.room.roundDurationSeconds = cmd.roundDurationSeconds;
    this.room.allowedLetters = allowedLetters;
    await this.persistRoom();
    this.broadcastRoomState();
  }

  // ── Game: Start ────────────────────────────────────────────────────────────

  private async handleGameStart(
    socket: WebSocket,
    playerId: string,
    cmd: Extract<ClientCommand, { type: 'game:start' }>,
  ): Promise<void> {
    if (!this.isHost(playerId)) {
      this.sendError(socket, 'NOT_HOST', 'Only the host can start the game', cmd.requestId);
      return;
    }

    if (this.room.phase !== 'CONFIGURING') {
      this.sendError(socket, 'INVALID_PHASE', 'The game can only start during configuration', cmd.requestId);
      return;
    }

    if (this.room.players.filter((player) => player.status === 'active').length < 2) {
      this.sendError(socket, 'NOT_ENOUGH_PLAYERS', 'At least two active players are required', cmd.requestId);
      return;
    }

    if (
      !Number.isInteger(this.room.totalRounds) ||
      this.room.totalRounds < 1 ||
      this.room.totalRounds > 20 ||
      !this.validateCategories(this.room.categories.map((category) => category.name)) ||
      !this.isValidRoundDuration(this.room.roundDurationSeconds) ||
      !this.validateAllowedLetters(this.room.allowedLetters)
    ) {
      this.sendError(socket, 'INVALID_CONFIGURATION', 'Room settings are not valid', cmd.requestId);
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
    const duration = this.room.roundDurationSeconds;
    if (!this.isValidRoundDuration(duration)) {
      throw new Error('Room has no valid round duration configuration');
    }
    const deadline = duration === 0 ? undefined : Date.now() + duration * 1000;

    this.room.phase = 'ROUND_ACTIVE';
    this.room.currentRound = nextRound;
    this.room.currentLetter = letter;
    this.room.roundDeadline = deadline;
    this.room.currentRoundId = roundId;
    this.room.reviewDeadline = undefined;
    this.room.currentReviewCategoryIndex = undefined;

    const roundData: RoundData = {
      id: roundId,
      letter,
      answers: new Map(),
      stopperId: null,
      stopTime: null,
      submittedPlayers: new Set(),
      eligibleVoterIds: [],
    };
    this.rounds.set(roundId, roundData);
    this.currentRoundData = roundData;

    await this.persistRoom();

    this.broadcast({
      type: 'round:started',
      id: roundId,
      roundId,
      roundNumber: nextRound,
      letter,
      categories: this.room.categories,
      deadline,
    });

    // Auto-expire round after deadline
    if (deadline !== undefined) {
      await this.state.storage.setAlarm(deadline);
    } else {
      await this.state.storage.deleteAlarm();
    }
  }

  // ── Answer: Submit ─────────────────────────────────────────────────────────

  private async handleAnswerSubmit(
    socket: WebSocket,
    playerId: string,
    cmd: { type: 'answer:submit'; requestId: string; roundId: string; answers: Record<string, string> }
  ): Promise<void> {
    const roundData = this.currentRoundData;
    const player = this.room.players.find((entry) => entry.id === playerId);
    if (!player || player.status !== 'active') {
      this.sendError(socket, 'INVALID_ANSWER', 'Only active players can submit answers', cmd.requestId);
      return;
    }
    if (
      this.room.phase !== 'ROUND_ACTIVE' ||
      !roundData ||
      cmd.roundId !== roundData.id ||
      this.room.currentRoundId !== roundData.id
    ) {
      this.sendError(socket, 'ROUND_CLOSED', 'This round is no longer accepting answers', cmd.requestId);
      return;
    }
    if (this.room.roundDeadline !== undefined && Date.now() >= this.room.roundDeadline) {
      await this.beginCategoryReview(roundData);
      this.sendError(socket, 'ROUND_CLOSED', 'The round deadline has passed', cmd.requestId);
      return;
    }
    if (
      !cmd.answers ||
      typeof cmd.answers !== 'object' ||
      Array.isArray(cmd.answers) ||
      Object.entries(cmd.answers).some(
        ([categoryId, value]) =>
          !this.room.categories.some((category) => category.id === categoryId) ||
          typeof value !== 'string',
      )
    ) {
      this.sendError(socket, 'INVALID_ANSWER', 'Answers must contain only known categories and text values', cmd.requestId);
      return;
    }

    for (const [categoryId, value] of Object.entries(cmd.answers)) {
      const normalizedValue = value.trim().toUpperCase();
      const key = `${playerId}:${categoryId}`;
      roundData.answers.set(key, {
        playerId,
        categoryId,
        value: normalizedValue,
        isValid: passesLetterCheck(normalizedValue, roundData.letter),
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
    const roundData = this.currentRoundData;
    const player = this.room.players.find((entry) => entry.id === playerId);
    if (!player || player.status !== 'active') {
      this.sendError(socket, 'INVALID_PHASE', 'Only active players can stop the round', cmd.requestId);
      return;
    }
    if (
      this.room.phase !== 'ROUND_ACTIVE' ||
      !roundData ||
      cmd.roundId !== roundData.id ||
      this.room.currentRoundId !== roundData.id
    ) {
      this.sendError(socket, 'ROUND_CLOSED', 'This round is already closed', cmd.requestId);
      return;
    }
    if (this.room.roundDeadline !== undefined && Date.now() >= this.room.roundDeadline) {
      await this.beginCategoryReview(roundData);
      this.sendError(socket, 'ROUND_CLOSED', 'The round deadline has passed', cmd.requestId);
      return;
    }

    roundData.stopperId = playerId;
    roundData.stopTime = Date.now();
    await this.beginCategoryReview(roundData);
  }

  // ── Category Review ────────────────────────────────────────────────────────

  private async beginCategoryReview(roundData: RoundData): Promise<void> {
    this.room.phase = 'CATEGORY_REVIEW';
    this.room.roundDeadline = undefined;
    this.room.currentReviewCategoryIndex = 0;
    this.room.reviewDeadline = undefined;
    roundData.eligibleVoterIds = this.room.players
      .filter((player) => player.status === 'active')
      .map((player) => player.id);
    for (const answer of roundData.answers.values()) {
      answer.eligibleVoters = roundData.eligibleVoterIds.filter(
        (voterId) => voterId !== answer.playerId,
      );
      answer.votes ??= {};
    }
    await this.persistRoom();
    await this.broadcastCategoryReview(roundData, 0);
  }

  private async broadcastCategoryReview(roundData: RoundData, categoryIndex: number): Promise<void> {
    const event = this.buildCategoryReviewEvent(roundData, categoryIndex);
    if (!event) {
      // All categories reviewed — show final results for round
      await this.computeRoundScoresAndAdvance(roundData);
      return;
    }

    this.broadcast(event);

    // Auto-advance category after deadline
    if (event.deadline) this.state.storage.setAlarm(event.deadline);
  }

  private buildCategoryReviewEvent(
    roundData: RoundData,
    categoryIndex: number,
  ): Extract<ServerEvent, { type: 'round:review:category' }> | null {
    const category = this.room.categories[categoryIndex];
    if (!category) return null;

    const deadline = this.room.reviewDeadline ?? Date.now() + REVIEW_CATEGORY_DURATION_MS;
    this.room.reviewDeadline = deadline;
    this.room.currentReviewCategoryIndex = categoryIndex;
    const answers: Answer[] = roundData.eligibleVoterIds
      .map((playerId) => this.room.players.find((player) => player.id === playerId))
      .filter((player): player is Player => Boolean(player))
      .map((player) =>
        roundData.answers.get(`${player.id}:${category.id}`) ?? {
          playerId: player.id,
          categoryId: category.id,
          value: '',
          isValid: false,
          invalidations: [],
          votes: {},
          eligibleVoters: roundData.eligibleVoterIds.filter((voterId) => voterId !== player.id),
          score: 0,
        })
      .map((answer) => ({
        ...answer,
        votes: answer.votes ?? {},
        eligibleVoters: roundData.eligibleVoterIds.filter((voterId) => voterId !== answer.playerId),
      }));

    return {
      type: 'round:review:category',
      categoryIndex,
      totalCategories: this.room.categories.length,
      category,
      answers,
      eligibleVoters: roundData.eligibleVoterIds.length,
      deadline,
    };
  }

  // ── Answer: Vote ───────────────────────────────────────────────────────────

  private async handleAnswerVote(
    socket: WebSocket,
    playerId: string,
    cmd: Extract<ClientCommand, { type: 'answer:vote' }>,
  ): Promise<void> {
    const player = this.room.players.find((entry) => entry.id === playerId);
    if (!player || player.status !== 'active') {
      this.sendError(socket, 'NOT_ELIGIBLE', 'Only active room players may vote', cmd.requestId);
      return;
    }

    const roundData = this.currentRoundData;
    if (
      this.room.phase !== 'CATEGORY_REVIEW' ||
      !roundData ||
      cmd.roundId !== roundData.id ||
      this.room.currentRoundId !== roundData.id
    ) {
      this.sendError(socket, 'ROUND_CLOSED', 'This round is not accepting votes', cmd.requestId);
      return;
    }
    if (this.room.reviewDeadline !== undefined && Date.now() >= this.room.reviewDeadline) {
      this.sendError(socket, 'ROUND_CLOSED', 'The active category deadline has passed', cmd.requestId);
      return;
    }

    const currentCategory = this.room.categories[this.room.currentReviewCategoryIndex ?? -1];
    if (!currentCategory || cmd.categoryId !== currentCategory.id) {
      this.sendError(socket, 'INVALID_VOTE', 'Votes are accepted only for the active category', cmd.requestId);
      return;
    }
    if (cmd.decision !== 'valid' && cmd.decision !== 'invalidate') {
      this.sendError(socket, 'INVALID_VOTE', 'Vote decision must be valid or invalidate', cmd.requestId);
      return;
    }
    if (!roundData.eligibleVoterIds.includes(playerId)) {
      this.sendError(socket, 'NOT_ELIGIBLE', 'This player is not eligible to vote in this review', cmd.requestId);
      return;
    }

    const answer = roundData.answers.get(`${cmd.answerPlayerId}:${cmd.categoryId}`);
    if (!answer || !answer.isValid || !answer.value.trim()) {
      this.sendError(socket, 'INVALID_VOTE', 'The target answer is not eligible for voting', cmd.requestId);
      return;
    }
    if (answer.playerId === playerId) {
      this.sendError(socket, 'SELF_VOTE', 'Players cannot vote on their own answers', cmd.requestId);
      return;
    }

    const eligibleVoters = roundData.eligibleVoterIds.filter((voterId) => voterId !== answer.playerId);
    if (!eligibleVoters.includes(playerId)) {
      this.sendError(socket, 'NOT_ELIGIBLE', 'The answer author is excluded from its eligible voters', cmd.requestId);
      return;
    }

    answer.eligibleVoters = eligibleVoters;
    answer.votes = { ...answer.votes, [playerId]: cmd.decision };
    answer.invalidations = Object.entries(answer.votes)
      .filter(([voterId, decision]) => eligibleVoters.includes(voterId) && decision === 'invalidate')
      .map(([voterId]) => voterId);

    const event = this.buildCategoryReviewEvent(
      roundData,
      this.room.currentReviewCategoryIndex ?? 0,
    );
    if (event) this.broadcast(event);
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

    if (this.room.phase === 'ROUND_ACTIVE' && this.room.roundDeadline !== undefined) {
      if (now >= this.room.roundDeadline) {
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
          this.room.reviewDeadline = undefined;
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

  private isValidNickname(nickname: string): boolean {
    const length = Array.from(nickname).length;
    return length > 0 && length <= MAX_NICKNAME_CODE_POINTS;
  }

  private isValidRoundDuration(duration: unknown): duration is 0 | 60 | 90 | 120 {
    return typeof duration === 'number' && ROUND_DURATIONS.some((value) => value === duration);
  }

  private validateAllowedLetters(letters: unknown): string[] | null {
    if (
      !Array.isArray(letters) ||
      letters.length < 1 ||
      letters.length > DEFAULT_ALLOWED_LETTERS.length ||
      !letters.every((letter): letter is string => typeof letter === 'string' && /^[A-Z]$/.test(letter)) ||
      new Set(letters).size !== letters.length
    ) {
      return null;
    }
    return [...letters];
  }

  private validateCategories(categories: unknown): string[] | null {
    if (
      !Array.isArray(categories) ||
      categories.length < 1 ||
      categories.length > MAX_CATEGORIES ||
      !categories.every((category): category is string => typeof category === 'string')
    ) {
      return null;
    }

    const normalized = categories.map((category) => category.trim());
    const names = new Set<string>();
    for (const name of normalized) {
      const length = Array.from(name).length;
      const key = name.toLowerCase();
      if (length < 1 || length > MAX_CATEGORY_CODE_POINTS || names.has(key)) return null;
      names.add(key);
    }
    return normalized;
  }

  private validateLobbyMutation(socket: WebSocket, playerId: string, requestId: string): boolean {
    if (!this.isHost(playerId)) {
      this.sendError(socket, 'NOT_HOST', 'Only the host can update room settings', requestId);
      return false;
    }
    if (this.room.phase !== 'CONFIGURING') {
      this.sendError(socket, 'INVALID_PHASE', 'Room settings can only change during configuration', requestId);
      return false;
    }
    return true;
  }

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

  private requestKey(playerId: string, requestId: string): string {
    return `${playerId}\u0000${requestId}`;
  }

  private rememberRequestId(playerId: string, requestId: string): boolean {
    const key = this.requestKey(playerId, requestId);
    if (this.requestIds.has(key)) return false;

    this.requestIds.add(key);
    this.requestIdOrder.push(key);
    if (this.requestIdOrder.length > MAX_REQUEST_IDS) {
      const expiredKey = this.requestIdOrder.shift();
      if (expiredKey) this.requestIds.delete(expiredKey);
    }
    return true;
  }

  private sendError(
    socket: WebSocket,
    code: string,
    message: string,
    requestId?: string,
    trackFailure = true,
  ): void {
    const playerId = this.sessions.get(socket);
    if (trackFailure && playerId && requestId) {
      const key = this.requestKey(playerId, requestId);
      if (this.inFlightRequests.has(key)) this.failedRequests.add(key);
    }
    this.sendTo(socket, { type: 'error', code, message, requestId });
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

  private pickLetter(): string {
    const letters = this.validateAllowedLetters(this.room.allowedLetters);
    if (!letters) throw new Error('Room has no valid allowed-letter configuration');
    return letters[Math.floor(Math.random() * letters.length)];
  }
}
