"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronIcon } from "./DiscordIcons";
import styles from "./ServerSwitcher.module.css";

interface Guild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
}

export function ServerSwitcher({ currentGuildId }: { currentGuildId: string }) {
  const router = useRouter();
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [open, setOpen]     = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_SERVER_URL}/api/guild/list`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Guild[]) => setGuilds(data))
      .catch(() => setGuilds([]));
  }, []);

  // close on outside click
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const current = guilds.find((g) => g.id === currentGuildId);

  function iconUrl(g: Guild) {
    return g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.webp?size=64` : null;
  }
  function initials(name: string) {
    return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  }

  function select(id: string) {
    setOpen(false);
    if (id !== currentGuildId) router.push(`/world/${id}`);
  }

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button className={styles.trigger} onClick={() => setOpen((o) => !o)}>
        <span className={styles.avatar}>
          {current && iconUrl(current)
            ? <img src={iconUrl(current)!} alt="" width={28} height={28} />
            : <span className={styles.initials}>{current ? initials(current.name) : "?"}</span>}
        </span>
        <span className={styles.name}>{current?.name ?? "Servidor"}</span>
        <ChevronIcon className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`} />
      </button>

      {open && (
        <div className={styles.menu}>
          <div className={styles.menuTitle}>SEUS SERVIDORES</div>
          {guilds.length === 0 && <div className={styles.empty}>Nenhum servidor</div>}
          {guilds.map((g) => {
            const url = iconUrl(g);
            const active = g.id === currentGuildId;
            return (
              <button
                key={g.id}
                className={`${styles.item} ${active ? styles.itemActive : ""}`}
                onClick={() => select(g.id)}
              >
                <span className={styles.avatarSm}>
                  {url ? <img src={url} alt="" width={24} height={24} />
                       : <span className={styles.initialsSm}>{initials(g.name)}</span>}
                </span>
                <span className={styles.itemName}>{g.name}</span>
                {g.owner && <span className={styles.badge}>Dono</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
