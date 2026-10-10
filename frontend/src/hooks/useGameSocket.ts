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
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const send = useCallback((cmd: ClientCommand) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(cmd));
    }
  }, []);

  const disconnect = useCallback(() => {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    wsRef.current?.close();
    wsRef.current = null;
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
        onEventRef.current(event);
      };

      ws.onerror = () => {
        if (!cancelled) setStatus('error');
      };

      ws.onclose = () => {
        if (!cancelled) {
          setStatus('disconnected');
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

  return { status, send };
}

// ── Derived game state from server events ──────────────────────────────────

export interface GameState {
  room: RoomState | null;
  answers: Answer[];
  finalResults: FinalResults | null;
  myPlayerId: string | null;
}

export function useGameState() {
  const [state, setState] = useState<GameState>({
    room: null,
    answers: [],
    finalResults: null,
    myPlayerId: null,
  });

  const handleEvent = useCallback((event: ServerEvent) => {
    switch (event.type) {
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

  return { state, setState, handleEvent };
}
