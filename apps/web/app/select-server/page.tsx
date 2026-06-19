"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import { setToken, getToken, authHeaders } from "../../lib/auth";

interface Guild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
}

export default function SelectServerPage() {
  const router = useRouter();
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith("#token=")) {
      setToken(hash.slice(7));
      window.history.replaceState(null, "", window.location.pathname);
    }

    const token = getToken();
    if (!token) {
      setError("Erro ao carregar servidores. Faça login novamente.");
      setLoading(false);
      return;
    }

    fetch(`${process.env.NEXT_PUBLIC_SERVER_URL}/api/guild/list`, {
      headers: authHeaders(),
    })
      .then((r) => {
        if (!r.ok) throw new Error("Unauthenticated");
        return r.json() as Promise<Guild[]>;
      })
      .then(setGuilds)
      .catch(() => setError("Erro ao carregar servidores. Faça login novamente."))
      .finally(() => setLoading(false));
  }, []);

  function getIconUrl(guild: Guild) {
    if (!guild.icon) return null;
    return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.webp?size=128`;
  }

  function getInitials(name: string) {
    return name
      .split(" ")
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }

  if (loading) {
    return (
      <div className={styles.center}>
        <div className={styles.spinner} />
        <p>Carregando seus servidores…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.center}>
        <p className={styles.error}>{error}</p>
        <a href={`${process.env.NEXT_PUBLIC_SERVER_URL}/auth/login`} className={styles.btn}>
          Fazer login novamente
        </a>
      </div>
    );
  }

  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <h1>Escolha um servidor</h1>
        <p>Você pode entrar em servidores onde é dono ou administrador.</p>
      </div>

      {guilds.length === 0 ? (
        <div className={styles.empty}>
          <p>Nenhum servidor encontrado onde você é admin.</p>
        </div>
      ) : (
        <div className={styles.grid}>
          {guilds.map((guild) => {
            const iconUrl = getIconUrl(guild);
            return (
              <button
                key={guild.id}
                className={styles.card}
                onClick={() => router.push(`/world/${guild.id}`)}
              >
                <div className={styles.icon}>
                  {iconUrl ? (
                    <img src={iconUrl} alt={guild.name} width={64} height={64} />
                  ) : (
                    <span className={styles.initials}>{getInitials(guild.name)}</span>
                  )}
                </div>
                <div className={styles.info}>
                  <span className={styles.name}>{guild.name}</span>
                  {guild.owner && <span className={styles.ownerBadge}>Dono</span>}
                </div>
                <span className={styles.arrow}>→</span>
              </button>
            );
          })}
        </div>
      )}
    </main>
  );
}
