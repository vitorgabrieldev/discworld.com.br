"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Room,
  RoomEvent,
  RemoteParticipant,
  Track,
  createLocalAudioTrack,
} from "livekit-client";
import type { Player, PlayerPosition } from "@repo/shared";
import {
  MicIcon, MicOffIcon, HeadphoneIcon, HeadphoneOffIcon, ChevronIcon,
} from "./DiscordIcons";
import styles from "./VoiceRoom.module.css";

interface Props {
  roomId: string;
  identity: string;
  name: string;
  players: Record<string, Player>;
  localPosition: PlayerPosition;
}

const MAX_HEAR_DISTANCE = 8; // tiles

interface DeviceList {
  inputs: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
}

export function VoiceRoom({ roomId, identity, name, players, localPosition }: Props) {
  const roomRef     = useRef<Room | null>(null);
  const audioRefs   = useRef<Map<string, HTMLAudioElement>>(new Map());
  const playersRef  = useRef(players);
  const localPosRef = useRef(localPosition);

  const [connected, setConnected] = useState(false);
  const [muted,     setMuted]     = useState(false);   // mic muted
  const [deafened,  setDeafened]  = useState(false);   // output muted
  const [speaking,  setSpeaking]  = useState(false);   // local mic activity

  const [devices,   setDevices]   = useState<DeviceList>({ inputs: [], outputs: [] });
  const [inputId,   setInputId]   = useState<string>("");
  const [outputId,  setOutputId]  = useState<string>("");
  const [openMenu,  setOpenMenu]  = useState<null | "input" | "output">(null);

  useEffect(() => { playersRef.current = players; }, [players]);
  useEffect(() => { localPosRef.current = localPosition; }, [localPosition]);

  // ── Enumerate audio devices ──────────────────────────────────────────────
  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices({
        inputs:  all.filter((d) => d.kind === "audioinput"),
        outputs: all.filter((d) => d.kind === "audiooutput"),
      });
    } catch { /* permission not granted yet */ }
  }, []);

  // ── Connect ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let room: Room;
    let cancelled = false;

    async function join() {
      const tokenRes = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URL}/api/livekit/token?roomId=${roomId}&identity=${identity}&name=${encodeURIComponent(name)}`,
        { credentials: "include" }
      );
      if (!tokenRes.ok || cancelled) return;
      const { token } = await tokenRes.json() as { token: string };

      room = new Room();
      roomRef.current = room;

      room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach() as HTMLAudioElement;
          el.autoplay = true;
          if (outputId && (el as any).setSinkId) (el as any).setSinkId(outputId).catch(() => {});
          audioRefs.current.set(participant.identity, el);
          updateVolume(participant, el);
        }
      });

      room.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
        if (track.kind === Track.Kind.Audio) {
          track.detach();
          audioRefs.current.delete(participant.identity);
        }
      });

      // local mic activity → speaking ring
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        setSpeaking(speakers.some((s) => s.isLocal));
      });

      await room.connect(process.env.NEXT_PUBLIC_LIVEKIT_URL!, token);
      if (cancelled) { room.disconnect(); return; }

      const localTrack = await createLocalAudioTrack({
        echoCancellation: true,
        noiseSuppression: true,
        deviceId: inputId || undefined,
      });
      await room.localParticipant.publishTrack(localTrack);

      setConnected(true);
      refreshDevices();
    }

    join().catch(() => { /* connection aborted (unmount/navigation) */ });
    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);

    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener("devicechange", refreshDevices);
      // disconnect() rejects with "Client initiated disconnect" — that's the
      // expected teardown path, so swallow it instead of surfacing an error.
      try { void Promise.resolve(room?.disconnect()).catch(() => {}); } catch { /* noop */ }
      setConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, identity, name]);

  // ── Spatial volume update ────────────────────────────────────────────────
  useEffect(() => {
    if (!roomRef.current) return;
    for (const [id, el] of audioRefs.current.entries()) {
      const participant = roomRef.current.remoteParticipants.get(id);
      if (participant) updateVolume(participant, el);
    }
  }, [localPosition, players, deafened]);

  function updateVolume(participant: RemoteParticipant, el: HTMLAudioElement) {
    if (deafened) { el.volume = 0; return; }
    const remotePlayer = Object.values(playersRef.current).find(
      (p) => p.discordId === participant.identity
    );
    if (!remotePlayer) return;
    const dx = remotePlayer.position.x - localPosRef.current.x;
    const dy = remotePlayer.position.y - localPosRef.current.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    el.volume = Math.max(0, 1 - dist / MAX_HEAR_DISTANCE);
  }

  // ── Controls ─────────────────────────────────────────────────────────────
  async function toggleMute() {
    const room = roomRef.current;
    if (!room) return;
    const next = !muted;
    const pub  = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (pub) next ? await pub.mute() : await pub.unmute();
    setMuted(next);
    // un-deafening implicitly when speaking again is Discord behavior; here we
    // keep them independent except: deafen also mutes mic (like Discord).
    if (!next && deafened) setDeafened(false);
  }

  function toggleDeafen() {
    const next = !deafened;
    setDeafened(next);
    // Discord: deafening also mutes your mic
    if (next && !muted) toggleMute();
    // apply to all current audio elements immediately
    for (const [id, el] of audioRefs.current.entries()) {
      const p = roomRef.current?.remoteParticipants.get(id);
      if (next) el.volume = 0;
      else if (p) updateVolume(p, el);
    }
  }

  async function selectInput(id: string) {
    setInputId(id);
    setOpenMenu(null);
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.switchActiveDevice("audioinput", id);
    } catch { /* fallback: republish */ }
  }

  async function selectOutput(id: string) {
    setOutputId(id);
    setOpenMenu(null);
    for (const el of audioRefs.current.values()) {
      if ((el as any).setSinkId) (el as any).setSinkId(id).catch(() => {});
    }
  }

  if (!connected) {
    return (
      <div className={styles.voiceBar}>
        <span className={styles.connectingDot} />
        <span className={styles.statusText}>Conectando à voz…</span>
      </div>
    );
  }

  const inputLabel  = devices.inputs.find((d) => d.deviceId === inputId)?.label  || "Microfone padrão";
  const outputLabel = devices.outputs.find((d) => d.deviceId === outputId)?.label || "Saída padrão";

  return (
    <div className={styles.voicePanel}>
      {/* status header */}
      <div className={styles.header}>
        <div className={`${styles.signal} ${speaking ? styles.signalActive : ""}`}>
          <span /><span /><span />
        </div>
        <div className={styles.headerText}>
          <strong>Voz conectada</strong>
          <small>{name}</small>
        </div>
      </div>

      {/* control row */}
      <div className={styles.controls}>
        {/* MIC */}
        <div className={styles.controlGroup}>
          <button
            className={`${styles.ctrlBtn} ${muted ? styles.ctrlBtnDanger : ""}`}
            onClick={toggleMute}
            title={muted ? "Reativar microfone" : "Desativar microfone"}
          >
            {muted ? <MicOffIcon /> : <MicIcon />}
          </button>
          <button
            className={styles.chevronBtn}
            onClick={() => setOpenMenu(openMenu === "input" ? null : "input")}
            title="Dispositivo de entrada"
          >
            <ChevronIcon />
          </button>
          {openMenu === "input" && (
            <DeviceMenu
              title="ENTRADA"
              devices={devices.inputs}
              activeId={inputId}
              onSelect={selectInput}
            />
          )}
        </div>

        {/* DEAFEN / OUTPUT */}
        <div className={styles.controlGroup}>
          <button
            className={`${styles.ctrlBtn} ${deafened ? styles.ctrlBtnDanger : ""}`}
            onClick={toggleDeafen}
            title={deafened ? "Reativar áudio" : "Ensurdecer"}
          >
            {deafened ? <HeadphoneOffIcon /> : <HeadphoneIcon />}
          </button>
          <button
            className={styles.chevronBtn}
            onClick={() => setOpenMenu(openMenu === "output" ? null : "output")}
            title="Dispositivo de saída"
          >
            <ChevronIcon />
          </button>
          {openMenu === "output" && (
            <DeviceMenu
              title="SAÍDA"
              devices={devices.outputs}
              activeId={outputId}
              onSelect={selectOutput}
            />
          )}
        </div>
      </div>

      {/* active device labels (like Discord's user settings footer) */}
      <div className={styles.deviceFooter}>
        <span title={inputLabel}>🎙 {inputLabel}</span>
        <span title={outputLabel}>🔈 {outputLabel}</span>
        <span className={styles.leaveHint}>Saia da sala para desconectar</span>
      </div>
    </div>
  );
}

function DeviceMenu({
  title, devices, activeId, onSelect,
}: {
  title: string;
  devices: MediaDeviceInfo[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className={styles.menu}>
      <div className={styles.menuTitle}>{title}</div>
      {devices.length === 0 && <div className={styles.menuEmpty}>Nenhum dispositivo</div>}
      {devices.map((d) => {
        const isActive = d.deviceId === activeId || (activeId === "" && d.deviceId === "default");
        return (
          <button
            key={d.deviceId}
            className={`${styles.menuItem} ${isActive ? styles.menuItemActive : ""}`}
            onClick={() => onSelect(d.deviceId)}
          >
            <span className={styles.menuRadio}>{isActive && <span />}</span>
            <span className={styles.menuLabel}>{d.label || "Dispositivo"}</span>
          </button>
        );
      })}
    </div>
  );
}
