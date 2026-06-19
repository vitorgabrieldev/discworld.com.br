import type { Player, PlayerPosition } from "./player.js";
import type { WorldMap } from "./map.js";

// Events server → client
export interface ServerToClientEvents {
  "world:state": (map: WorldMap) => void;
  "players:init": (players: Player[]) => void;
  "player:joined": (player: Player) => void;
  "player:left": (playerId: string) => void;
  "player:moved": (data: { playerId: string; position: PlayerPosition }) => void;
  "player:room:changed": (data: { playerId: string; roomId: string | null }) => void;
  "error": (message: string) => void;
}

// Events client → server
export interface ClientToServerEvents {
  "player:move": (position: PlayerPosition) => void;
  "player:join:room": (roomId: string) => void;
  "player:leave:room": () => void;
}

// Events server-to-server (Socket.io namespace internals)
export interface InterServerEvents {}

// Socket data stored per connection
export interface SocketData {
  playerId: string;
  guildId: string;
  discordId: string;
  username: string;
  avatar: string | null;
}
