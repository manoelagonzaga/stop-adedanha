import { GameRoom } from './game-room'

export { GameRoom }

type Env = {
  GAME_ROOM: DurableObjectNamespace
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const roomCode = url.pathname.match(/^\/rooms\/([A-Za-z0-9-]+)\/?$/)?.[1]

    if (!roomCode) {
      return Response.json({ error: 'ROOM_CODE_REQUIRED' }, { status: 400 })
    }

    const roomId = env.GAME_ROOM.idFromName(roomCode)
    return env.GAME_ROOM.get(roomId).fetch(request)
  },
}
