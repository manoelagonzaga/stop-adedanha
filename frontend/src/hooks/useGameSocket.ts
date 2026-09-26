import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientCommand, ServerEvent, RoomState, Answer, FinalResults } from '../types';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface UseGameSocketOptions {
  url: string | null; // null = don't connect yet
  onEvent: (event: ServerEvent) => void;
}

export function useGameSocket({ url, onEvent }: UseGameSocketOptions) {
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
        if (!cancelled) setStatus('connected');
      };

      ws.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as ServerEvent;
          onEventRef.current(event);
        } catch {
          console.error('[WS] Failed to parse message', e.data);
        }
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
  }, [url, disconnect]);

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
      case 'session:ready' as string: {
        // Custom event sent by server on WS connect
        const e = event as unknown as { type: 'session:ready'; playerId: string };
        setState((s) => ({ ...s, myPlayerId: e.playerId }));
        break;
      }

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
                currentLetter: event.letter,
                categories: event.categories,
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
