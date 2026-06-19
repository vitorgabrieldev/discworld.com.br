import type { FastifyInstance } from "fastify";

const DISCORD_API = "https://discord.com/api/v10";

export async function discordRoutes(app: FastifyInstance) {
  // Step 1: redirect to Discord OAuth
  app.get("/login", async (req, reply) => {
    const params = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID!,
      redirect_uri: process.env.DISCORD_REDIRECT_URI!,
      response_type: "code",
      scope: "identify guilds",
    });
    reply.redirect(`https://discord.com/oauth2/authorize?${params}`);
  });

  // Step 2: Discord redirects back with ?code=
  app.get<{ Querystring: { code?: string; error?: string } }>(
    "/callback",
    async (req, reply) => {
      const { code, error } = req.query;

      if (error || !code) {
        reply.redirect(`${process.env.FRONTEND_URL}/?error=access_denied`);
        return;
      }

      const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.DISCORD_CLIENT_ID!,
          client_secret: process.env.DISCORD_CLIENT_SECRET!,
          grant_type: "authorization_code",
          code,
          redirect_uri: process.env.DISCORD_REDIRECT_URI!,
        }),
      });

      if (!tokenRes.ok) {
        reply.redirect(`${process.env.FRONTEND_URL}/?error=token_exchange_failed`);
        return;
      }

      const tokens = (await tokenRes.json()) as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
      };

      reply.redirect(`${process.env.FRONTEND_URL}/select-server#token=${tokens.access_token}`);
    }
  );

  // GET /auth/me — return current user info
  app.get("/me", async (req, reply) => {
    const authHeader = (req.headers.authorization as string | undefined);
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : req.cookies?.discord_token;
    if (!token) {
      reply.status(401).send({ error: "Unauthenticated" });
      return;
    }

    const res = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      reply.status(401).send({ error: "Invalid token" });
      return;
    }

    return res.json();
  });

  // GET /auth/token — expose token to frontend (for Socket.io auth)
  app.get("/token", async (req, reply) => {
    const authHeader = (req.headers.authorization as string | undefined);
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : req.cookies?.discord_token;
    if (!token) {
      reply.status(401).send({ error: "Unauthenticated" });
      return;
    }
    return { token };
  });

  // GET /auth/logout
  app.get("/logout", async (req, reply) => {
    reply.clearCookie("discord_token", { path: "/" });
    reply.redirect(process.env.FRONTEND_URL!);
  });
}
