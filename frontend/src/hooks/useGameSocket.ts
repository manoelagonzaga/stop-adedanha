import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientCommand, ServerEvent, RoomState, Answer, FinalResults } from '../types';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'resuming' | 'connected' | 'error';

interface UseGameSocketOptions {
  url: string | null; // null = don't connect yet
  roomCode: string | null;
  onEvent: (event: ServerEvent) => void;
}

function resumeStorageKey(roomCode: string): string {
  return `stop-adedanha:resume:${roomCode.toUpperCase()}`;
}

function readResumeToken(roomCode: string | null): string | null {
  if (!roomCode) return null;
  try {
    return sessionStorage.getItem(resumeStorageKey(roomCode));
  } catch (error) {
    console.error('[WS] Could not read the room resume credential from session storage', error);
    return null;
  }
}

export function clearResumeToken(roomCode: string): void {
  try {
    sessionStorage.removeItem(resumeStorageKey(roomCode));
  } catch (error) {
    console.error('[WS] Could not clear the room resume credential from session storage', error);
  }
}

export function useGameSocket({ url, roomCode, onEvent }: UseGameSocketOptions) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [pendingRequestIds, setPendingRequestIds] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEventRef = useRef(onEvent);
  const pendingRequestsRef = useRef(new Map<string, ClientCommand['type']>());
  onEventRef.current = onEvent;

  const send = useCallback((cmd: ClientCommand) => {
    const socket = wsRef.current;
    const isLobbyCommand =
      cmd.type === 'lobby:categories:update' ||
      cmd.type === 'lobby:rounds:update' ||
      cmd.type === 'lobby:options:update';
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      if (import.meta.env.DEV && isLobbyCommand) {
        console.warn('[WS] Lobby command not sent', {
          commandType: cmd.type,
          readyState: socket?.readyState ?? 'no-socket',
          url: socket?.url,
        });
      }
      return false;
    }

    pendingRequestsRef.current.set(cmd.requestId, cmd.type);
    setPendingRequestIds([...pendingRequestsRef.current.keys()]);
    try {
      socket.send(JSON.stringify(cmd));
      if (import.meta.env.DEV && isLobbyCommand) {
        console.info('[WS] Lobby command sent', {
          commandType: cmd.type,
          requestId: cmd.requestId,
          url: socket.url,
        });
      }
      return true;
    } catch (error) {
      console.error('[WS] Could not send command', error);
      pendingRequestsRef.current.delete(cmd.requestId);
      setPendingRequestIds([...pendingRequestsRef.current.keys()]);
      onEventRef.current({
        type: 'error',
        requestId: cmd.requestId,
        code: 'SEND_FAILED',
        message: 'Não foi possível enviar a ação. Verifique sua conexão e tente novamente.',
      });
      return false;
    }
  }, []);

  const disconnect = useCallback(() => {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    wsRef.current?.close();
    wsRef.current = null;
    pendingRequestsRef.current.clear();
    setPendingRequestIds([]);
    setStatus('disconnected');
  }, []);

  useEffect(() => {
    if (!url) {
      disconnect();
      return;
    }

    let cancelled = false;

    function connect() {
      if (cancelled) return;
      setStatus('connecting');
      if (import.meta.env.DEV) console.info('[WS] Connecting to room', { url });
      const ws = new WebSocket(url!);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!cancelled) {
          setStatus('connecting');
          ws.send(
            JSON.stringify({
              type: 'session:hello',
              requestId: crypto.randomUUID(),
              protocolVersion: 1,
            }),
          );
        }
      };

      ws.onmessage = (e) => {
        let event: ServerEvent;
        try {
          event = JSON.parse(e.data) as ServerEvent;
        } catch {
          console.error('[WS] Failed to parse server message');
          return;
        }

        if (event.type === 'session:ready' && event.negotiatedProtocolVersion === 1) {
          const resumeToken = readResumeToken(roomCode);
          if (resumeToken) {
            setStatus('resuming');
            ws.send(
              JSON.stringify({
                type: 'session:resume',
                requestId: crypto.randomUUID(),
                protocolVersion: 1,
                resumeToken,
              }),
            );
          } else {
            setStatus('connected');
          }
        } else if (event.type === 'room:joined' || event.type === 'session:resumed') {
          try {
            if (!roomCode) throw new Error('Room code is unavailable for credential storage');
            sessionStorage.setItem(resumeStorageKey(roomCode), event.resumeToken);
          } catch (error) {
            console.error('[WS] Could not persist the room resume credential', error);
          }
          setStatus('connected');
        } else if (event.type === 'error' && event.code === 'SESSION_INVALID') {
          if (roomCode) clearResumeToken(roomCode);
          setStatus('error');
        }
        const requestId = 'requestId' in event ? event.requestId : undefined;
        if (
          requestId &&
          (event.type === 'command:ack' || (event.type === 'error' && event.requestId))
        ) {
          pendingRequestsRef.current.delete(requestId);
          setPendingRequestIds([...pendingRequestsRef.current.keys()]);
        }
        onEventRef.current(event);
      };

      ws.onerror = () => {
        if (!cancelled) setStatus('error');
      };

      ws.onclose = () => {
        if (!cancelled) {
          setStatus('disconnected');
          for (const requestId of pendingRequestsRef.current.keys()) {
            onEventRef.current({
              type: 'error',
              requestId,
              code: 'CONNECTION_LOST',
              message: 'A conexão foi perdida antes da confirmação desta ação.',
            });
          }
          pendingRequestsRef.current.clear();
          setPendingRequestIds([]);
          // Auto-reconnect after 3 seconds
          reconnectTimer.current = setTimeout(connect, 3000);
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [url, roomCode, disconnect]);

  return { status, send, pendingRequestIds };
}

// ── Derived game state from server events ──────────────────────────────────

export interface GameState {
  room: RoomState | null;
  answers: Answer[];
  finalResults: FinalResults | null;
  myPlayerId: string | null;
  pendingCommands: Record<string, ClientCommand['type']>;
  lastCommandResult: {
    requestId: string;
    status: 'committed' | 'duplicate' | 'rejected';
    commandType?: ClientCommand['type'];
    code?: string;
    message?: string;
  } | null;
}

export function useGameState() {
  const [state, setState] = useState<GameState>({
    room: null,
    answers: [],
    finalResults: null,
    myPlayerId: null,
    pendingCommands: {},
    lastCommandResult: null,
  });

  const handleEvent = useCallback((event: ServerEvent) => {
    switch (event.type) {
      case 'command:ack':
        setState((s) => {
          const pendingCommands = { ...s.pendingCommands };
          delete pendingCommands[event.requestId];
          return {
            ...s,
            pendingCommands,
            lastCommandResult: {
              requestId: event.requestId,
              status: event.status,
              commandType: event.commandType,
            },
          };
        });
        break;

      case 'error':
        if (event.requestId) {
          setState((s) => {
            const pendingCommands = { ...s.pendingCommands };
            delete pendingCommands[event.requestId!];
            return {
              ...s,
              pendingCommands,
              lastCommandResult: {
                requestId: event.requestId!,
                status: 'rejected',
                code: event.code,
                message: event.message,
              },
            };
          });
        }
        break;

      case 'session:ready': {
        if (event.playerId) {
          setState((s) => ({ ...s, myPlayerId: event.playerId ?? null }));
        }
        break;
      }

      case 'session:resumed':
        setState((s) => ({
          ...s,
          room: event.state,
          myPlayerId: event.playerId,
        }));
        break;

      case 'room:state':
        setState((s) => ({ ...s, room: event.state }));
        break;

      case 'round:started':
        setState((s) => ({
          ...s,
          answers: [],
          room: s.room
            ? {
                ...s.room,
                phase: 'ROUND_ACTIVE',
                currentRound: event.roundNumber ?? s.room.currentRound + 1,
                currentLetter: event.letter,
                categories: event.categories,
                currentRoundId: event.id,
                roundDeadline: event.deadline,
              }
            : s.room,
        }));
        break;

      case 'round:review:category':
        setState((s) => ({
          ...s,
          answers: event.answers,
          room: s.room
            ? {
                ...s.room,
                phase: 'CATEGORY_REVIEW',
                currentReviewCategoryIndex: event.categoryIndex,
                reviewDeadline: event.deadline,
              }
            : s.room,
        }));
        break;

      case 'round:review:score_update':
        setState((s) => ({
          ...s,
          room: s.room
            ? {
                ...s.room,
                players: event.scoreboard,
              }
            : s.room,
        }));
        break;

      case 'round:results':
        setState((s) => ({
          ...s,
          answers: event.answers,
          room: s.room ? { ...s.room, phase: 'ROUND_RESULTS', players: event.ranking } : s.room,
        }));
        break;

      case 'game:final_results':
        setState((s) => ({
          ...s,
          finalResults: { podium: event.podium, list: event.list },
          room: s.room ? { ...s.room, phase: 'GAME_OVER' } : s.room,
        }));
        break;

      case 'player:presence':
        setState((s) => ({
          ...s,
          room: s.room
            ? {
                ...s.room,
                players: s.room.players.map((p) =>
                  p.id === event.id ? { ...p, status: event.status } : p
                ),
              }
            : s.room,
        }));
        break;
    }
  }, []);

  const trackCommand = useCallback((command: ClientCommand) => {
    if (!command.requestId) return;
    setState((s) => ({
      ...s,
      pendingCommands: { ...s.pendingCommands, [command.requestId]: command.type },
    }));
  }, []);

  return { state, setState, handleEvent, trackCommand };
}
