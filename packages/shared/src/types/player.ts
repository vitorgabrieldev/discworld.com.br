export interface PlayerPosition {
  x: number;
  y: number;
}

export interface Player {
  id: string;
  discordId: string;
  username: string;
  avatar: string | null;
  position: PlayerPosition;
  roomId: string | null;
  guildId: string;
  isMuted: boolean;
  isDeafened: boolean;
}

export interface PlayerState {
  players: Record<string, Player>;
  localPlayerId: string | null;
}
