import type { Server, Socket } from "socket.io";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
  Player,
  PlayerPosition,
} from "@repo/shared";

type AppServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

// In-memory store: guildId → playerId → Player
const guildPlayers = new Map<string, Map<string, Player>>();

export function registerSocketHandlers(io: AppServer) {
  io.on("connection", (socket: AppSocket) => {
    const { playerId, guildId, discordId, username, avatar } = socket.data;

    if (!playerId || !guildId) {
      socket.disconnect();
      return;
    }

    // Initialize guild room if needed
    if (!guildPlayers.has(guildId)) {
      guildPlayers.set(guildId, new Map());
    }

    const players = guildPlayers.get(guildId)!;

    const newPlayer: Player = {
      id: playerId,
      discordId,
      username,
      avatar,
      position: { x: 4, y: 4 },
      roomId: null,
      guildId,
      isMuted: false,
      isDeafened: false,
    };

    players.set(playerId, newPlayer);
    socket.join(guildId);

    // Send existing players to newcomer
    socket.emit("players:init", Array.from(players.values()).filter((p) => p.id !== playerId));

    // Announce newcomer to others
    socket.to(guildId).emit("player:joined", newPlayer);

    socket.on("player:move", (position: PlayerPosition) => {
      const player = players.get(playerId);
      if (!player) return;

      player.position = position;

      socket.to(guildId).emit("player:moved", { playerId, position });
    });

    socket.on("player:join:room", (roomId: string) => {
      const player = players.get(playerId);
      if (!player) return;

      player.roomId = roomId;
      socket.to(guildId).emit("player:room:changed", { playerId, roomId });
    });

    socket.on("player:leave:room", () => {
      const player = players.get(playerId);
      if (!player) return;

      player.roomId = null;
      socket.to(guildId).emit("player:room:changed", { playerId, roomId: null });
    });

    socket.on("disconnect", () => {
      players.delete(playerId);
      io.to(guildId).emit("player:left", playerId);

      if (players.size === 0) {
        guildPlayers.delete(guildId);
      }
    });
  });

  // Auth middleware: validate token before connection
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token as string | undefined;
    if (!token) {
      next(new Error("No token"));
      return;
    }

    try {
      const res = await fetch("https://discord.com/api/v10/users/@me", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        next(new Error("Invalid token"));
        return;
      }

      const user = (await res.json()) as {
        id: string;
        username: string;
        global_name: string | null;
        avatar: string | null;
      };

      const guildId = socket.handshake.auth.guildId as string | undefined;
      if (!guildId) {
        next(new Error("No guildId"));
        return;
      }

      socket.data.discordId = user.id;
      socket.data.playerId = `${guildId}:${user.id}`;
      socket.data.guildId = guildId;
      socket.data.username = user.global_name ?? user.username;
      socket.data.avatar = user.avatar;

      next();
    } catch {
      next(new Error("Auth failed"));
    }
  });
}
