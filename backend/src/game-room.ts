import { AVATAR_OPTIONS } from '../../shared/types';
import type {
  Player,
  Category,
  Answer,
  RoomState,
  GamePhase,
  Avatar,
  ClientCommand,
  ServerEvent,
} from './types';
import {
  passesLetterCheck,
  computeCategoryScores,
  buildFinalRanking,
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
const IDLE_ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const COMPLETED_ROOM_TTL_MS = 60 * 60 * 1000;

const DEFAULT_CATEGORIES: Category[] = [
  { id: 'cat-0', name: 'Nome' },
  { id: 'cat-1', name: 'Cidade' },
  { id: 'cat-2', name: 'Animal' },
  { id: 'cat-3', name: 'Comida' },
  { id: 'cat-4', name: 'Objeto' },
];

const MUTATION_PHASES: Partial<Record<ClientCommand['type'], GamePhase>> = {
  'lobby:categories:update': 'CONFIGURING',
  'lobby:rounds:update': 'CONFIGURING',
  'lobby:options:update': 'CONFIGURING',
  'game:start': 'CONFIGURING',
  'answer:submit': 'ROUND_ACTIVE',
  'round:stop': 'ROUND_ACTIVE',
  'answer:vote': 'CATEGORY_REVIEW',
  'round:next': 'ROUND_RESULTS',
  'round:review:next': 'CATEGORY_REVIEW',
};
const HOST_ONLY_COMMANDS = new Set<ClientCommand['type']>([
  'lobby:categories:update',
  'lobby:rounds:update',
  'lobby:options:update',
  'game:start',
  'round:next',
  'round:review:next',
  'room:close',
]);

/** Phases where room:leave / room:close are accepted (multi-phase; not in MUTATION_PHASES). */
const ROOM_LIFECYCLE_PHASES = new Set<GamePhase>([
  'WAITING_PLAYERS',
  'CONFIGURING',
  'ROUND_ACTIVE',
  'CATEGORY_REVIEW',
  'ROUND_RESULTS',
]);

const MATCH_PHASES = new Set<GamePhase>([
  'ROUND_ACTIVE',
  'CATEGORY_REVIEW',
  'ROUND_RESULTS',
]);

function isAvatar(value: unknown): value is Avatar {
  return typeof value === 'string' && AVATAR_OPTIONS.some((avatar) => avatar === value);
}

// ── Per-round data ─────────────────────────────────────────────────────────────

interface RoundData {
  id: string;
  letter: string;
  answers: Map<string, Answer>; // key: `${playerId}:${categoryId}`
  stopperId: string | null; // who called stop
  stopTime: number | null;
  submittedPlayers: Set<string>;
  eligibleVoterIds: string[];
  scoredCategoryIndexes: Set<number>;
  roundBonusApplied: boolean;
}

interface PersistedRoundData {
  id: string;
  letter: string;
  answers: [string, Answer][];
  stopperId: string | null;
  stopTime: number | null;
  submittedPlayers: string[];
  eligibleVoterIds: string[];
  scoredCategoryIndexes: number[];
  roundBonusApplied: boolean;
}

interface PersistedGameState {
  room: RoomState;
  roundData: PersistedRoundData | null;
}

interface ResumeCredential {
  playerId: string;
  tokenVerifier: string;
  issuedAt: number;
  expiresAt: number;
}

interface SocketAttachment {
  playerId: string;
  roomCode: string;
  negotiated: boolean;
}

// ── GameRoom Durable Object ────────────────────────────────────────────────────

export class GameRoom implements DurableObject {
  private readonly state: DurableObjectState;
  private readonly initialization: Promise<void>;

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
  private commandQueue: Promise<void> = Promise.resolve();

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
    this.initialization = this.state.blockConcurrencyWhile(async () => {
      const saved = await this.state.storage.get<PersistedGameState>('gameState');
      const persistedRoom = saved?.room ?? await this.state.storage.get<RoomState>('room');
      let expirationNeedsPersist = false;
      if (persistedRoom) {
        const playersList = Array.isArray(persistedRoom.players) ? persistedRoom.players : [];
        const legacyJoinBase = Date.now() - playersList.length;
        this.room = {
          ...persistedRoom,
          players: playersList.map((player, index) => ({
            ...player,
            joinedAt: player.joinedAt ?? legacyJoinBase + index,
          })),
          roundDurationSeconds: persistedRoom.roundDurationSeconds ?? DEFAULT_ROUND_DURATION_SECONDS,
          allowedLetters: persistedRoom.allowedLetters ?? [...DEFAULT_ALLOWED_LETTERS],
        };
        if (
          (this.room.phase === 'WAITING_PLAYERS' || this.room.phase === 'CONFIGURING') &&
          this.room.expiresAt === undefined
        ) {
          this.room.lastActivityAt ??= Date.now();
          this.room.expiresAt = this.room.lastActivityAt + IDLE_ROOM_TTL_MS;
          expirationNeedsPersist = true;
        } else if (this.room.phase === 'GAME_OVER' && this.room.expiresAt === undefined) {
          this.room.completedAt ??= Date.now();
          this.room.expiresAt = this.room.completedAt + COMPLETED_ROOM_TTL_MS;
          expirationNeedsPersist = true;
        }
      }

      const persistedRound =
        saved?.roundData ?? await this.state.storage.get<PersistedRoundData>('roundData');
      if (persistedRound) {
        const roundData = this.restoreRoundData(persistedRound);
        this.rounds.set(roundData.id, roundData);
        this.currentRoundData = roundData;
      }
      if (expirationNeedsPersist) {
        await this.state.storage.put('gameState', {
          room: this.room,
          roundData: persistedRound ?? null,
        } satisfies PersistedGameState);
        await this.state.storage.put('room', this.room);
      }
      await this.reconcilePersistedDeadline();
      this.restoreSocketSessions();
    });
  }

  // ── WebSocket lifecycle ─────────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    await this.initialization;
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

    if (request.method === 'POST' && url.pathname === '/__purge') {
      await this.purge();
      return Response.json({ ok: true, code: this.room.code });
    }

    if (request.method === 'POST' && url.pathname === '/__registry/add') {
      const payload = (await request.json().catch(() => ({}))) as { code?: string };
      const code = payload?.code ? String(payload.code).toUpperCase() : '';
      if (code) {
        const rooms = (await this.state.storage.get<string[]>('activeRooms')) ?? [];
        if (!rooms.includes(code)) {
          rooms.push(code);
          await this.state.storage.put('activeRooms', rooms);
        }
      }
      return Response.json({ ok: true });
    }

    if (request.method === 'POST' && url.pathname === '/__registry/remove') {
      const payload = (await request.json().catch(() => ({}))) as { code?: string };
      const code = payload?.code ? String(payload.code).toUpperCase() : '';
      if (code) {
        const rooms = (await this.state.storage.get<string[]>('activeRooms')) ?? [];
        const updated = rooms.filter((c) => c !== code);
        await this.state.storage.put('activeRooms', updated);
      }
      return Response.json({ ok: true });
    }

    if (request.method === 'GET' && url.pathname === '/__registry/list') {
      const rooms = (await this.state.storage.get<string[]>('activeRooms')) ?? [];
      return Response.json({ rooms });
    }

    if (request.method === 'POST' && url.pathname === '/__registry/clear') {
      await this.state.storage.delete('activeRooms');
      return Response.json({ ok: true });
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
    this.writeSocketAttachment(server, {
      playerId,
      roomCode,
      negotiated: false,
    });

    this.sendTo(server, {
      type: 'session:ready',
      playerId,
      supportedProtocolVersions: [1],
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const receivedAt = Date.now();
    await this.initialization;
    const playerId = this.sessions.get(socket);

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

    if (!playerId) {
      console.warn('[GameRoom] WebSocket message received without an active session', {
        commandType: commandPayload.type,
        requestId,
      });
      this.sendTo(socket, {
        type: 'error',
        code: 'SESSION_INVALID',
        message: 'A sessão WebSocket não está mais ativa. Reconecte-se à sala.',
        requestId,
      });
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
      this.writeSocketAttachment(socket, {
        playerId,
        roomCode: this.sessionRoomCodes.get(socket) ?? this.room.code,
        negotiated: true,
      });
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
    const isLobbyCommand =
      cmd.type === 'lobby:categories:update' ||
      cmd.type === 'lobby:rounds:update' ||
      cmd.type === 'lobby:options:update';
    if (isLobbyCommand) {
      console.log('[GameRoom] Lobby command received', {
        commandType: cmd.type,
        requestId,
        phase: this.room.phase,
        isHost: this.isHost(playerId),
      });
    }
    const processCommand = async () => {
      try {
        await this.handleCommand(socket, playerId, cmd, receivedAt);
        this.inFlightRequests.delete(requestKey);
        if (this.failedRequests.delete(requestKey)) return;
        this.sendTo(socket, {
          type: 'command:ack',
          requestId,
          commandType: cmd.type,
          status: 'committed',
        });
        if (isLobbyCommand) {
          console.log('[GameRoom] Lobby command committed', {
            commandType: cmd.type,
            requestId,
          });
        }
      } catch (error) {
        console.error('[GameRoom] Command processing failed:', {
          commandType: cmd.type,
          requestId,
          error,
        });
        this.sendError(socket, 'INTERNAL_ERROR', 'An unexpected server error occurred', requestId);
        this.inFlightRequests.delete(requestKey);
        this.failedRequests.delete(requestKey);
      }
    };

    this.commandQueue = this.commandQueue.then(processCommand, processCommand);
    await this.commandQueue;
  }

  webSocketClose(socket: WebSocket): void {
    const playerId = this.sessions.get(socket);
    if (playerId) {
      this.sessions.delete(socket);
      this.sessionRoomCodes.delete(socket);
      this.negotiatedSockets.delete(socket);
      void this.setPlayerStatus(playerId, 'disconnected').catch((error) => {
        console.error('[GameRoom] Failed to persist player departure:', error);
      });
    }
  }

  webSocketError(socket: WebSocket): void {
    this.webSocketClose(socket);
  }

  // ── Command Dispatcher ─────────────────────────────────────────────────────

  private async handleCommand(
    socket: WebSocket,
    playerId: string,
    cmd: ClientCommand,
    receivedAt: number,
  ): Promise<void> {
    if (!this.validateMutationAuthority(socket, playerId, cmd)) return;

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
        return this.handleAnswerSubmit(socket, playerId, cmd, receivedAt);
      case 'round:stop':
        return this.handleRoundStop(socket, playerId, cmd, receivedAt);
      case 'answer:vote':
        return this.handleAnswerVote(socket, playerId, cmd);
      case 'round:next':
        return this.handleRoundNext(socket, playerId, cmd);
      case 'round:review:next':
        return this.handleRoundReviewNext(socket, playerId, cmd);
      case 'room:leave':
        return this.handleRoomLeave(socket, playerId, cmd);
      case 'room:close':
        return this.handleRoomClose(socket, playerId, cmd);
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
      avatar?: Avatar;
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
      joinedAt: this.nextJoinedAt(),
      avatar: this.normalizeAvatar(cmd.avatar),
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
    cmd: { type: 'room:join'; requestId: string; code: string; nickname: string; avatar?: Avatar }
  ): Promise<void> {
    const requestedCode = this.sessionRoomCodes.get(socket);
    if (
      !this.room.code ||
      !requestedCode ||
      requestedCode !== this.room.code ||
      cmd.code.trim().toUpperCase() !== this.room.code
    ) {
      this.sendError(socket, 'ROOM_NOT_FOUND', 'A sala informada não existe', cmd.requestId);
      return;
    }
    if (this.room.phase !== 'CONFIGURING') {
      this.sendError(socket, 'INVALID_PHASE', 'Esta sala não está aceitando novos jogadores', cmd.requestId);
      return;
    }

    const nickname = cmd.nickname.trim();

    if (!this.isValidNickname(nickname)) {
      this.sendError(socket, 'INVALID_NICKNAME', 'O apelido deve conter de 1 a 24 caracteres', cmd.requestId);
      return;
    }

    if (this.room.players.filter((player) => player.status === 'active').length >= MAX_PLAYERS) {
      this.sendError(socket, 'ROOM_FULL', 'A sala está completa', cmd.requestId);
      return;
    }

    if (
      this.room.players.some(
        (p) => p.nickname.toLowerCase() === nickname.toLowerCase() && p.status === 'active'
      )
    ) {
      this.sendError(socket, 'DUPLICATE_NICKNAME', 'O apelido já está em uso', cmd.requestId);
      return;
    }

    // Allow rejoin if disconnected player with same ID
    const existing = this.room.players.find((p) => p.id === playerId);
    if (existing) {
      existing.status = 'active';
      existing.nickname = nickname;
      existing.avatar = this.normalizeAvatar(cmd.avatar);
    } else {
      this.room.players.push({
        id: playerId,
        nickname,
        isHost: false,
        status: 'active',
        score: 0,
        joinedAt: this.nextJoinedAt(),
        avatar: this.normalizeAvatar(cmd.avatar),
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
      this.sendError(socket, 'SESSION_INVALID', 'A sessão informada é inválida ou expirada', cmd.requestId);
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
      this.sendError(socket, 'SESSION_INVALID', 'A sessão informada é inválida ou expirada', cmd.requestId);
      return;
    }

    for (const [existingSocket, existingPlayerId] of this.sessions) {
      if (existingPlayerId === player.id && existingSocket !== socket) {
        this.sessions.delete(existingSocket);
        this.sessionRoomCodes.delete(existingSocket);
        this.negotiatedSockets.delete(existingSocket);
        try {
          existingSocket.close(1000, 'Sessão pausada em outra conexão');
        } catch (error) {
          console.error('[GameRoom] Failed to close replaced session:', error);
        }
      }
    }

    this.sessions.set(socket, player.id);
    this.writeSocketAttachment(socket, {
      playerId: player.id,
      roomCode: this.sessionRoomCodes.get(socket) ?? this.room.code,
      negotiated: true,
    });
    player.status = 'active';
    this.ensureActiveHost();
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

  private restoreSocketSessions(): void {
    for (const socket of this.state.getWebSockets()) {
      const attachment = this.readSocketAttachment(socket);
      const taggedPlayerId = this.state.getTags(socket)[0];
      const playerId = attachment?.playerId ?? taggedPlayerId;
      if (!playerId) continue;

      this.sessions.set(socket, playerId);
      this.sessionRoomCodes.set(socket, attachment?.roomCode ?? this.room.code);
      if (
        attachment?.negotiated ??
        this.room.players.some((player) => player.id === playerId)
      ) {
        this.negotiatedSockets.add(socket);
      }
    }
  }

  private readSocketAttachment(socket: WebSocket): SocketAttachment | null {
    const attachment: unknown = socket.deserializeAttachment();
    if (
      !attachment ||
      typeof attachment !== 'object' ||
      !('playerId' in attachment) ||
      typeof attachment.playerId !== 'string' ||
      !('roomCode' in attachment) ||
      typeof attachment.roomCode !== 'string' ||
      !('negotiated' in attachment) ||
      typeof attachment.negotiated !== 'boolean'
    ) {
      return null;
    }
    return {
      playerId: attachment.playerId,
      roomCode: attachment.roomCode,
      negotiated: attachment.negotiated,
    };
  }

  private writeSocketAttachment(socket: WebSocket, attachment: SocketAttachment): void {
    socket.serializeAttachment(attachment);
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
    } else if (this.room.phase === 'GAME_OVER') {
      const { podium, list } = buildFinalRanking(this.room.players);
      this.sendTo(socket, { type: 'game:final_results', podium, list });
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
        'Escolha 1 a 20 nomes de categoria únicos, cada um com 1 a 40 caracteres',
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
        'A quantidade de rodadas deve ser um número inteiro de 1 a 20',
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
        'Escolha uma duração de 0, 60, 90 ou 120 segundos e pelo menos uma letra única de A a Z',
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
      this.sendError(socket, 'NOT_HOST', 'Apenas o anfitrião pode iniciar o jogo', cmd.requestId);
      return;
    }

    if (this.room.phase !== 'CONFIGURING') {
      this.sendError(socket, 'INVALID_PHASE', 'O jogo só pode ser iniciado durante a configuração', cmd.requestId);
      return;
    }

    if (this.room.players.filter((player) => player.status === 'active').length < 2) {
      this.sendError(socket, 'NOT_ENOUGH_PLAYERS', 'São necessários pelo menos dois jogadores ativos', cmd.requestId);
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
      this.sendError(socket, 'INVALID_CONFIGURATION', 'As configurações da sala não são válidas', cmd.requestId);
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
      throw new Error('A sala não tem uma configuração de duração de rodada válida');
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
      scoredCategoryIndexes: new Set(),
      roundBonusApplied: false,
    };
    this.rounds.set(roundId, roundData);
    this.currentRoundData = roundData;

    await this.persistRoom();
    await this.persistRoundData(roundData);

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
    cmd: { type: 'answer:submit'; requestId: string; roundId: string; answers: Record<string, string> },
    receivedAt: number,
  ): Promise<void> {
    const roundData = this.currentRoundData;
    const player = this.room.players.find((entry) => entry.id === playerId);
    if (!player || player.status !== 'active') {
      this.sendError(socket, 'INVALID_ANSWER', 'Apenas jogadores ativos podem enviar respostas', cmd.requestId);
      return;
    }
    if (
      this.room.phase !== 'ROUND_ACTIVE' ||
      !roundData ||
      cmd.roundId !== roundData.id ||
      this.room.currentRoundId !== roundData.id
    ) {
      this.sendError(socket, 'ROUND_CLOSED', 'Esta rodada não está mais aceitando respostas', cmd.requestId);
      return;
    }
    if (this.room.roundDeadline !== undefined && receivedAt >= this.room.roundDeadline) {
      await this.beginCategoryReview(roundData);
      this.sendError(socket, 'ROUND_CLOSED', 'O prazo da rodada expirou', cmd.requestId);
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
      this.sendError(socket, 'INVALID_ANSWER', 'As respostas devem conter apenas categorias conhecidas e valores de texto', cmd.requestId);
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
    await this.persistRoundData(roundData);
  }

  // ── Round: Stop ────────────────────────────────────────────────────────────

  private async handleRoundStop(
    socket: WebSocket,
    playerId: string,
    cmd: { type: 'round:stop'; requestId: string; roundId: string },
    receivedAt: number,
  ): Promise<void> {
    const roundData = this.currentRoundData;
    const player = this.room.players.find((entry) => entry.id === playerId);
    if (!player || player.status !== 'active') {
      this.sendError(socket, 'INVALID_PHASE', 'Apenas jogadores ativos podem parar a rodada', cmd.requestId);
      return;
    }
    if (
      this.room.phase !== 'ROUND_ACTIVE' ||
      !roundData ||
      cmd.roundId !== roundData.id ||
      this.room.currentRoundId !== roundData.id
    ) {
      this.sendError(socket, 'ROUND_CLOSED', 'Esta rodada já está fechada', cmd.requestId);
      return;
    }
    if (this.room.roundDeadline !== undefined && receivedAt >= this.room.roundDeadline) {
      await this.beginCategoryReview(roundData);
      this.sendError(socket, 'ROUND_CLOSED', 'O prazo da rodada expirou', cmd.requestId);
      return;
    }

    roundData.stopperId = playerId;
    roundData.stopTime = receivedAt;
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
    await this.persistRoundData(roundData);
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
    await this.persistRoom();

    // Auto-advance category after deadline
    if (event.deadline) await this.state.storage.setAlarm(event.deadline);
    if (this.isCategoryReviewComplete(roundData, categoryIndex)) {
      await this.completeCategoryReview(roundData, categoryIndex);
    }
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
      this.sendError(socket, 'NOT_ELIGIBLE', 'Apenas jogadores ativos podem votar', cmd.requestId);
      return;
    }

    const roundData = this.currentRoundData;
    if (
      this.room.phase !== 'CATEGORY_REVIEW' ||
      !roundData ||
      cmd.roundId !== roundData.id ||
      this.room.currentRoundId !== roundData.id
    ) {
      this.sendError(socket, 'ROUND_CLOSED', 'Esta rodada não está aceitando votos', cmd.requestId);
      return;
    }
    if (this.room.reviewDeadline !== undefined && Date.now() >= this.room.reviewDeadline) {
      await this.completeCategoryReview(
        roundData,
        this.room.currentReviewCategoryIndex ?? 0,
      );
      this.sendError(socket, 'ROUND_CLOSED', 'O prazo da categoria ativa expirou', cmd.requestId);
      return;
    }

    const currentCategory = this.room.categories[this.room.currentReviewCategoryIndex ?? -1];
    if (!currentCategory || cmd.categoryId !== currentCategory.id) {
      this.sendError(socket, 'INVALID_VOTE', 'Os votos são aceitos apenas para a categoria ativa', cmd.requestId);
      return;
    }
    if (cmd.decision !== 'valid' && cmd.decision !== 'invalidate') {
      this.sendError(socket, 'INVALID_VOTE', 'A decisão do voto deve ser válida ou invalidar', cmd.requestId);
      return;
    }
    if (!roundData.eligibleVoterIds.includes(playerId)) {
      this.sendError(socket, 'NOT_ELIGIBLE', 'Este jogador não é elegível para votar nesta revisão', cmd.requestId);
      return;
    }

    const answer = roundData.answers.get(`${cmd.answerPlayerId}:${cmd.categoryId}`);
    if (!answer || !answer.isValid || !answer.value.trim()) {
      this.sendError(socket, 'INVALID_VOTE', 'A resposta alvo não é elegível para votação', cmd.requestId);
      return;
    }
    if (answer.playerId === playerId) {
      this.sendError(socket, 'SELF_VOTE', 'O jogador não pode votar em suas próprias respostas', cmd.requestId);
      return;
    }

    const eligibleVoters = roundData.eligibleVoterIds.filter((voterId) => voterId !== answer.playerId);
    if (!eligibleVoters.includes(playerId)) {
      this.sendError(socket, 'NOT_ELIGIBLE', 'O autor da resposta está excluído de seus eleitores elegíveis', cmd.requestId);
      return;
    }

    answer.eligibleVoters = eligibleVoters;
    answer.votes = { ...answer.votes, [playerId]: cmd.decision };
    answer.invalidations = Object.entries(answer.votes)
      .filter(([voterId, decision]) => eligibleVoters.includes(voterId) && decision === 'invalidate')
      .map(([voterId]) => voterId);

    await this.persistRoundData(roundData);
    const event = this.buildCategoryReviewEvent(
      roundData,
      this.room.currentReviewCategoryIndex ?? 0,
    );
    if (event) this.broadcast(event);
    if (this.isCategoryReviewComplete(roundData, this.room.currentReviewCategoryIndex ?? 0)) {
      await this.completeCategoryReview(roundData, this.room.currentReviewCategoryIndex ?? 0);
    }
  }

  // ── Round Review: Next Category (manual skip) ────────────────────────────

  private async handleRoundReviewNext(
    socket: WebSocket,
    playerId: string,
    cmd: Extract<ClientCommand, { type: 'round:review:next' }>,
  ): Promise<void> {
    const player = this.room.players.find((entry) => entry.id === playerId);
    if (!player || player.status !== 'active') {
      this.sendError(socket, 'NOT_ELIGIBLE', 'Apenas jogadores ativos podem avançar a revisão', cmd.requestId);
      return;
    }
    if (!this.isHost(playerId)) {
      this.sendError(socket, 'NOT_HOST', 'Apenas o anfitrião pode avançar a revisão de categoria', cmd.requestId);
      return;
    }
    const roundData = this.currentRoundData;
    if (
      this.room.phase !== 'CATEGORY_REVIEW' ||
      !roundData ||
      cmd.roundId !== roundData.id ||
      this.room.currentRoundId !== roundData.id
    ) {
      this.sendError(socket, 'ROUND_CLOSED', 'Não há revisão de categoria ativa para avançar', cmd.requestId);
      return;
    }
    await this.completeCategoryReview(roundData, this.room.currentReviewCategoryIndex ?? 0);
  }

  private async handleRoomClose(
    socket: WebSocket,
    playerId: string,
    cmd: Extract<ClientCommand, { type: 'room:close' }>,
  ): Promise<void> {
    // Authority already validated in validateMutationAuthority (host + lifecycle phase).

    // In-match close: finalize with accumulated scores and show the podium.
    if (MATCH_PHASES.has(this.room.phase)) {
      this.room.roundDeadline = undefined;
      this.room.reviewDeadline = undefined;
      await this.state.storage.deleteAlarm();
      await this.finishGame();
      // Ack via outer processCommand; clients navigate on game:final_results.
      return;
    }

    // Lobby close: delete the draft room for everyone.
    this.broadcast({
      type: 'room:closed',
      reason: 'host_closed',
      requestId: cmd.requestId,
    });
    // Ack before purge closes sockets; suppress the outer processCommand ack.
    this.sendTo(socket, {
      type: 'command:ack',
      requestId: cmd.requestId,
      commandType: 'room:close',
      status: 'committed',
    });
    this.failedRequests.add(this.requestKey(playerId, cmd.requestId));
    await this.purge({ closeCode: 1000, closeReason: 'Room closed by host' });
  }

  private async handleRoomLeave(
    socket: WebSocket,
    playerId: string,
    cmd: Extract<ClientCommand, { type: 'room:leave' }>,
  ): Promise<void> {
    const player = this.room.players.find((entry) => entry.id === playerId);
    if (!player || player.status !== 'active') {
      this.sendError(socket, 'NOT_ELIGIBLE', 'Apenas jogadores ativos podem sair da sala', cmd.requestId);
      return;
    }

    const wasHost = player.isHost;
    this.room.players = this.room.players.filter((entry) => entry.id !== playerId);
    await this.clearResumeCredentialsForPlayer(playerId);

    if (wasHost) {
      this.ensureActiveHost();
    }

    await this.persistRoom();
    this.broadcastRoomState();

    const outcome = await this.evaluateRoomAfterLeave();
    if (outcome === 'purge_empty') {
      this.broadcast({
        type: 'room:closed',
        reason: 'empty',
        requestId: cmd.requestId,
      });
      this.sendTo(socket, {
        type: 'command:ack',
        requestId: cmd.requestId,
        commandType: 'room:leave',
        status: 'committed',
      });
      this.failedRequests.add(this.requestKey(playerId, cmd.requestId));
      await this.purge({ closeCode: 1000, closeReason: 'Room empty' });
    }
    // 'finish' and 'continue' rely on the outer processCommand ack.
  }

  /**
   * After a hard leave, decide whether the lobby should be purged or the match
   * finished early. Soft-disconnect must NOT call this (see webSocketClose).
   */
  private async evaluateRoomAfterLeave(): Promise<'continue' | 'finish' | 'purge_empty'> {
    const activeCount = this.room.players.filter((player) => player.status === 'active').length;

    if (
      (this.room.phase === 'CONFIGURING' || this.room.phase === 'WAITING_PLAYERS') &&
      activeCount === 0
    ) {
      return 'purge_empty';
    }

    if (MATCH_PHASES.has(this.room.phase)) {
      if (activeCount === 0) {
        return 'purge_empty';
      }
      if (activeCount <= 1) {
        this.room.roundDeadline = undefined;
        this.room.reviewDeadline = undefined;
        await this.state.storage.deleteAlarm();
        await this.finishGame();
        return 'finish';
      }
    }

    return 'continue';
  }

  private async clearResumeCredentialsForPlayer(playerId: string): Promise<void> {
    const credentials = await this.state.storage.get<ResumeCredential[]>('resumeCredentials') ?? [];
    const remaining = credentials.filter((entry) => entry.playerId !== playerId);
    if (remaining.length !== credentials.length) {
      await this.state.storage.put('resumeCredentials', remaining);
    }
  }

  private async handleRoundNext(
    socket: WebSocket,
    playerId: string,
    cmd: Extract<ClientCommand, { type: 'round:next' }>,
  ): Promise<void> {
    const player = this.room.players.find((entry) => entry.id === playerId);
    if (!player || player.status !== 'active') {
      this.sendError(socket, 'NOT_ELIGIBLE', 'Apenas jogadores ativos podem avançar a rodada', cmd.requestId);
      return;
    }
    if (!this.isHost(playerId)) {
      this.sendError(socket, 'NOT_HOST', 'Apenas o anfitrião pode avançar para a próxima rodada', cmd.requestId);
      return;
    }
    if (
      this.room.phase !== 'ROUND_RESULTS' ||
      cmd.roundId !== this.room.currentRoundId ||
      this.room.currentRound >= this.room.totalRounds
    ) {
      this.sendError(socket, 'ROUND_CLOSED', 'Esta rodada não pode ser avançada', cmd.requestId);
      return;
    }

    await this.startNextRound();
  }

  private isCategoryReviewComplete(roundData: RoundData, categoryIndex: number): boolean {
    const category = this.room.categories[categoryIndex];
    if (!category) return false;
    const reviewableAnswers = [...roundData.answers.values()].filter(
      (answer) =>
        answer.categoryId === category.id &&
        answer.isValid &&
        answer.value.trim().length > 0,
    );

    return reviewableAnswers.length > 0 && reviewableAnswers.every((answer) =>
      (answer.eligibleVoters ?? []).every((voterId) =>
        Object.prototype.hasOwnProperty.call(answer.votes ?? {}, voterId),
      ),
    );
  }

  private async completeCategoryReview(roundData: RoundData, categoryIndex: number): Promise<void> {
    if (
      this.room.phase !== 'CATEGORY_REVIEW' ||
      this.currentRoundData !== roundData ||
      this.room.currentReviewCategoryIndex !== categoryIndex ||
      roundData.scoredCategoryIndexes.has(categoryIndex)
    ) {
      return;
    }

    const category = this.room.categories[categoryIndex];
    if (!category) return;

    roundData.scoredCategoryIndexes.add(categoryIndex);
    const { scores } = computeCategoryScores(roundData, category, this.room.players);
    const categoryScores = Object.fromEntries(
      this.room.players.map((player) => [player.id, scores[player.id] ?? 0]),
    );
    for (const player of this.room.players) {
      const points = categoryScores[player.id] ?? 0;
      player.score += points;
      const answer = roundData.answers.get(`${player.id}:${category.id}`);
      if (answer) answer.score = points;
    }

    await this.persistRoundData(roundData);
    await this.persistRoom();
    this.broadcast({
      type: 'round:review:score_update',
      categoryIndex,
      categoryScores,
      scoreboard: [...this.room.players],
    });

    const nextCategoryIndex = categoryIndex + 1;
    if (nextCategoryIndex < this.room.categories.length) {
      this.room.reviewDeadline = undefined;
      this.room.currentReviewCategoryIndex = nextCategoryIndex;
      await this.persistRoom();
      await this.broadcastCategoryReview(roundData, nextCategoryIndex);
      return;
    }

    await this.computeRoundScoresAndAdvance(roundData);
  }

  private async computeRoundScoresAndAdvance(roundData: RoundData): Promise<void> {
    if (!roundData.roundBonusApplied && roundData.stopperId) {
      const stopper = this.room.players.find((player) => player.id === roundData.stopperId);
      if (stopper) stopper.score += 10;
      roundData.roundBonusApplied = true;
    }

    this.room.phase = 'ROUND_RESULTS';
    this.room.reviewDeadline = undefined;
    await this.persistRoom();
    await this.persistRoundData(roundData);
    await this.state.storage.deleteAlarm();

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
    await this.initialization;
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
      if (now >= this.room.reviewDeadline && this.currentRoundData) {
        await this.completeCategoryReview(
          this.currentRoundData,
          this.room.currentReviewCategoryIndex ?? 0,
        );
        return;
      }
    }

    if (await this.expireRoomIfDue(now)) return;
    await this.scheduleNextAlarm();
  }

  private restoreRoundData(saved: PersistedRoundData): RoundData {
    return {
      id: saved.id,
      letter: saved.letter,
      answers: new Map(saved.answers),
      stopperId: saved.stopperId,
      stopTime: saved.stopTime,
      submittedPlayers: new Set(saved.submittedPlayers),
      eligibleVoterIds: [...saved.eligibleVoterIds],
      scoredCategoryIndexes: new Set(saved.scoredCategoryIndexes),
      roundBonusApplied: saved.roundBonusApplied,
    };
  }

  private async reconcilePersistedDeadline(): Promise<void> {
    const now = Date.now();
    if (
      this.room.phase === 'ROUND_ACTIVE' &&
      this.room.roundDeadline !== undefined &&
      this.currentRoundData
    ) {
      if (now >= this.room.roundDeadline) {
        await this.beginCategoryReview(this.currentRoundData);
      } else {
        await this.scheduleNextAlarm();
      }
      return;
    }

    if (this.room.phase === 'CATEGORY_REVIEW' && this.currentRoundData) {
      if (this.room.reviewDeadline !== undefined && now >= this.room.reviewDeadline) {
        await this.completeCategoryReview(
          this.currentRoundData,
          this.room.currentReviewCategoryIndex ?? 0,
        );
      } else if (this.room.reviewDeadline !== undefined) {
        await this.scheduleNextAlarm();
      }
      return;
    }

    if (await this.expireRoomIfDue(now)) return;
    await this.scheduleNextAlarm();
  }

  private async scheduleNextAlarm(): Promise<void> {
    let deadline: number | undefined;
    if (this.room.phase === 'ROUND_ACTIVE') {
      deadline = this.room.roundDeadline;
    } else if (this.room.phase === 'CATEGORY_REVIEW') {
      deadline = this.room.reviewDeadline;
    } else if (
      this.room.phase === 'WAITING_PLAYERS' ||
      this.room.phase === 'CONFIGURING' ||
      this.room.phase === 'GAME_OVER'
    ) {
      deadline = this.room.expiresAt;
    }

    if (deadline === undefined) {
      await this.state.storage.deleteAlarm();
      return;
    }
    await this.state.storage.setAlarm(Math.max(Date.now(), deadline));
  }

  private async clearAllStorage(): Promise<void> {
    if (typeof this.state.storage.deleteAll === 'function') {
      await this.state.storage.deleteAll();
    } else {
      await Promise.all([
        this.state.storage.delete('gameState'),
        this.state.storage.delete('room'),
        this.state.storage.delete('roundData'),
        this.state.storage.delete('resumeCredentials'),
      ]);
    }
  }

  public async purge(options?: { closeCode?: number; closeReason?: string }): Promise<void> {
    const closeCode = options?.closeCode ?? 1001;
    const closeReason = options?.closeReason ?? 'Manutenção periódica programada';

    await this.state.storage.deleteAlarm();
    await this.clearAllStorage();

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
    this.rounds.clear();
    this.currentRoundData = null;
    this.requestIds.clear();
    this.requestIdOrder = [];
    // Keep inFlightRequests / failedRequests until processCommand finishes so
    // pre-purge acks (room:close / last leave) are not duplicated after sockets close.

    for (const socket of this.state.getWebSockets()) {
      try {
        socket.close(closeCode, closeReason);
      } catch (error) {
        console.error('[GameRoom] Failed to close purged-room socket:', error);
      }
    }
    this.sessions.clear();
    this.sessionRoomCodes.clear();
    this.negotiatedSockets.clear();
  }

  private async expireRoomIfDue(now: number): Promise<boolean> {
    const canExpire =
      this.room.phase === 'WAITING_PLAYERS' ||
      this.room.phase === 'CONFIGURING' ||
      this.room.phase === 'GAME_OVER';
    if (!canExpire || this.room.expiresAt === undefined || now < this.room.expiresAt) {
      return false;
    }

    await this.state.storage.deleteAlarm();
    await this.clearAllStorage();
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
    this.rounds.clear();
    this.currentRoundData = null;
    this.requestIds.clear();
    this.requestIdOrder = [];
    for (const socket of this.state.getWebSockets()) {
      try {
        socket.close(1000, 'Room expired');
      } catch (error) {
        console.error('[GameRoom] Failed to close expired-room socket:', error);
      }
    }
    this.sessions.clear();
    this.sessionRoomCodes.clear();
    this.negotiatedSockets.clear();
    return true;
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  private isValidNickname(nickname: string): boolean {
    const length = Array.from(nickname).length;
    return length > 0 && length <= MAX_NICKNAME_CODE_POINTS;
  }

  private normalizeAvatar(avatar: Avatar | undefined): Avatar {
    return isAvatar(avatar) ? avatar : AVATAR_OPTIONS[0];
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
      this.sendError(socket, 'NOT_HOST', 'Apenas o anfitrião pode atualizar as configurações da sala', requestId);
      return false;
    }
    if (this.room.phase !== 'CONFIGURING') {
      this.sendError(socket, 'INVALID_PHASE', 'As configurações da sala só podem ser alteradas durante a configuração', requestId);
      return false;
    }
    return true;
  }

  private isHost(playerId: string): boolean {
    return this.room.players.some((p) => p.id === playerId && p.isHost && p.status === 'active');
  }

  private validateMutationAuthority(
    socket: WebSocket,
    playerId: string,
    cmd: ClientCommand,
  ): boolean {
    // Lifecycle commands span multiple phases — validate outside MUTATION_PHASES.
    if (cmd.type === 'room:leave' || cmd.type === 'room:close') {
      const player = this.room.players.find((entry) => entry.id === playerId);
      if (!player || player.status !== 'active') {
        this.sendError(socket, 'NOT_ELIGIBLE', 'Um membro ativo da sala é necessário para esta ação', cmd.requestId);
        return false;
      }
      if (cmd.type === 'room:close' && !player.isHost) {
        this.sendError(socket, 'NOT_HOST', 'Apenas o anfitrião ativo pode encerrar a sala', cmd.requestId);
        return false;
      }
      if (!ROOM_LIFECYCLE_PHASES.has(this.room.phase)) {
        this.sendError(socket, 'INVALID_PHASE', 'Esta ação não é permitida durante a fase atual do jogo', cmd.requestId);
        return false;
      }
      return true;
    }

    const phase = MUTATION_PHASES[cmd.type];
    if (!phase) return true;

    const player = this.room.players.find((entry) => entry.id === playerId);
    if (!player || player.status !== 'active') {
      this.sendError(socket, 'NOT_ELIGIBLE', 'Um membro ativo da sala é necessário para esta ação', cmd.requestId);
      return false;
    }

    if (HOST_ONLY_COMMANDS.has(cmd.type) && !player.isHost) {
      this.sendError(socket, 'NOT_HOST', 'Apenas o anfitrião ativo pode realizar esta ação', cmd.requestId);
      return false;
    }

    if (this.room.phase !== phase) {
      const code = cmd.type === 'answer:submit' ||
        cmd.type === 'round:stop' ||
        cmd.type === 'answer:vote' ||
        cmd.type === 'round:next'
        ? 'ROUND_CLOSED'
        : 'INVALID_PHASE';
      this.sendError(socket, code, 'Esta ação não é permitida durante a fase atual do jogo', cmd.requestId);
      return false;
    }
    return true;
  }

  private async setPlayerStatus(playerId: string, status: 'active' | 'disconnected'): Promise<void> {
    const player = this.room.players.find((p) => p.id === playerId);
    if (player) {
      player.status = status;
      if (status === 'disconnected' && player.isHost) {
        this.room.players.forEach((entry) => {
          entry.isHost = false;
        });
        this.ensureActiveHost();
      } else if (status === 'active') {
        this.ensureActiveHost();
      }
      this.broadcast({
        type: 'player:presence',
        id: playerId,
        nickname: player.nickname,
        status,
      });
      await this.persistRoom();
      this.broadcastRoomState();
    }
  }

  private ensureActiveHost(): void {
    if (this.room.players.some((player) => player.isHost && player.status === 'active')) return;
    this.room.players.forEach((player) => {
      player.isHost = false;
    });
    const nextHost = this.room.players
      .map((player, index) => ({ player, index }))
      .filter(({ player }) => player.status === 'active')
      .sort((left, right) =>
        (left.player.joinedAt ?? left.index) - (right.player.joinedAt ?? right.index) ||
        left.index - right.index,
      )[0]?.player;
    if (nextHost) nextHost.isHost = true;
  }

  private nextJoinedAt(): number {
    const latestJoin = this.room.players.reduce(
      (latest, player) => Math.max(latest, player.joinedAt ?? 0),
      0,
    );
    return Math.max(Date.now(), latestJoin + 1);
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
      if (this.inFlightRequests.has(key)) {
        this.failedRequests.add(key);
        console.warn('[GameRoom] Command rejected', {
          code,
          requestId,
        });
      }
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
    const now = Date.now();
    if (this.room.phase === 'WAITING_PLAYERS' || this.room.phase === 'CONFIGURING') {
      this.room.lastActivityAt = now;
      this.room.expiresAt = now + IDLE_ROOM_TTL_MS;
    } else if (this.room.phase === 'GAME_OVER') {
      if (this.room.completedAt === undefined) {
        this.room.completedAt = now;
        this.room.expiresAt = now + COMPLETED_ROOM_TTL_MS;
      } else if (this.room.expiresAt === undefined) {
        this.room.expiresAt = this.room.completedAt + COMPLETED_ROOM_TTL_MS;
      }
    }
    await this.persistGameState();
    await this.state.storage.put('room', this.room);
    await this.scheduleNextAlarm();
  }

  private async persistRoundData(roundData: RoundData): Promise<void> {
    await this.persistGameState();
    await this.state.storage.put('roundData', this.serializeRoundData(roundData));
  }

  private serializeRoundData(roundData: RoundData): PersistedRoundData {
    return {
      id: roundData.id,
      letter: roundData.letter,
      answers: [...roundData.answers.entries()],
      stopperId: roundData.stopperId,
      stopTime: roundData.stopTime,
      submittedPlayers: [...roundData.submittedPlayers],
      eligibleVoterIds: [...roundData.eligibleVoterIds],
      scoredCategoryIndexes: [...roundData.scoredCategoryIndexes],
      roundBonusApplied: roundData.roundBonusApplied,
    };
  }

  private async persistGameState(): Promise<void> {
    await this.state.storage.put('gameState', {
      room: this.room,
      roundData: this.currentRoundData
        ? this.serializeRoundData(this.currentRoundData)
        : null,
    } satisfies PersistedGameState);
  }

  private pickLetter(): string {
    const letters = this.validateAllowedLetters(this.room.allowedLetters);
    if (!letters) throw new Error('A sala não tem uma configuração válida de letras permitidass');
    return letters[Math.floor(Math.random() * letters.length)];
  }
}
