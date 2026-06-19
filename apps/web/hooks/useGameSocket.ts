"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import type {
  WorldMap,
  Player,
  PlayerPosition,
  DiscordUser,
  ServerToClientEvents,
  ClientToServerEvents,
} from "@repo/shared";

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function useGameSocket(guildId: string, user: DiscordUser | null) {
  const [map, setMap] = useState<WorldMap | null>(null);
  const [players, setPlayers] = useState<Record<string, Player>>({});
  const [localPosition, setLocalPosition] = useState<PlayerPosition>({ x: 4, y: 4 });
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
  const socketRef = useRef<GameSocket | null>(null);
  const tokenRef = useRef<string | null>(null);

  // Fetch discord token from cookie via server endpoint
  useEffect(() => {
    if (!user) return;

    async function connect() {
      // Fetch the access token from a dedicated endpoint
      const tokenRes = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URL}/auth/token`,
        { credentials: "include" }
      );
      if (!tokenRes.ok) return;
      const { token } = await tokenRes.json() as { token: string };
      tokenRef.current = token;

      const socket: GameSocket = io(process.env.NEXT_PUBLIC_SERVER_URL!, {
        auth: { token, guildId },
        withCredentials: true,
      });

      socket.on("connect", async () => {
        // Load map after connecting
        const mapRes = await fetch(
          `${process.env.NEXT_PUBLIC_SERVER_URL}/api/guild/${guildId}/map`,
          { credentials: "include" }
        );
        if (mapRes.ok) {
          const worldMap = await mapRes.json() as WorldMap;
          setMap(worldMap);
          setLocalPosition(worldMap.spawnPoint);
        }
      });

      socket.on("players:init", (existingPlayers) => {
        const map: Record<string, Player> = {};
        for (const p of existingPlayers) map[p.id] = p;
        setPlayers(map);
      });

      socket.on("player:joined", (player) => {
        setPlayers((prev) => ({ ...prev, [player.id]: player }));
      });

      socket.on("player:left", (playerId) => {
        setPlayers((prev) => {
          const next = { ...prev };
          delete next[playerId];
          return next;
        });
      });

      socket.on("player:moved", ({ playerId, position }) => {
        setPlayers((prev) =>
          prev[playerId]
            ? { ...prev, [playerId]: { ...prev[playerId]!, position } }
            : prev
        );
      });

      socket.on("player:room:changed", ({ playerId, roomId }) => {
        setPlayers((prev) =>
          prev[playerId]
            ? { ...prev, [playerId]: { ...prev[playerId]!, roomId } }
            : prev
        );
      });

      socketRef.current = socket;
    }

    connect();

    return () => {
      socketRef.current?.disconnect();
    };
  }, [user, guildId]);

  // Detect room entry based on position
  const checkRoomEntry = useCallback(
    (pos: PlayerPosition, worldMap: WorldMap) => {
      for (const region of worldMap.regions) {
        for (const room of region.rooms) {
          if (
            pos.x >= room.x + 1 &&
            pos.x < room.x + room.width - 1 &&
            pos.y >= room.y + 1 &&
            pos.y < room.y + room.height - 1
          ) {
            if (currentRoomId !== room.id) {
              setCurrentRoomId(room.id);
              socketRef.current?.emit("player:join:room", room.id);
            }
            return;
          }
        }
      }
      if (currentRoomId !== null) {
        setCurrentRoomId(null);
        socketRef.current?.emit("player:leave:room");
      }
    },
    [currentRoomId]
  );

  const movePlayer = useCallback(
    (position: PlayerPosition) => {
      setLocalPosition(position);
      socketRef.current?.emit("player:move", position);
      if (map) checkRoomEntry(position, map);
    },
    [map, checkRoomEntry]
  );

  return { map, players, localPosition, movePlayer, currentRoomId };
}
