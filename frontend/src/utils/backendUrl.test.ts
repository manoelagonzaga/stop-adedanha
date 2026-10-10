import { describe, expect, it } from 'vitest';
import { getBackendBaseUrl, getRoomWebSocketUrl, getRoomsApiUrl } from './backendUrl';

describe('backend URLs', () => {
  it('uses an explicitly configured backend origin for HTTP and WebSocket requests', () => {
    const baseUrl = getBackendBaseUrl('https://api.example.test/', 'http://frontend.example.test');

    expect(getRoomsApiUrl(baseUrl)).toBe('https://api.example.test/rooms');
    expect(getRoomWebSocketUrl(baseUrl, 'ABC234')).toBe('wss://api.example.test/rooms/ABC234');
  });

  it('uses the current origin only when no backend URL is configured', () => {
    const baseUrl = getBackendBaseUrl(undefined, 'http://localhost:4173');

    expect(getRoomsApiUrl(baseUrl)).toBe('http://localhost:4173/rooms');
    expect(getRoomWebSocketUrl(baseUrl, 'ABC234')).toBe('ws://localhost:4173/rooms/ABC234');
  });

  it('rejects backend URLs that do not use HTTP(S)', () => {
    expect(() => getBackendBaseUrl('ws://api.example.test', 'http://localhost:4173')).toThrow(
      'VITE_BACKEND_URL must use http or https.',
    );
  });
});
