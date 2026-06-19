import type { FastifyInstance } from "fastify";
import type { GuildStructure } from "@repo/shared";
import { generateWorldMap } from "../services/mapGenerator.js";

const DISCORD_API = "https://discord.com/api/v10";

async function getDiscordToken(req: any, reply: any): Promise<string | null> {
  const token = req.cookies.discord_token;
  if (!token) {
    reply.status(401).send({ error: "Unauthenticated" });
    return null;
  }
  return token;
}

export async function guildRoutes(app: FastifyInstance) {
  // List guilds where user is owner/admin
  app.get("/list", async (req, reply) => {
    const token = await getDiscordToken(req, reply);
    if (!token) return;

    const res = await fetch(`${DISCORD_API}/users/@me/guilds`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      reply.status(res.status).send({ error: "Failed to fetch guilds" });
      return;
    }

    const guilds = (await res.json()) as Array<{
      id: string;
      name: string;
      icon: string | null;
      owner: boolean;
      permissions: string;
    }>;

    // Only guilds where user is owner or has MANAGE_GUILD (bit 5 = 32)
    return guilds.filter(
      (g) => g.owner || (BigInt(g.permissions) & BigInt(0x20)) !== BigInt(0)
    );
  });

  // Get full guild structure and generate map
  app.get<{ Params: { guildId: string } }>(
    "/:guildId/map",
    async (req, reply) => {
      const token = await getDiscordToken(req, reply);
      if (!token) return;

      const { guildId } = req.params;

      // Bot token needed to fetch channels — frontend sends bot guild access via OAuth bot scope
      // For MVP: use the Bot token on the server side
      const botToken = process.env.DISCORD_BOT_TOKEN;
      if (!botToken) {
        reply.status(503).send({ error: "Bot token not configured" });
        return;
      }

      const [guildRes, channelsRes, rolesRes] = await Promise.all([
        fetch(`${DISCORD_API}/guilds/${guildId}`, {
          headers: { Authorization: `Bot ${botToken}` },
        }),
        fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
          headers: { Authorization: `Bot ${botToken}` },
        }),
        fetch(`${DISCORD_API}/guilds/${guildId}/roles`, {
          headers: { Authorization: `Bot ${botToken}` },
        }),
      ]);

      if (!guildRes.ok || !channelsRes.ok || !rolesRes.ok) {
        reply.status(403).send({ error: "Cannot access guild. Is the bot installed?" });
        return;
      }

      const [guild, channels, roles] = await Promise.all([
        guildRes.json(),
        channelsRes.json(),
        rolesRes.json(),
      ]);

      const categories = (channels as any[]).filter((c) => c.type === 4);
      const voiceAndText = (channels as any[]).filter((c) => c.type === 0 || c.type === 2);

      const structure: GuildStructure = {
        guild,
        categories,
        channels: voiceAndText,
        roles,
      };

      const worldMap = generateWorldMap(structure);
      return worldMap;
    }
  );
}
