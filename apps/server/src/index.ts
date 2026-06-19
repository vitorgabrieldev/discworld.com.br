import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { Server } from "socket.io";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
} from "@repo/shared";

import { discordRoutes } from "./routes/discord.js";
import { guildRoutes } from "./routes/guild.js";
import { livekitRoutes } from "./routes/livekit.js";
import { registerSocketHandlers } from "./socket/handlers.js";

const app = Fastify({ logger: false });

await app.register(cors, {
  origin: process.env.FRONTEND_URL ?? "http://localhost:3000",
  credentials: true,
});

await app.register(cookie, {
  secret: process.env.COOKIE_SECRET ?? "discworld-secret-change-in-production",
});

await app.register(discordRoutes, { prefix: "/auth" });
await app.register(guildRoutes, { prefix: "/api/guild" });
await app.register(livekitRoutes, { prefix: "/api/livekit" });

app.get("/health", async () => ({ status: "ok" }));

const port = Number(process.env.PORT ?? 3001);

// Fastify faz o listen e expõe o server nativo via app.server
await app.listen({ port, host: "0.0.0.0" });
console.log(`Server running on http://localhost:${port}`);

// Socket.io anexa no mesmo servidor HTTP do Fastify
const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>(app.server, {
  cors: {
    origin: process.env.FRONTEND_URL ?? "http://localhost:3000",
    credentials: true,
  },
});

registerSocketHandlers(io);
