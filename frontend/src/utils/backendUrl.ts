export function getBackendBaseUrl(configuredUrl: string | undefined, fallbackOrigin: string): URL {
  const value = configuredUrl?.trim() || fallbackOrigin;
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('VITE_BACKEND_URL must use http or https.');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url;
}

export function getRoomsApiUrl(baseUrl: URL): string {
  return new URL('/rooms', baseUrl).toString();
}

export function getRoomWebSocketUrl(baseUrl: URL, roomCode: string): string {
  const url = new URL(`/rooms/${encodeURIComponent(roomCode)}`, baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}
