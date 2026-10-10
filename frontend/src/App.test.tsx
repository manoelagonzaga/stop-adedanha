import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from './components/Toast';
import App from './App';

class AppWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: AppWebSocket[] = [];
  readyState = AppWebSocket.OPEN;
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    AppWebSocket.instances.push(this);
  }

  send(message: string) {
    this.sent.push(message);
  }

  close() {
    this.readyState = AppWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close'));
  }

  emit(event: object) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(event) }));
  }
}

afterEach(() => {
  cleanup();
  AppWebSocket.instances = [];
  vi.unstubAllGlobals();
});

describe('App server-backed screens', () => {
  it('does not show fabricated active-game values before a room snapshot exists', () => {
    vi.stubGlobal('WebSocket', AppWebSocket);
    render(
      <ToastProvider>
        <App />
      </ToastProvider>,
    );

    expect(screen.getByRole('heading', { name: /Grite STOP primeiro/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Rodada/ })).not.toBeInTheDocument();
    expect(screen.queryByText('S')).not.toBeInTheDocument();
    expect(screen.queryByText('local-player')).not.toBeInTheDocument();
  });

  it('shows a safe server rejection and stays on entry instead of showing a fake room', () => {
    vi.stubGlobal('WebSocket', AppWebSocket);
    let requestNumber = 0;
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => `request-${++requestNumber}`) });
    render(
      <ToastProvider>
        <App />
      </ToastProvider>,
    );

    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[1], { target: { value: 'Guest' } });
    for (const [index, char] of ['A', 'B', 'C', '2', '3', '4'].entries()) {
      fireEvent.change(inputs[index + 2], { target: { value: char } });
    }
    fireEvent.click(screen.getByRole('button', { name: /Entrar no Jogo Agora/ }));
    const socket = AppWebSocket.instances[0];

    act(() => socket.onopen?.(new Event('open')));
    act(() => socket.emit({
      type: 'session:ready',
      negotiatedProtocolVersion: 1,
    }));
    expect(JSON.parse(socket.sent[socket.sent.length - 1])).toMatchObject({
      type: 'room:join',
      requestId: 'request-1',
      code: 'ABC234',
    });

    act(() => socket.emit({
      type: 'error',
      requestId: 'request-1',
      code: 'ROOM_NOT_FOUND',
      message: 'Sala não encontrada.',
    }));

    expect(screen.getByRole('alert')).toHaveTextContent('Sala não encontrada.');
    expect(screen.queryByText(/ROOM_NOT_FOUND/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Grite STOP primeiro/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Placar/ })).not.toBeInTheDocument();
  });
});
