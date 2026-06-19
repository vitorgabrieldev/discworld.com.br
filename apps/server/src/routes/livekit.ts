import type { FastifyInstance } from "fastify";
import { AccessToken } from "livekit-server-sdk";

export async function livekitRoutes(app: FastifyInstance) {
  // Generate a LiveKit token for the player to join a voice room
  app.get<{ Querystring: { roomId: string; identity: string; name: string } }>(
    "/token",
    async (req, reply) => {
      const token = req.cookies.discord_token;
      if (!token) {
        reply.status(401).send({ error: "Unauthenticated" });
        return;
      }

      const { roomId, identity, name } = req.query;

      if (!roomId || !identity) {
        reply.status(400).send({ error: "roomId and identity are required" });
        return;
      }

      const apiKey = process.env.LIVEKIT_API_KEY;
      const apiSecret = process.env.LIVEKIT_API_SECRET;

      if (!apiKey || !apiSecret) {
        reply.status(503).send({ error: "LiveKit not configured" });
        return;
      }

      const at = new AccessToken(apiKey, apiSecret, {
        identity,
        name,
        ttl: "4h",
      });

      at.addGrant({
        roomJoin: true,
        room: roomId,
        canPublish: true,
        canSubscribe: true,
      });

      return { token: await at.toJwt() };
    }
  );
}
