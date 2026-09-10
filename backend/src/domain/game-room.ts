export const MAX_PLAYERS = 20

export type Player = {
  id: string
  nickname: string
}

export function addPlayer(players: Player[], player: Player): Player[] {
  const nickname = player.nickname.trim()

  if (!player.id.trim() || !nickname) {
    throw new Error('INVALID_PLAYER')
  }

  if (players.length >= MAX_PLAYERS) {
    throw new Error('ROOM_FULL')
  }

  if (players.some((existing) => existing.id === player.id)) {
    throw new Error('PLAYER_EXISTS')
  }

  if (players.some((existing) => existing.nickname.toLowerCase() === nickname.toLowerCase())) {
    throw new Error('DUPLICATE_NICKNAME')
  }

  return [...players, { ...player, nickname }]
}
