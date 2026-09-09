export class GameRoom implements DurableObject {
  private readonly state: DurableObjectState
  private readonly sessions = new Map<WebSocket, string>()

  constructor(state: DurableObjectState) {
    this.state = state
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return Response.json({ error: 'WEBSOCKET_REQUIRED' }, { status: 426 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    const playerId = crypto.randomUUID()

    this.state.acceptWebSocket(server)
    this.sessions.set(server, playerId)
    server.send(JSON.stringify({ type: 'session:ready', playerId }))

    return new Response(null, { status: 101, webSocket: client })
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    const playerId = this.sessions.get(socket)
    if (!playerId || typeof message !== 'string') {
      return
    }

    let payload: unknown
    try {
      payload = JSON.parse(message)
    } catch {
      socket.send(JSON.stringify({ type: 'error', code: 'INVALID_JSON' }))
      return
    }

    socket.send(JSON.stringify({ type: 'command:ack', playerId, payload }))
  }

  webSocketClose(socket: WebSocket): void {
    this.sessions.delete(socket)
  }

  webSocketError(socket: WebSocket): void {
    this.sessions.delete(socket)
  }
}
