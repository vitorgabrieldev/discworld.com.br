"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { WorldMap, Player, Prop, Tile, Painting } from "@repo/shared";
import { useGameSocket } from "../../hooks/useGameSocket";
import { useDiscordUser } from "../../hooks/useDiscordUser";
import { VoiceRoom } from "./VoiceRoom";
import { ServerSwitcher } from "./ServerSwitcher";
import styles from "./WorldView.module.css";

// ── Spritesheet layout (same asset as before) ──────────────────────────────
const SHEET_COLS = 6;
const SHEET_ROWS = 5;
const FRAME_COUNT = 6;
const ROW_DOWN  = 0;
const ROW_UP    = 1;
const ROW_LEFT  = 2;
const ROW_RIGHT = 3;
type Direction = "down" | "up" | "left" | "right";

function rowFor(dir: Direction): number {
  switch (dir) {
    case "down":  return ROW_DOWN;
    case "up":    return ROW_UP;
    case "left":  return ROW_LEFT;
    case "right": return ROW_RIGHT;
  }
}

// World scale: 1 tile = 1 world unit. Wall height in units.
const WALL_H = 3.8;
const PLAYER_H = 1.4; // billboard height
const SPEED = 5.5;    // tiles per second

// Small sound pool: preloads one clip and round-robins a few <audio> clones so
// overlapping plays don't cut each other off. Stable & cheap (no per-play alloc).
class SoundPool {
  private pool: HTMLAudioElement[] = [];
  private idx = 0;
  constructor(src: string, size = 4, volume = 1) {
    for (let i = 0; i < size; i++) {
      const a = new Audio(src);
      a.preload = "auto";
      a.volume = volume;
      this.pool.push(a);
    }
  }
  play() {
    const a = this.pool[this.idx];
    this.idx = (this.idx + 1) % this.pool.length;
    if (!a) return;
    try { a.currentTime = 0; void a.play().catch(() => {}); } catch { /* noop */ }
  }
}

// A seamless looping clip (footsteps): play while moving, pause when idle.
class LoopSound {
  private a: HTMLAudioElement;
  private on = false;
  constructor(src: string, volume = 1) {
    this.a = new Audio(src);
    this.a.loop = true;
    this.a.preload = "auto";
    this.a.volume = volume;
  }
  start() {
    if (this.on) return;
    this.on = true;
    try { void this.a.play().catch(() => {}); } catch { /* noop */ }
  }
  stop() {
    if (!this.on) return;
    this.on = false;
    try { this.a.pause(); this.a.currentTime = 0; } catch { /* noop */ }
  }
  setVolume(v: number) { this.a.volume = Math.max(0, Math.min(1, v)); }
}

// Derive a tangent-space normal map from a grayscale heightmap canvas (Sobel).
// This gives the flat canvas textures real relief under the scene lights.
function normalFromHeight(src: HTMLCanvasElement, strength = 2.0): THREE.Texture {
  const w = src.width, h = src.height; // supports non-square canvases (e.g. doors)
  const sctx = src.getContext("2d")!;
  const data = sctx.getImageData(0, 0, w, h).data;
  const lum = (x: number, y: number) => {
    x = (x + w) % w; y = (y + h) % h;
    const i = (y * w + x) * 4;
    return (data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114) / 255;
  };
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  const octx = out.getContext("2d")!;
  const img = octx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (lum(x - 1, y) - lum(x + 1, y)) * strength;
      const dy = (lum(x, y - 1) - lum(x, y + 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i]     = ((dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len) * 0.5 * 255 + 127;
      img.data[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(out);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ── Procedural canvas textures (high-res, baked once) ──────────────────────
function makeWoodFloorTexture(): THREE.Texture {
  const s = 256;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#9a7a52";
  ctx.fillRect(0, 0, s, s);
  const planks = 4;
  const pw = s / planks;
  for (let i = 0; i < planks; i++) {
    const px = i * pw;
    const tone = i % 2 === 0 ? "#9a7a52" : "#8e7048";
    ctx.fillStyle = tone;
    ctx.fillRect(px, 0, pw, s);
    // seam
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(px + pw - 2, 0, 2, s);
    // grain
    ctx.strokeStyle = "rgba(0,0,0,0.06)";
    ctx.lineWidth = 1;
    for (let g = 0; g < 6; g++) {
      const gx = px + 6 + g * (pw / 6);
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.bezierCurveTo(gx + 4, s * 0.33, gx - 4, s * 0.66, gx, s);
      ctx.stroke();
    }
    // random knots
    for (let k = 0; k < 2; k++) {
      const ky = ((i * 97 + k * 53) % 100) / 100 * s;
      ctx.beginPath();
      ctx.ellipse(px + pw / 2, ky, 4, 7, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// Painted plaster wall: a near-white, warm-neutral surface with very fine
// orange-peel grain and faint broad mottling (subtle unevenness). The relief
// comes from the high-frequency speckle when this canvas is turned into a
// normal map, so the wall reads as matte plaster rather than flat color.
function makePlasterTexture(): THREE.Texture {
  const s = 512;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d")!;

  // Base off-white (warm neutral, like the reference photo)
  ctx.fillStyle = "#e9e7e1";
  ctx.fillRect(0, 0, s, s);

  // Faint broad mottles — gentle light/dark clouds for natural unevenness
  for (let i = 0; i < 18; i++) {
    const x = Math.random() * s, y = Math.random() * s;
    const r = 40 + Math.random() * 130;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = Math.random() > 0.5;
    g.addColorStop(0, dark ? "rgba(120,110,95,0.05)" : "rgba(255,255,255,0.06)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Fine per-pixel speckle — the plaster grain (drives the normal-map relief)
  const img = ctx.getImageData(0, 0, s, s);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 16; // ±~6% luminance jitter
    d[i]     = Math.max(0, Math.min(255, d[i]! + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1]! + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2]! + n));
  }
  ctx.putImageData(img, 0, 0);

  // Sparse tiny stipple bumps — the "orange peel" pits/highlights
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * s, y = Math.random() * s;
    ctx.fillStyle = Math.random() > 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)";
    ctx.fillRect(x, y, 1.4, 1.4);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// Dark walnut door with two recessed panels. The panel bevels are drawn as
// luminance ramps (frame = brighter/higher, field = darker/lower) so that the
// derived normal map turns them into real 3D relief under the scene lights.
function makeDoorTexture(): THREE.Texture {
  // Canvas aspect (256/660 ≈ 0.388) matches the leaf face (leafLen / DOOR_H),
  // so the texture maps 1:1 with no stretching.
  const W = 256, H = 660;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;

  const baseR = 74, baseG = 50, baseB = 32; // #4a3220 — dark walnut frame tone
  const frameCol = `rgb(${baseR},${baseG},${baseB})`;
  const fieldCol = `rgb(${baseR - 26},${baseG - 19},${baseB - 12})`; // recessed field (lower → darker)

  ctx.fillStyle = frameCol;
  ctx.fillRect(0, 0, W, H);

  // vertical plank streaks across the whole leaf
  for (let i = 0; i < 95; i++) {
    const x = Math.random() * W;
    const wdt = 1 + Math.random() * 2.6;
    const sh = (Math.random() - 0.5) * 28;
    ctx.fillStyle = `rgba(${Math.max(0, baseR + sh) | 0},${Math.max(0, baseG + sh * 0.7) | 0},${Math.max(0, baseB + sh * 0.5) | 0},0.5)`;
    ctx.fillRect(x, 0, wdt, H);
  }
  // long wavy grain lines
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 24; i++) {
    const x0 = Math.random() * W;
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    for (let y = 0; y <= H; y += 16) ctx.lineTo(x0 + Math.sin(y * 0.02 + i) * 3, y);
    ctx.stroke();
  }

  // ── two recessed panels ──────────────────────────────────────────────
  const stile = W * 0.15;          // side rails
  const railT = H * 0.055;         // top rail
  const railB = H * 0.085;         // bottom rail
  const midY  = H * 0.52, midH = H * 0.055; // lock rail (between panels)
  const bevel = 16;

  const panel = (px: number, py: number, pw: number, ph: number) => {
    ctx.fillStyle = fieldCol;
    ctx.fillRect(px, py, pw, ph);
    // four bevel ramps frame(high) → field(low)
    let g = ctx.createLinearGradient(0, py, 0, py + bevel);
    g.addColorStop(0, frameCol); g.addColorStop(1, fieldCol);
    ctx.fillStyle = g; ctx.fillRect(px, py, pw, bevel);                       // top
    g = ctx.createLinearGradient(0, py + ph - bevel, 0, py + ph);
    g.addColorStop(0, fieldCol); g.addColorStop(1, frameCol);
    ctx.fillStyle = g; ctx.fillRect(px, py + ph - bevel, pw, bevel);          // bottom
    g = ctx.createLinearGradient(px, 0, px + bevel, 0);
    g.addColorStop(0, frameCol); g.addColorStop(1, fieldCol);
    ctx.fillStyle = g; ctx.fillRect(px, py, bevel, ph);                       // left
    g = ctx.createLinearGradient(px + pw - bevel, 0, px + pw, 0);
    g.addColorStop(0, fieldCol); g.addColorStop(1, frameCol);
    ctx.fillStyle = g; ctx.fillRect(px + pw - bevel, py, bevel, ph);          // right
    // a thin moulded bead just inside the bevel
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    ctx.strokeRect(px + bevel * 0.6, py + bevel * 0.6, pw - bevel * 1.2, ph - bevel * 1.2);
  };

  panel(stile, railT, W - stile * 2, midY - railT);                   // upper panel
  panel(stile, midY + midH, W - stile * 2, H - railB - (midY + midH)); // lower panel

  // darken the extreme leaf edge a touch
  ctx.strokeStyle = "rgba(0,0,0,0.30)";
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, W - 3, H - 3);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeCorridorTexture(): THREE.Texture {
  const s = 256;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#9a7440";
  ctx.fillRect(0, 0, s, s);
  const planks = 5;
  const ph = s / planks;
  const cols = ["#9a7440", "#8a6638", "#a07c46"];
  for (let i = 0; i < planks; i++) {
    ctx.fillStyle = cols[i % cols.length]!;
    ctx.fillRect(0, i * ph, s, ph);
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.fillRect(0, i * ph + ph - 2, s, 2);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(0, i * ph, s, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function makeGrassTexture(): THREE.Texture {
  const s = 256;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, "#5a8a3a");
  g.addColorStop(1, "#4d7e30");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  // dapples + blades
  for (let i = 0; i < 400; i++) {
    const x = Math.random() * s, y = Math.random() * s;
    ctx.fillStyle = Math.random() > 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)";
    ctx.fillRect(x, y, 2, 3);
  }
  ctx.strokeStyle = "rgba(40,90,30,0.4)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 120; i++) {
    const x = Math.random() * s, y = Math.random() * s;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 3, y - 4);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// Sign / nameplate as a canvas texture sprite
function makeLabelTexture(text: string, isVoice: boolean): THREE.Texture {
  const font = "600 40px Inter, system-ui, sans-serif";
  // measure first
  const meas = document.createElement("canvas").getContext("2d")!;
  meas.font = font;
  const tw = meas.measureText(text).width;

  const c = document.createElement("canvas");
  c.width = Math.ceil(tw + 100);
  c.height = 80;
  const cx = c.getContext("2d")!;
  cx.font = font;
  // panel
  cx.fillStyle = isVoice ? "rgba(22,46,30,0.95)" : "rgba(24,25,28,0.95)";
  roundRectPath(cx, 0, 0, c.width, c.height, 16);
  cx.fill();
  cx.fillStyle = isVoice ? "#23a559" : "#5865f2";
  roundRectPath(cx, 0, 0, 8, c.height, 8);
  cx.fill();
  // icon + text
  cx.textBaseline = "middle";
  cx.fillStyle = isVoice ? "#3ba55d" : "#949ba4";
  cx.fillText(isVoice ? "🔊" : "#", 24, c.height / 2);
  cx.fillStyle = isVoice ? "#dcffe8" : "#dbdee1";
  cx.fillText(text, 70, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ── Build the static world geometry from the map ───────────────────────────
// ── Daytime sky: gradient dome, sun disc, and soft drifting clouds ─────────
function buildSky(scene: THREE.Scene): THREE.Group {
  // Sky dome with a vertical gradient (zenith blue → horizon haze)
  const skyGeo = new THREE.SphereGeometry(300, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top:    { value: new THREE.Color("#3a86d8") },
      bottom: { value: new THREE.Color("#cfe6f7") },
      offset: { value: 30 },
      expo:   { value: 0.7 },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 top; uniform vec3 bottom;
      uniform float offset; uniform float expo;
      varying vec3 vWorldPos;
      void main() {
        float h = normalize(vWorldPos + vec3(0.0, offset, 0.0)).y;
        float t = pow(max(h, 0.0), expo);
        gl_FragColor = vec4(mix(bottom, top, t), 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);

  // Sun disc (a glowing sprite) placed where the directional light comes from
  const sunCanvas = document.createElement("canvas");
  sunCanvas.width = sunCanvas.height = 128;
  const sctx = sunCanvas.getContext("2d")!;
  const grad = sctx.createRadialGradient(64, 64, 6, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,245,1)");
  grad.addColorStop(0.3, "rgba(255,247,210,0.95)");
  grad.addColorStop(1, "rgba(255,240,190,0)");
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 128, 128);
  const sunTex = new THREE.CanvasTexture(sunCanvas);
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, transparent: true, depthWrite: false, fog: false }));
  sunSprite.scale.set(48, 48, 1);
  sunSprite.position.set(120, 170, 80);
  scene.add(sunSprite);

  // Clouds — soft puff sprites drifting on a high plane
  const clouds = new THREE.Group();
  const cloudCanvas = document.createElement("canvas");
  cloudCanvas.width = cloudCanvas.height = 256;
  const cc = cloudCanvas.getContext("2d")!;
  for (let i = 0; i < 18; i++) {
    const x = 40 + Math.random() * 176;
    const y = 80 + Math.random() * 96;
    const r = 25 + Math.random() * 45;
    const g = cc.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    cc.fillStyle = g;
    cc.beginPath();
    cc.arc(x, y, r, 0, Math.PI * 2);
    cc.fill();
  }
  const cloudTex = new THREE.CanvasTexture(cloudCanvas);
  const cloudMat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, opacity: 0.85, fog: false });
  for (let i = 0; i < 14; i++) {
    const s = new THREE.Sprite(cloudMat);
    const size = 30 + Math.random() * 50;
    s.scale.set(size, size * 0.55, 1);
    s.position.set(
      (Math.random() - 0.5) * 360,
      90 + Math.random() * 60,
      (Math.random() - 0.5) * 360,
    );
    clouds.add(s);
  }
  scene.add(clouds);
  return clouds;
}

function buildWorld(scene: THREE.Scene, map: WorldMap, tex: {
  floor: THREE.Texture; wall: THREE.Texture; wallTop: THREE.Texture;
  corridor: THREE.Texture; grass: THREE.Texture;
}): DoorObj[] {
  const W = map.width, H = map.height;

  // Materials
  // Derive relief (normal maps) from each texture's own canvas so the flat
  // surfaces gain real depth under the scene lights.
  const nrm = (t: THREE.Texture, strength: number) =>
    normalFromHeight(t.image as HTMLCanvasElement, strength);
  const ns = new THREE.Vector2(1, 1);

  const floorMat    = new THREE.MeshStandardMaterial({ map: tex.floor, roughness: 0.85, normalMap: nrm(tex.floor, 2.5), normalScale: ns });
  const corridorMat = new THREE.MeshStandardMaterial({ map: tex.corridor, roughness: 0.8, normalMap: nrm(tex.corridor, 2.5), normalScale: ns });
  const grassMat    = new THREE.MeshStandardMaterial({ map: tex.grass, roughness: 1, normalMap: nrm(tex.grass, 1.5), normalScale: ns });
  // Matte painted plaster: fine grain, very gentle relief. Tile (1,4) keeps the
  // grain near-square on the 1m×3.8m wall face and small enough to read as a
  // wall finish (not a pattern). The normal map MUST share the color map's
  // .repeat or the relief desyncs from the surface.
  const wallNrm = nrm(tex.wall, 1.4);
  tex.wall.repeat.set(1, 4);
  wallNrm.repeat.set(1, 4);
  const wallSideMat = new THREE.MeshStandardMaterial({ map: tex.wall, roughness: 0.96, normalMap: wallNrm, normalScale: new THREE.Vector2(0.45, 0.45) });

  const wallTopNrm = nrm(tex.wallTop, 1.4);
  tex.wallTop.repeat.set(1, 1);
  wallTopNrm.repeat.set(1, 1);
  const wallTopMat  = new THREE.MeshStandardMaterial({ map: tex.wallTop, roughness: 0.96, normalMap: wallTopNrm, normalScale: new THREE.Vector2(0.45, 0.45) });
  // Dark walnut door: textured + normal-mapped so the recessed panels read 3D.
  const doorTex = makeDoorTexture();
  const doorNrm = nrm(doorTex, 3.0);
  const doorMat = new THREE.MeshStandardMaterial({
    map: doorTex, normalMap: doorNrm, normalScale: new THREE.Vector2(1.3, 1.3),
    roughness: 0.66, metalness: 0.04,
  });

  // Brass knob hardware (shared geometries; knob protrudes along local +Z).
  const brassMat  = new THREE.MeshStandardMaterial({ color: "#c9a23f", roughness: 0.26, metalness: 0.95 });
  const brassDark = new THREE.MeshStandardMaterial({ color: "#9c7a2e", roughness: 0.36, metalness: 0.9 });
  const rosetteGeo = new THREE.CylinderGeometry(0.062, 0.068, 0.02, 18); rosetteGeo.rotateX(Math.PI / 2);
  const stemGeo    = new THREE.CylinderGeometry(0.017, 0.024, 0.05, 14); stemGeo.rotateX(Math.PI / 2);
  const ballGeo    = new THREE.SphereGeometry(0.046, 18, 14);
  function buildKnob(): THREE.Group {
    const k = new THREE.Group();
    const ros  = new THREE.Mesh(rosetteGeo, brassDark); ros.position.z  = 0.01;
    const stem = new THREE.Mesh(stemGeo, brassMat);     stem.position.z = 0.04;
    const ball = new THREE.Mesh(ballGeo, brassMat);     ball.position.z = 0.08; ball.scale.set(1, 1, 0.82);
    k.add(ros, stem, ball);
    k.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
    return k;
  }

  const isWall = (x: number, y: number) => map.tiles[y]?.[x]?.type === "wall";

  // ── Ground (one flat quad per tile, instanced by surface type) ─────────
  // We lay floor UNDER walls too (so thin walls never reveal a gap), grass
  // outside, corridor where present.
  type Cell = { x: number; z: number };
  const floors: Cell[] = [];
  const corridors: Cell[] = [];
  const grasses: Cell[] = [];
  const doors: Cell[] = [];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = map.tiles[y]?.[x];
      if (!t) continue;
      const cell = { x, z: y };
      switch (t.type) {
        case "grass":    grasses.push(cell); break;
        case "corridor": corridors.push(cell); break;
        case "door":     doors.push(cell); floors.push(cell); break;
        case "wall":     floors.push(cell); break; // floor under the wall
        default:         floors.push(cell); break;
      }
    }
  }

  function groundInstanced(cells: Cell[], mat: THREE.Material, y = 0) {
    if (cells.length === 0) return;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.InstancedMesh(geo, mat, cells.length);
    mesh.receiveShadow = true;
    const m = new THREE.Matrix4();
    cells.forEach((cell, i) => {
      m.makeTranslation(cell.x + 0.5, y, cell.z + 0.5);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
  }
  groundInstanced(floors, floorMat);
  groundInstanced(corridors, corridorMat);
  groundInstanced(grasses, grassMat, -0.02); // grass slightly lower than floor

  // ── Walls: solid, thin slabs centered on each wall tile. A straight run
  // gets one slab; a corner/junction gets two crossed slabs (a clean joint);
  // an isolated tile becomes a post. Doorways get only a header slab above the
  // opening so the wall carries on over the door (solid, never hollow). ──────
  const WALL_TH = 0.5; // visual wall thickness (centered in the tile)
  const DOOR_H  = 2.6; // door opening height; wall continues above as a header
  const SILL = 1.0, HEAD = 2.5; // window opening: wall below the sill + header above
  const WIN_SPACING = 4;        // modular: a (2-tile-wide) window every N tiles along an exterior run
  const slabs: THREE.BufferGeometry[] = [];
  const caps: THREE.BufferGeometry[] = [];
  const winFrames: THREE.BufferGeometry[] = [];
  const winGlass: THREE.BufferGeometry[] = [];

  const box = (
    list: THREE.BufferGeometry[],
    w: number, h: number, d: number, cx: number, cy: number, cz: number,
  ) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(cx, cy, cz);
    list.push(g);
  };

  const LIP = WALL_TH + 0.06; // coping cap is a touch wider than the wall

  // A tile counts as "outside" if it's grass or beyond the map edge.
  const outside = (xx: number, yy: number) => {
    const tt = map.tiles[yy]?.[xx];
    return !tt || tt.type === "grass";
  };

  // A window needs a CLEAN exterior stretch: across the tile and its run
  // neighbours, the outer side faces outdoors and the inner side is open room
  // (never a wall). Keeps windows off corners and away from any interior wall
  // meeting the façade (which would otherwise sit right in front of the glass).
  const cleanWin = (x: number, y: number, horizontal: boolean): boolean => {
    if (horizontal) {
      if (!(isWall(x - 1, y) && isWall(x + 1, y))) return false;
      const nOut = outside(x, y - 1), sOut = outside(x, y + 1);
      if (nOut === sOut) return false;
      const oy = nOut ? y - 1 : y + 1, iy = nOut ? y + 1 : y - 1;
      return outside(x - 1, oy) && outside(x, oy) && outside(x + 1, oy)
          && !isWall(x - 1, iy) && !isWall(x, iy) && !isWall(x + 1, iy);
    }
    if (!(isWall(x, y - 1) && isWall(x, y + 1))) return false;
    const eOut = outside(x + 1, y), wOut = outside(x - 1, y);
    if (eOut === wOut) return false;
    const ox = eOut ? x + 1 : x - 1, ix = eOut ? x - 1 : x + 1;
    return outside(ox, y - 1) && outside(ox, y) && outside(ox, y + 1)
        && !isWall(ix, y - 1) && !isWall(ix, y) && !isWall(ix, y + 1);
  };

  // Pre-pass: place windows at the modular interval, each spanning 2 tiles when
  // the next tile is also a clean stretch (wider windows), else 1 tile.
  type WinInfo = { horizontal: boolean; anchor: boolean; span: number };
  const winInfo = new Map<string, WinInfo>();
  const wkey = (x: number, y: number) => `${x},${y}`;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (map.tiles[y]?.[x]?.type !== "wall" || winInfo.has(wkey(x, y))) continue;
      const horizontal = x % WIN_SPACING === 0 && cleanWin(x, y, true) ? true
                       : y % WIN_SPACING === 0 && cleanWin(x, y, false) ? false
                       : null;
      if (horizontal === null) continue;
      const nx = horizontal ? x + 1 : x, ny = horizontal ? y : y + 1;
      const canPair = map.tiles[ny]?.[nx]?.type === "wall"
                   && !winInfo.has(wkey(nx, ny))
                   && cleanWin(nx, ny, horizontal);
      winInfo.set(wkey(x, y), { horizontal, anchor: true, span: canPair ? 2 : 1 });
      if (canPair) winInfo.set(wkey(nx, ny), { horizontal, anchor: false, span: 0 });
    }
  }

  // Glass + a SLIM cased, silled, mullioned frame filling the opening
  // (SILL→HEAD), centred on the span. The frame and glazing bars are thin in
  // depth (not as deep as the wall) — a delicate window set in the reveal.
  const FB = 0.05;        // sash frame bar width (in-plane)
  const BAR_W = 0.028;    // glazing bar (muntin) width — slim grid
  const CASE_T = 0.09;    // outer casing (architrave) width
  const SASH_D = 0.10;    // frame/bar DEPTH across the wall — slim, not wall-deep
  const glassD = 0.03;
  const winMidY = (SILL + HEAD) / 2, winOpenH = HEAD - SILL;
  const addWindow = (horizontal: boolean, ca: number, cc: number, hw: number, cols: number) => {
    // place a box via along/cross mapping (along = wall run; cc = wall centre)
    const put = (
      list: THREE.BufferGeometry[],
      aLen: number, yLen: number, dLen: number, aPos: number, yPos: number,
    ) => {
      if (horizontal) box(list, aLen, yLen, dLen, aPos, yPos, cc);
      else            box(list, dLen, yLen, aLen, cc, yPos, aPos);
    };
    const fullW = 2 * hw, caseD = SASH_D + 0.05, barD = SASH_D * 0.8;
    // outer casing (flat architrave around the opening)
    put(winFrames, fullW + 2 * CASE_T, CASE_T, caseD, ca, HEAD + CASE_T / 2);
    put(winFrames, CASE_T, winOpenH + 2 * CASE_T, caseD, ca - hw - CASE_T / 2, winMidY);
    put(winFrames, CASE_T, winOpenH + 2 * CASE_T, caseD, ca + hw + CASE_T / 2, winMidY);
    // inner sash frame
    put(winFrames, fullW + 2 * FB, FB, SASH_D, ca, HEAD);            // head rail
    put(winFrames, fullW + 2 * FB, FB, SASH_D, ca, SILL);           // sill rail
    put(winFrames, FB, winOpenH, SASH_D, ca - hw - FB / 2, winMidY); // left stile
    put(winFrames, FB, winOpenH, SASH_D, ca + hw + FB / 2, winMidY); // right stile
    // glazing bars: (cols-1) vertical + one horizontal → a slim grid of panes
    for (let i = 1; i < cols; i++) {
      put(winFrames, BAR_W, winOpenH, barD, ca - hw + (fullW * i) / cols, winMidY);
    }
    put(winFrames, fullW, BAR_W, barD, ca, winMidY);               // horizontal bar
    // slim protruding sill ledge
    put(winFrames, fullW + 2 * CASE_T, 0.05, SASH_D + 0.12, ca, SILL - CASE_T);
    // glass
    put(winGlass, fullW, winOpenH, glassD, ca, winMidY);
  };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = map.tiles[y]?.[x];
      const isW = t?.type === "wall";
      const isDoor = t?.type === "door";
      if (!isW && !isDoor) continue;

      const runEW = isWall(x - 1, y) || isWall(x + 1, y); // part of an E–W run
      const runNS = isWall(x, y - 1) || isWall(x, y + 1); // part of a N–S run
      const cx = x + 0.5, cz = y + 0.5;

      if (isW) {
        const win = winInfo.get(wkey(x, y));
        if (win) {
          // window tile: wall below the sill + header above, opening between
          const upH = WALL_H - HEAD;
          if (win.horizontal) {
            box(slabs, 1, SILL, WALL_TH, cx, SILL / 2, cz);
            box(slabs, 1, upH, WALL_TH, cx, HEAD + upH / 2, cz);
            box(caps, 1, 0.12, LIP, cx, WALL_H + 0.06, cz);
          } else {
            box(slabs, WALL_TH, SILL, 1, cx, SILL / 2, cz);
            box(slabs, WALL_TH, upH, 1, cx, HEAD + upH / 2, cz);
            box(caps, LIP, 0.12, 1, cx, WALL_H + 0.06, cz);
          }
          // the anchor draws the (possibly 2-tile-wide) glazed frame, centred
          if (win.anchor) {
            const ca = (win.horizontal ? cx : cz) + (win.span - 1) * 0.5;
            const cc = win.horizontal ? cz : cx;
            addWindow(win.horizontal, ca, cc, win.span * 0.5 - 0.1, win.span + 1);
          }
        } else {
          if (runEW) box(slabs, 1, WALL_H, WALL_TH, cx, WALL_H / 2, cz);
          if (runNS) box(slabs, WALL_TH, WALL_H, 1, cx, WALL_H / 2, cz);
          if (!runEW && !runNS) box(slabs, WALL_TH, WALL_H, WALL_TH, cx, WALL_H / 2, cz);
          // matching coping cap(s) on top
          if (runEW) box(caps, 1, 0.12, LIP, cx, WALL_H + 0.06, cz);
          if (runNS) box(caps, LIP, 0.12, 1, cx, WALL_H + 0.06, cz);
          if (!runEW && !runNS) box(caps, LIP, 0.12, LIP, cx, WALL_H + 0.06, cz);
        }
      } else {
        // doorway header: solid slab from DOOR_H to WALL_H, matching orientation
        const h = WALL_H - DOOR_H;
        if (runEW) {
          box(slabs, 1, h, WALL_TH, cx, DOOR_H + h / 2, cz);
          box(caps, 1, 0.12, LIP, cx, WALL_H + 0.06, cz);
        } else {
          box(slabs, WALL_TH, h, 1, cx, DOOR_H + h / 2, cz);
          box(caps, LIP, 0.12, 1, cx, WALL_H + 0.06, cz);
        }
      }
    }
  }

  if (slabs.length) {
    const merged = mergeGeometries(slabs);
    const mesh = new THREE.Mesh(merged, wallSideMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  if (caps.length) {
    const merged = mergeGeometries(caps);
    const mesh = new THREE.Mesh(merged, wallTopMat);
    mesh.castShadow = true;
    scene.add(mesh);
  }
  if (winFrames.length) {
    const frameMat = new THREE.MeshStandardMaterial({ color: "#ece9e2", roughness: 0.5, metalness: 0.0 });
    const mesh = new THREE.Mesh(mergeGeometries(winFrames), frameMat);
    mesh.castShadow = true;
    scene.add(mesh);
  }
  if (winGlass.length) {
    // Translucent glass — you can see the garden / city through it.
    const glassMat = new THREE.MeshStandardMaterial({
      color: "#bfe0f5", transparent: true, opacity: 0.24,
      roughness: 0.06, metalness: 0.0,
      emissive: 0x213a4a, emissiveIntensity: 0.15,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const mesh = new THREE.Mesh(mergeGeometries(winGlass), glassMat);
    scene.add(mesh);
  }

  // ── Doors: group adjacent door tiles into doorways (1 or 2 tiles wide),
  // then build a hinged leaf per tile. A 2-tile doorway becomes a double door
  // whose two leaves swing apart. Each leaf hinges at the doorway's outer edge.
  const doorObjs: DoorObj[] = [];
  const LEAF_T = 0.1;                 // leaf thickness
  // DOOR_H is defined above (the doorway opening height); the wall continues
  // above it as a header. The leaf is just under that so it clears the opening.
  const LEAF_W = 0.96;               // leaf covers ~1 tile

  const doorSet = new Set(doors.map((d) => `${d.x},${d.z}`));
  const visited = new Set<string>();

  for (const d of doors) {
    const key = `${d.x},${d.z}`;
    if (visited.has(key)) continue;

    // The door follows the wall it sits in. Wall tiles continue along the wall
    // on both sides of the doorway:
    //   walls above & below (N/S)  → the wall runs vertically → door runs Z
    //   walls left & right (E/W)   → the wall runs horizontally → door runs X
    const wallsNS = isWall(d.x, d.z - 1) || isWall(d.x, d.z + 1);
    const wallsEW = isWall(d.x - 1, d.z) || isWall(d.x + 1, d.z);
    // alongX = leaf lies flat along X (wall is horizontal)
    const alongX  = wallsEW && !wallsNS ? true
                  : wallsNS && !wallsEW ? false
                  : wallsEW; // ambiguous corner fallback

    // gather the contiguous run of door tiles along the opening axis
    const run: Array<{ x: number; z: number }> = [{ x: d.x, z: d.z }];
    visited.add(key);
    const stepX = alongX ? 1 : 0;
    const stepZ = alongX ? 0 : 1;
    for (const sign of [1, -1]) {
      let nx = d.x + stepX * sign, nz = d.z + stepZ * sign;
      while (doorSet.has(`${nx},${nz}`)) {
        const k = `${nx},${nz}`;
        if (!visited.has(k)) { run.push({ x: nx, z: nz }); visited.add(k); }
        nx += stepX * sign; nz += stepZ * sign;
      }
    }
    run.sort((a, b) => alongX ? a.x - b.x : a.z - b.z);

    const span = run.length;
    const centerX = run.reduce((s, t) => s + t.x + 0.5, 0) / span;
    const centerZ = run.reduce((s, t) => s + t.z + 0.5, 0) / span;

    run.forEach((tile, idx) => {
      const cx = tile.x + 0.5, cz = tile.z + 0.5;
      // for a double door the two leaves hinge on opposite ends
      const hingeHigh = span > 1 && idx === span - 1;
      const dirSign = hingeHigh ? -1 : 1; // direction the leaf extends from hinge

      // Leaf length = exactly half the doorway tile so two leaves meet flush in
      // the middle (no centre gap). A single-tile door uses the whole tile.
      const leafLen = span > 1 ? 1.0 : 1.0;

      const pivot = new THREE.Group();
      // leaf lies along the opening axis (X when alongX, else Z)
      const leafGeo = new THREE.BoxGeometry(
        alongX ? leafLen : LEAF_T,
        DOOR_H,
        alongX ? LEAF_T : leafLen,
      );
      leafGeo.translate(
        alongX ? (leafLen / 2) * dirSign : 0,
        DOOR_H / 2,
        alongX ? 0 : (leafLen / 2) * dirSign,
      );
      const leaf = new THREE.Mesh(leafGeo, doorMat);
      leaf.castShadow = true;
      pivot.add(leaf);

      // A brass knob on each face (so it reads from both sides), set back from
      // the free edge. The assembly protrudes along the door's normal axis: Z
      // when the leaf lies along X, else X — flipped per face.
      const knobAlong = leafLen - 0.2; // back from the free tip
      for (const face of [1, -1]) {
        const k = buildKnob();
        k.rotation.y = alongX
          ? (face === 1 ? 0 : Math.PI)
          : (face === 1 ? Math.PI / 2 : -Math.PI / 2);
        k.position.set(
          alongX ? knobAlong * dirSign : (LEAF_T / 2) * face,
          DOOR_H * 0.46,
          alongX ? (LEAF_T / 2) * face : knobAlong * dirSign,
        );
        pivot.add(k);
      }

      // hinge sits at the outer edge of this leaf's tile (opposite dirSign)
      if (alongX) pivot.position.set(cx - (leafLen / 2) * dirSign, 0, cz);
      else        pivot.position.set(cx, 0, cz - (leafLen / 2) * dirSign);

      scene.add(pivot);

      // Pre-compute the two open angles for THIS leaf: one that swings the free
      // edge toward the negative side of the perpendicular axis, one toward the
      // positive side. The runtime then just picks the side away from the player
      // so every leaf of a double door swings the same physical way.
      const SWING = Math.PI * 0.52;
      // A leaf along X hinged at dirSign: +rotation.y sends the free tip toward
      // -Z; along Z it sends it toward +X. Encode that relationship:
      const openToNeg = alongX
        ? SWING * dirSign        // toward -Z
        : -SWING * dirSign;      // toward -X
      const openToPos = -openToNeg;

      doorObjs.push({
        pivot, cx: centerX, cz: centerZ,
        alongX, openToNeg, openToPos,
        target: 0, current: 0, closeAt: 0, armed: true,
      });
    });
  }
  return doorObjs;
}

interface DoorObj {
  pivot: THREE.Group;
  cx: number; cz: number;     // world center of the doorway (for distance test)
  alongX: boolean;            // doorway orientation
  openToNeg: number;          // rotation that opens toward the - perpendicular side
  openToPos: number;          // rotation that opens toward the + perpendicular side
  target: number;             // current target angle
  current: number;            // animated angle
  closeAt: number;            // timestamp after which it may start closing
  armed: boolean;             // ready to pick a (new) opening side
}

// ── Garden props in 3D ─────────────────────────────────────────────────────
function buildProps(scene: THREE.Scene, props: Prop[]) {
  const group = new THREE.Group();

  const trunkMat  = new THREE.MeshStandardMaterial({ color: "#5a3d20", roughness: 1 });
  const leafMats  = [
    new THREE.MeshStandardMaterial({ color: "#3f7a32", roughness: 1 }),
    new THREE.MeshStandardMaterial({ color: "#357029", roughness: 1 }),
    new THREE.MeshStandardMaterial({ color: "#46823a", roughness: 1 }),
  ];
  const bushMat   = new THREE.MeshStandardMaterial({ color: "#458a38", roughness: 1 });
  const ballWhite = new THREE.MeshStandardMaterial({ color: "#f5f5f5", roughness: 0.5 });
  const dogBody   = new THREE.MeshStandardMaterial({ color: "#8a5a30", roughness: 0.9 });
  const dogRoof   = new THREE.MeshStandardMaterial({ color: "#a0392b", roughness: 0.9 });

  const trunkGeo  = new THREE.CylinderGeometry(0.12, 0.16, 0.9, 6);
  const leafGeo   = new THREE.IcosahedronGeometry(0.55, 0);
  const bushGeo   = new THREE.IcosahedronGeometry(0.4, 0);
  const ballGeo   = new THREE.SphereGeometry(0.22, 12, 10);
  const dogBodyGeo= new THREE.BoxGeometry(0.7, 0.5, 0.6);
  const dogRoofGeo= new THREE.ConeGeometry(0.55, 0.4, 4);

  for (const p of props) {
    const px = p.x, pz = p.y;
    if (p.type === "tree") {
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.set(px, 0.45, pz);
      trunk.castShadow = true;
      group.add(trunk);
      const leaf = new THREE.Mesh(leafGeo, leafMats[p.variant % leafMats.length]!);
      leaf.position.set(px, 1.25, pz);
      leaf.scale.setScalar(1 + (p.variant % 3) * 0.12);
      leaf.castShadow = true;
      group.add(leaf);
    } else if (p.type === "bush") {
      const b = new THREE.Mesh(bushGeo, bushMat);
      b.position.set(px, 0.32, pz);
      b.castShadow = true;
      group.add(b);
    } else if (p.type === "ball") {
      const b = new THREE.Mesh(ballGeo, ballWhite);
      b.position.set(px, 0.22, pz);
      b.castShadow = true;
      group.add(b);
    } else if (p.type === "doghouse") {
      const body = new THREE.Mesh(dogBodyGeo, dogBody);
      body.position.set(px, 0.25, pz);
      body.castShadow = true;
      group.add(body);
      const roof = new THREE.Mesh(dogRoofGeo, dogRoof);
      roof.position.set(px, 0.7, pz);
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      group.add(roof);
    } else if (p.type === "flower") {
      const colors = ["#e84393", "#fdcb6e", "#74b9ff", "#ffffff"];
      const fm = new THREE.MeshStandardMaterial({ color: colors[p.variant % colors.length]!, roughness: 0.8 });
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 5), fm);
      f.position.set(px, 0.14, pz);
      group.add(f);
    }
  }
  scene.add(group);
}

// ── Framed wall paintings ───────────────────────────────────────────────────
// Placement comes pre-computed (seeded) from the map; here we just build a
// gilded frame + the picture and mount it flush against the wall, facing in.
const PAINTING_SRCS = [
  "/paintings/painting-1.png",
  "/paintings/painting-2.png",
  "/paintings/painting-3.png",
];
// w/h of each shipped image — lets us size the frame without waiting on load.
const PAINTING_ASPECT = [514 / 600, 500 / 498, 720 / 1440];

function buildPaintings(scene: THREE.Scene, paintings: Painting[]) {
  if (!paintings || paintings.length === 0) return;

  const CENTER_Y    = 1.55;  // fixed, comfortable hang height (picture center)
  const FRAME_DEPTH = 0.07;
  const MOLDING     = 0.07;  // frame border width (world units)
  // Distance from the room/wall tile boundary to the wall face. Walls are thin
  // slabs centered in their tile (buildWorld WALL_TH=0.5), so the face sits
  // 0.5 − WALL_TH/2 = 0.25 inside the boundary. Mounts the frame flush.
  const WALL_FACE_INSET = 0.25;

  const loader = new THREE.TextureLoader();
  // One shared picture material per image (texture loaded once, reused).
  const picMats = PAINTING_SRCS.map((src) => {
    const tex = loader.load(src);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return new THREE.MeshStandardMaterial({
      map: tex,
      emissive: 0xffffff,
      emissiveMap: tex,
      emissiveIntensity: 0.22, // keep art legible even in a shadowed room
      roughness: 0.85,
      metalness: 0,
    });
  });

  // Gilded wood molding + dark backing, shared across every painting.
  const frameMat = new THREE.MeshStandardMaterial({ color: "#b0863a", roughness: 0.42, metalness: 0.55 });
  const backMat  = new THREE.MeshStandardMaterial({ color: "#1a140d", roughness: 0.9 });

  const dirFor = (f: Painting["facing"]) =>
    f === "south" ? { x: 0,  z: 1,  ry: 0 }
    : f === "north" ? { x: 0,  z: -1, ry: Math.PI }
    : f === "east"  ? { x: 1,  z: 0,  ry: Math.PI / 2 }
    :                 { x: -1, z: 0,  ry: -Math.PI / 2 };

  const root = new THREE.Group();

  for (const pa of paintings) {
    const idx = ((pa.image % PAINTING_SRCS.length) + PAINTING_SRCS.length) % PAINTING_SRCS.length;
    const aspect = PAINTING_ASPECT[idx] ?? 1;
    const picH = pa.height;
    const picW = picH * aspect;

    const g = new THREE.Group();
    const d = dirFor(pa.facing);
    g.rotation.y = d.ry;
    // Mount the frame's back flush with the wall face, extending into the room.
    g.position.set(
      pa.x - d.x * WALL_FACE_INSET,
      CENTER_Y,
      pa.y - d.z * WALL_FACE_INSET,
    );

    // backing board (hides any sliver of wall behind the picture)
    const back = new THREE.Mesh(
      new THREE.BoxGeometry(picW + MOLDING, picH + MOLDING, 0.02),
      backMat,
    );
    back.position.z = FRAME_DEPTH * 0.35;
    g.add(back);

    // the picture itself, slightly recessed within the frame
    const pic = new THREE.Mesh(new THREE.PlaneGeometry(picW, picH), picMats[idx]!);
    pic.position.z = FRAME_DEPTH * 0.72;
    g.add(pic);

    // four molding bars around the picture
    const halfW = picW / 2, halfH = picH / 2, m2 = MOLDING / 2;
    const bar = (w: number, h: number, x: number, y: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, FRAME_DEPTH), frameMat);
      m.position.set(x, y, FRAME_DEPTH / 2);
      m.castShadow = true;
      g.add(m);
    };
    bar(picW + MOLDING * 2, MOLDING, 0, halfH + m2);     // top
    bar(picW + MOLDING * 2, MOLDING, 0, -(halfH + m2));  // bottom
    bar(MOLDING, picH, -(halfW + m2), 0);                // left
    bar(MOLDING, picH, halfW + m2, 0);                   // right

    root.add(g);
  }

  scene.add(root);
}

// ── Surroundings: white picket fence, a ring road, and background buildings ─
// All procedural, placed around the map's outer edge to make the scene alive.
function buildSurroundings(scene: THREE.Scene, W: number, H: number) {
  const group = new THREE.Group();

  // Big ground plane under everything (grass extending past the property)
  const groundMat = new THREE.MeshStandardMaterial({ color: "#5a8a3a", roughness: 1 });
  const groundGeo = new THREE.PlaneGeometry(W * 4, H * 4);
  groundGeo.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.position.set(W / 2, -0.08, H / 2);
  ground.receiveShadow = true;
  group.add(ground);

  // The fence runs just inside the map border (the grass yard edge).
  const fx0 = 1.2, fz0 = 1.2;
  const fx1 = W - 1.2, fz1 = H - 1.2;

  // ── White picket fence ──────────────────────────────────────────────
  const whiteMat = new THREE.MeshStandardMaterial({ color: "#f2f2ee", roughness: 0.7 });
  const PICKET_W = 0.12, PICKET_H = 0.85, GAP = 0.34;
  const pickets: THREE.BufferGeometry[] = [];
  const rails: THREE.BufferGeometry[] = [];

  // one picket = a thin box + a pointed cap (small pyramid) on top
  function addPicket(x: number, z: number) {
    const body = new THREE.BoxGeometry(PICKET_W, PICKET_H, PICKET_W);
    body.translate(x, PICKET_H / 2, z);
    pickets.push(body);
    const cap = new THREE.ConeGeometry(PICKET_W * 0.8, 0.14, 4);
    cap.rotateY(Math.PI / 4);
    cap.translate(x, PICKET_H + 0.07, z);
    pickets.push(cap);
  }
  // two horizontal rails connecting the pickets along a side
  function addRail(x1: number, z1: number, x2: number, z2: number) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    for (const ry of [PICKET_H * 0.35, PICKET_H * 0.72]) {
      const rail = new THREE.BoxGeometry(len, 0.07, 0.05);
      rail.translate(0, 0, 0);
      // orient along the side
      const m = new THREE.Matrix4();
      const ang = Math.atan2(z2 - z1, x2 - x1);
      m.makeRotationY(-ang);
      rail.applyMatrix4(m);
      rail.translate((x1 + x2) / 2, ry, (z1 + z2) / 2);
      rails.push(rail);
    }
  }

  // place pickets around the 4 sides (leave a gap as a "gate" on the south)
  const gateCenter = (fx0 + fx1) / 2, gateHalf = 1.5;
  function side(ax: number, az: number, bx: number, bz: number, skipGate = false) {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.floor(len / GAP);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      if (skipGate && Math.abs(x - gateCenter) < gateHalf && Math.abs(z - fz1) < 0.5) continue;
      addPicket(x, z);
    }
    addRail(ax, az, bx, bz);
  }
  side(fx0, fz0, fx1, fz0);            // north
  side(fx0, fz1, fx1, fz1, true);      // south (with gate gap)
  side(fx0, fz0, fx0, fz1);            // west
  side(fx1, fz0, fx1, fz1);            // east

  if (pickets.length) {
    const mesh = new THREE.Mesh(mergeGeometries(pickets), whiteMat);
    mesh.castShadow = true;
    group.add(mesh);
  }
  if (rails.length) {
    const mesh = new THREE.Mesh(mergeGeometries(rails), whiteMat);
    mesh.castShadow = true;
    group.add(mesh);
  }

  // ── Ring road around the property ───────────────────────────────────
  const ROAD_W = 6;
  const roadMat = new THREE.MeshStandardMaterial({ color: "#3a3d42", roughness: 0.95 });
  const cx = W / 2, cz = H / 2;
  const outer = Math.max(W, H) + ROAD_W * 2;
  // a big flat ring: draw as 4 long quads just outside the map bounds
  function roadStrip(x: number, z: number, w: number, d: number) {
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, roadMat);
    m.position.set(x, -0.05, z);
    m.receiveShadow = true;
    group.add(m);
  }
  const R0 = -ROAD_W;          // road starts just outside the map (tile 0)
  roadStrip(cx, R0 + ROAD_W / 2, W + ROAD_W * 2, ROAD_W);          // north strip
  roadStrip(cx, H + ROAD_W / 2, W + ROAD_W * 2, ROAD_W);           // south strip
  roadStrip(R0 + ROAD_W / 2, cz, ROAD_W, H + ROAD_W * 2);          // west strip
  roadStrip(W + ROAD_W / 2, cz, ROAD_W, H + ROAD_W * 2);           // east strip

  // dashed yellow center lines on N/S strips
  const lineMat = new THREE.MeshStandardMaterial({ color: "#e3c64a", roughness: 0.8 });
  for (let x = 0; x < W; x += 3) {
    for (const z of [R0 + ROAD_W / 2, H + ROAD_W / 2]) {
      const g = new THREE.PlaneGeometry(1.4, 0.25);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, lineMat);
      m.position.set(x + 0.7, -0.04, z);
      group.add(m);
    }
  }

  // ── Background buildings: 5 staggered rows on every side, so the rows
  // behind plug the gaps of the rows in front and the map edge is hidden. ──
  const bColors = [
    "#8a93a3", "#a08c7a", "#7c8a96", "#9a8f86", "#6f7e8c", "#b0a08c",
    "#c08a6a", "#6a8c7a", "#9a6a7a", "#7a7aa0", "#5f6e7c", "#b09a6a",
  ];
  const winLit = "#fce8a0", winDark = "#2b3340";

  // High-res pixelated façade: chunky window blocks of varying sizes.
  function makeBuildingTex(base: string): THREE.Texture {
    const c = document.createElement("canvas");
    c.width = 128; c.height = 256;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 128, 256);
    // subtle vertical shading bands (concrete panels)
    for (let x = 0; x < 128; x += 16) {
      ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
      ctx.fillRect(x, 0, 16, 256);
    }
    // window rows with varied sizes per building
    const rowH = 18 + Math.floor(Math.random() * 14);   // varied storey height
    const winW = 12 + Math.floor(Math.random() * 12);   // varied window width
    const gapX = 8 + Math.floor(Math.random() * 8);
    const padY = Math.floor(rowH * 0.28);
    for (let y = 8; y < 248; y += rowH) {
      for (let x = 8; x < 120; x += winW + gapX) {
        ctx.fillStyle = Math.random() > 0.4 ? winLit : winDark;
        ctx.fillRect(x, y, winW, rowH - padY);
        // frame
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.fillRect(x, y, winW, 1);
        ctx.fillRect(x, y, 1, rowH - padY);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;  // crisp pixelated look
    tex.minFilter = THREE.NearestFilter;
    return tex;
  }
  // a decent pool of unique façades so neighbours rarely repeat
  const facadeMats = Array.from({ length: 22 }, () => {
    const base = bColors[Math.floor(Math.random() * bColors.length)]!;
    return new THREE.MeshStandardMaterial({ map: makeBuildingTex(base), roughness: 0.9 });
  });

  const ROWS = 5;        // depth: 5 layers of buildings
  const ROW_GAP = 7;     // distance between rows
  const STEP = 7;        // spacing between buildings along a row

  function ringBuildings(side: "n" | "s" | "e" | "w") {
    const along = side === "n" || side === "s" ? W : H;
    for (let row = 0; row < ROWS; row++) {
      // each row sits further out, is taller, and is offset half a step so it
      // covers the gaps of the row in front of it
      const dist = ROAD_W + 4 + row * ROW_GAP;
      const offset = (row % 2) * (STEP / 2);
      const heightBoost = row * 5; // back rows taller → block the horizon
      for (let p = -dist - STEP; p < along + dist + STEP; p += STEP) {
        const bw = 4 + Math.random() * 2.5;
        const bh = 9 + heightBoost + Math.random() * 16;
        const bd = 4 + Math.random() * 2.5;
        const mat = facadeMats[Math.floor(Math.random() * facadeMats.length)]!;
        const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat);
        const a = p + offset;
        let x = 0, z = 0;
        if (side === "n") { x = a; z = -dist - bd / 2; }
        if (side === "s") { x = a; z = H + dist + bd / 2; }
        if (side === "w") { x = -dist - bd / 2; z = a; }
        if (side === "e") { x = W + dist + bd / 2; z = a; }
        b.position.set(x, bh / 2 - 0.05, z);
        b.castShadow = true;
        group.add(b);
      }
    }
  }
  ringBuildings("n"); ringBuildings("s"); ringBuildings("e"); ringBuildings("w");

  scene.add(group);
}

// ── Billboard character (with ground shadow for 3D grounding) ──────────────
let _shadowTex: THREE.Texture | null = null;
function contactShadowTexture(): THREE.Texture {
  if (_shadowTex) return _shadowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, "rgba(0,0,0,0.5)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  _shadowTex = new THREE.CanvasTexture(c);
  return _shadowTex;
}

class Character {
  root: THREE.Group;
  sprite: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  tex: THREE.Texture;
  dir: Direction = "down";
  frame = 0;
  frameTime = 0;
  nameSprite: THREE.Sprite;

  constructor(sheet: THREE.Texture, name: string, isLocal: boolean) {
    this.root = new THREE.Group();

    this.tex = sheet.clone();
    this.tex.needsUpdate = true;
    this.tex.repeat.set(1 / SHEET_COLS, 1 / SHEET_ROWS);
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.minFilter = THREE.NearestFilter;
    this.setFrame(0, "down");

    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, alphaTest: 0.3 });
    const geo = new THREE.PlaneGeometry(PLAYER_H, PLAYER_H);
    this.sprite = new THREE.Mesh(geo, this.mat);
    this.sprite.position.y = PLAYER_H / 2;
    this.root.add(this.sprite);

    // contact shadow on the ground
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(PLAYER_H * 0.8, PLAYER_H * 0.5),
      new THREE.MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    this.root.add(shadow);

    // nameplate
    const nameTex = makeNameTexture(name, isLocal);
    const nameMat = new THREE.SpriteMaterial({ map: nameTex, transparent: true, depthTest: false });
    this.nameSprite = new THREE.Sprite(nameMat);
    this.nameSprite.scale.set(1.6, 0.4, 1);
    this.nameSprite.position.y = PLAYER_H + 0.4;
    this.sprite.add(this.nameSprite);
  }

  setFrame(frame: number, dir: Direction) {
    const row = rowFor(dir);
    this.tex.offset.set(frame / SHEET_COLS, 1 - (row + 1) / SHEET_ROWS);
  }

  update(dt: number, moving: boolean, dir: Direction, camera: THREE.Camera) {
    this.dir = dir;
    if (moving) {
      this.frameTime += dt;
      if (this.frameTime > 0.12) {
        this.frame = (this.frame + 1) % FRAME_COUNT;
        this.frameTime = 0;
      }
    } else {
      this.frame = 0;
    }
    this.setFrame(this.frame, dir);
    // billboard: yaw the sprite to face the camera (Y axis only)
    const dx = camera.position.x - this.root.position.x;
    const dz = camera.position.z - this.root.position.z;
    this.sprite.rotation.y = Math.atan2(dx, dz);
  }
}

function makeNameTexture(name: string, isLocal: boolean): THREE.Texture {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  ctx.font = "700 28px Inter, system-ui, sans-serif";
  const tw = ctx.measureText(name).width;
  c.width = Math.ceil(tw + 32);
  c.height = 44;
  const cx = c.getContext("2d")!;
  cx.font = "700 28px Inter, system-ui, sans-serif";
  cx.fillStyle = "rgba(0,0,0,0.55)";
  roundRectPath(cx, 0, 0, c.width, c.height, 10);
  cx.fill();
  cx.fillStyle = isLocal ? "#fff" : "#dbdee1";
  cx.textAlign = "center";
  cx.textBaseline = "middle";
  cx.fillText(name, c.width / 2, c.height / 2 + 1);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

interface Props { guildId: string }

export function WorldView({ guildId }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);

  const { user, loading: userLoading } = useDiscordUser();
  const { map, players, localPosition, movePlayer, currentRoomId } = useGameSocket(guildId, user);

  // Mic permission: "pending" until the user responds to the pre-game prompt.
  // Requesting before the 3D loop starts avoids the stuck-key bug caused by the
  // browser permission dialog stealing focus while a key is held down.
  const [micPermission, setMicPermission] = useState<"pending" | "granted" | "denied">("pending");

  // Skip the card if the browser already has a stored decision for this origin.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions) return;
    navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then((status) => {
        // Only skip the card when already granted — for "denied" and "prompt"
        // we still show it so the user knows their mic status up front.
        if (status.state === "granted") setMicPermission("granted");
        status.onchange = () => {
          if (status.state === "granted") setMicPermission("granted");
          else if (status.state === "denied") setMicPermission("denied");
        };
      })
      .catch(() => {});
  }, []);

  const keysRef = useRef<Set<string>>(new Set());
  const playersRef = useRef(players);
  const mapRef = useRef(map);
  const userRef = useRef(user);
  const moveRef = useRef(movePlayer);
  useEffect(() => { playersRef.current = players; }, [players]);
  useEffect(() => { mapRef.current = map; }, [map]);
  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => { moveRef.current = movePlayer; }, [movePlayer]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => keysRef.current.add(e.key.toLowerCase());
    const up   = (e: KeyboardEvent) => keysRef.current.delete(e.key.toLowerCase());
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useEffect(() => {
    if (!map || !mountRef.current || !user) return;
    const worldMap = map;
    const mount = mountRef.current;

    // ── Renderer / scene / camera ────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    // If the GL context is ever lost, stop the loop gracefully instead of
    // throwing on every frame (which is what surfaces as a runtime crash).
    let contextLost = false;
    const onCtxLost = (e: Event) => { e.preventDefault(); contextLost = true; };
    renderer.domElement.addEventListener("webglcontextlost", onCtxLost);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog("#bcd8f0", 70, 150);

    const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 400);

    // ── Daytime sky (gradient dome + sun + drifting clouds) ──────────────
    const clouds = buildSky(scene);

    // ── Lights ───────────────────────────────────────────────────────────
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const hemi = new THREE.HemisphereLight(0xaecbff, 0x6b5436, 0.7);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.15);
    sun.position.set(40, 60, 25); // aligned with the visible sun in the sky
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 160;
    const sc = sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40;
    sun.shadow.bias = -0.0004;
    scene.add(sun);
    scene.add(sun.target);

    // ── Build world ──────────────────────────────────────────────────────
    const tex = {
      floor: makeWoodFloorTexture(),
      wall: makePlasterTexture(),
      wallTop: makePlasterTexture(),
      corridor: makeCorridorTexture(),
      grass: makeGrassTexture(),
    };
    const doorObjs = buildWorld(scene, worldMap, tex);
    buildProps(scene, worldMap.props ?? []);
    buildPaintings(scene, worldMap.paintings ?? []);
    buildSurroundings(scene, worldMap.width, worldMap.height);

    // ── Channel signs: a plaque floating in the middle of each room ──────
    const signBoards: THREE.Mesh[] = [];
    const boardMat = new THREE.MeshStandardMaterial({ color: "#2a2c31", roughness: 0.7 });
    for (const region of worldMap.regions) {
      for (const room of region.rooms) {
        const labelTex = makeLabelTexture(room.channelName, room.hasVoice);
        const img = labelTex.image as HTMLCanvasElement;
        const aspect = img.width / img.height;
        const boardH = 0.42;
        const boardW = Math.min(room.width - 1.2, boardH * aspect);
        // dead center of the room, floating just above the wall top so the
        // plaques of other rooms stay visible over the walls
        const cx = room.x + room.width / 2;
        const cz = room.y + room.height / 2;
        const cy = WALL_H + boardH * 0.75;

        const faceMat = new THREE.MeshBasicMaterial({ map: labelTex, transparent: true });
        const board = new THREE.Mesh(
          new THREE.BoxGeometry(boardW, boardH, 0.06),
          [boardMat, boardMat, boardMat, boardMat, faceMat, faceMat],
        );
        board.position.set(cx, cy, cz);
        scene.add(board);
        // store for per-frame facing
        signBoards.push(board);
      }
    }

    // ── Character setup ──────────────────────────────────────────────────
    const remoteChars = new Map<string, Character>();
    let localChar: Character;

    const sheet = new THREE.TextureLoader().load("/spritesheet.png", () => {
      // image is ready — refresh every character's cloned texture
      localChar.tex.needsUpdate = true;
      for (const ch of remoteChars.values()) ch.tex.needsUpdate = true;
    });
    sheet.colorSpace = THREE.SRGBColorSpace;
    sheet.magFilter = THREE.NearestFilter;
    sheet.minFilter = THREE.NearestFilter;

    localChar = new Character(sheet, user.global_name ?? user.username, true);
    localChar.root.visible = false; // first person: hide our own avatar
    scene.add(localChar.root);

    // ── Position (restore from storage) ──────────────────────────────────
    const POS_KEY = `discworld:pos:${guildId}`;
    const pos = { x: worldMap.spawnPoint.x + 0.5, z: worldMap.spawnPoint.y + 0.5 };
    try {
      const saved = JSON.parse(localStorage.getItem(POS_KEY) ?? "null");
      if (saved && typeof saved.x === "number" && typeof saved.y === "number") {
        const t = worldMap.tiles[Math.floor(saved.y)]?.[Math.floor(saved.x)];
        if (t?.passable) { pos.x = saved.x; pos.z = saved.y; }
      }
    } catch { /* ignore */ }

    let facing: Direction = "down";
    let camYaw = 0;            // look yaw (0 = +Z / "south")
    let camPitch = 0;          // look pitch (0 = level, + up, − down)
    const PITCH_MIN = -1.2, PITCH_MAX = 1.2;
    const EYE_H = 1.55;        // eye height for first person

    function passable(wx: number, wz: number): boolean {
      const t = worldMap.tiles[Math.floor(wz)]?.[Math.floor(wx)];
      return !!t?.passable;
    }
    // Collision for the player treated as a small disc of radius R: a position
    // is free only if all four edge samples land on passable tiles. This lets
    // the player slide along walls instead of snagging on a single point.
    const R = 0.28;
    function freeAt(wx: number, wz: number): boolean {
      return (
        passable(wx - R, wz) && passable(wx + R, wz) &&
        passable(wx, wz - R) && passable(wx, wz + R)
      );
    }

    // ── Resize ───────────────────────────────────────────────────────────
    function resize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }
    window.addEventListener("resize", resize);

    // ── First-person mouse look via Pointer Lock ─────────────────────────
    // Click locks the cursor and the mouse drives the camera directly. The
    // RIGHT mouse button toggles the lock off/on, so you can free the cursor
    // to use the UI (voice panel, server switcher) and re-lock to play.
    const SENS = 0.0022; // rad per pixel
    const canvasEl = renderer.domElement;

    function lockPointer() {
      if (document.pointerLockElement !== canvasEl) canvasEl.requestPointerLock();
    }
    function onCanvasDown(e: MouseEvent) {
      if (e.button === 2) {
        // right button: toggle the lock
        if (document.pointerLockElement === canvasEl) document.exitPointerLock();
        else lockPointer();
        return;
      }
      // left button: (re)acquire lock if free
      if (document.pointerLockElement !== canvasEl) lockPointer();
    }
    function onMove(e: MouseEvent) {
      if (document.pointerLockElement !== canvasEl) return; // only while locked
      camYaw   -= e.movementX * SENS;
      camPitch -= e.movementY * SENS;
      camPitch  = Math.max(PITCH_MIN, Math.min(PITCH_MAX, camPitch));
    }
    function onContext(e: Event) { e.preventDefault(); } // no right-click menu
    function onWheel(e: WheelEvent) { e.preventDefault(); }

    canvasEl.addEventListener("mousedown", onCanvasDown);
    document.addEventListener("mousemove", onMove);
    canvasEl.addEventListener("wheel", onWheel, { passive: false });
    canvasEl.addEventListener("contextmenu", onContext);
    canvasEl.style.cursor = "pointer";

    // ── Sounds: door SFX pools, looping footsteps, looping city ambience ─
    const openSfx  = new SoundPool("/sounds/door-open.mp3", 4, 0.9);
    const closeSfx = new SoundPool("/sounds/door-close.mp3", 4, 0.9);
    const footsteps = new LoopSound("/sounds/footsteps.mp3", 0.55);
    const city = new LoopSound("/sounds/city.mp3", 0.0);
    city.start(); // ambience always on; volume set per-frame by position

    // distance from the house center, used to scale city loudness
    const houseCX = worldMap.width / 2, houseCZ = worldMap.height / 2;
    const maxR = Math.hypot(worldMap.width / 2, worldMap.height / 2);

    // ── Main loop ────────────────────────────────────────────────────────
    let raf = 0;
    let last = performance.now();
    let lastEmit = 0, lastSave = 0;
    let prevX = pos.x, prevZ = pos.z; // for footstep detection

    const camTarget = new THREE.Vector3();

    function loop(now: number) {
      if (contextLost) return; // GL context gone — stop rendering
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const keys = keysRef.current;

      // movement relative to camera yaw
      let ix = 0, iz = 0;
      if (keys.has("w") || keys.has("arrowup"))    iz -= 1;
      if (keys.has("s") || keys.has("arrowdown"))  iz += 1;
      if (keys.has("a") || keys.has("arrowleft"))  ix -= 1;
      if (keys.has("d") || keys.has("arrowright")) ix += 1;

      const moving = ix !== 0 || iz !== 0;
      if (moving) {
        const len = Math.hypot(ix, iz);
        ix /= len; iz /= len;
        // forward = look direction (W), strafe = its right-hand perpendicular
        const fX = Math.sin(camYaw), fZ = Math.cos(camYaw);
        const sX = -Math.cos(camYaw), sZ = Math.sin(camYaw);
        // iz: -1 = forward (W); ix: +1 = right (D)
        const wx = -iz * fX + ix * sX;
        const wz = -iz * fZ + ix * sZ;
        const step = SPEED * dt;
        const nx = pos.x + wx * step;
        const nz = pos.z + wz * step;
        // axis-separated collision with a body radius → smooth wall sliding
        if (freeAt(nx, pos.z)) pos.x = nx;
        if (freeAt(pos.x, nz)) pos.z = nz;

        // facing for the (hidden-for-self) sprite, used by remote players
        if (Math.abs(iz) >= Math.abs(ix)) facing = iz < 0 ? "up" : "down";
        else facing = ix < 0 ? "left" : "right";

        const t = now;
        if (t - lastEmit > 60) {
          moveRef.current({ x: pos.x, y: pos.z });
          lastEmit = t;
        }
        if (t - lastSave > 300) {
          try { localStorage.setItem(POS_KEY, JSON.stringify({ x: pos.x, y: pos.z })); } catch {}
          lastSave = t;
        }
      }

      // place + animate local character
      localChar.root.position.set(pos.x, 0, pos.z);
      localChar.update(dt, moving, facing, camera);

      // footsteps: only while actually displacing (not when pushed into a wall)
      const moved = Math.hypot(pos.x - prevX, pos.z - prevZ) > 0.001;
      if (moved) footsteps.start(); else footsteps.stop();
      prevX = pos.x; prevZ = pos.z;

      // city ambience: louder near the outer walls, softer (but audible) at center
      const distC = Math.hypot(pos.x - houseCX, pos.z - houseCZ);
      const tC = Math.min(1, distC / maxR);          // 0 center → 1 edge
      city.setVolume(0.18 + tC * 0.42);              // 0.18..0.60

      // ── auto-open doors near the player, swinging the way you're going ──
      const OPEN_DIST = 2.2;     // tiles
      const CLOSE_DELAY = 1800;  // ms to stay open after you walk away
      const sfxThisFrame = new Set<string>(); // dedupe double-door SFX
      for (const door of doorObjs) {
        const dd = Math.hypot(door.cx - pos.x, door.cz - pos.z);
        const near = dd < OPEN_DIST;
        const wasClosing = door.target === 0;
        if (near) {
          // Pick the swing side ONLY when the door is armed (fully closed and
          // you'd left earlier). After it opens it stays on that side — even
          // through closing — until you walk away, it shuts, and you return.
          if (door.armed) {
            const side = door.alongX ? (pos.z - door.cz) : (pos.x - door.cx);
            if (Math.abs(side) > 0.15) {
              door.target = side > 0 ? door.openToNeg : door.openToPos;
              door.armed = false;
            }
          }
          door.closeAt = now + CLOSE_DELAY; // keep it open & reset the timer
        } else {
          if (now >= door.closeAt) door.target = 0; // close after the delay
          // re-arm only once it is fully shut AND you're out of range
          if (Math.abs(door.current) < 0.02) door.armed = true;
        }

        // Fire SFX on the transition (dedupe so a double door plays once).
        const key = `${door.cx},${door.cz}`;
        const nowOpening = door.target !== 0;
        if (wasClosing && nowOpening && !sfxThisFrame.has(key)) {
          openSfx.play(); sfxThisFrame.add(key);
        } else if (!wasClosing && !nowOpening && Math.abs(door.current) > 0.05 && !sfxThisFrame.has(key)) {
          closeSfx.play(); sfxThisFrame.add(key);
        }

        door.current += (door.target - door.current) * (1 - Math.pow(0.0008, dt));
        door.pivot.rotation.y = door.current;
      }

      // ── first-person camera: at the eyes, looking along yaw/pitch ─────
      const fwdX = Math.sin(camYaw) * Math.cos(camPitch);
      const fwdY = Math.sin(camPitch);
      const fwdZ = Math.cos(camYaw) * Math.cos(camPitch);
      camera.position.set(pos.x, EYE_H, pos.z);
      camTarget.set(pos.x + fwdX, EYE_H + fwdY, pos.z + fwdZ);
      camera.lookAt(camTarget);

      // sun shadow frustum follows the player so shadows stay sharp anywhere
      sun.position.set(pos.x + 40, 60, pos.z + 25);
      sun.target.position.set(pos.x, 0, pos.z);
      sun.target.updateMatrixWorld();

      // drift clouds slowly across the sky
      clouds.position.x += dt * 1.5;
      if (clouds.position.x > 180) clouds.position.x -= 360;

      // channel plaques yaw to face the camera so the name is always readable
      for (const b of signBoards) {
        b.rotation.y = Math.atan2(camera.position.x - b.position.x, camera.position.z - b.position.z);
      }

      // ── sync remote players ──────────────────────────────────────────
      const ps = playersRef.current;
      const localId = userRef.current?.id;
      const seen = new Set<string>();
      for (const p of Object.values(ps)) {
        if (p.discordId === localId) continue;
        seen.add(p.id);
        let ch = remoteChars.get(p.id);
        if (!ch) {
          ch = new Character(sheet, p.username, false);
          remoteChars.set(p.id, ch);
          scene.add(ch.root);
        }
        ch.root.position.set(p.position.x, 0, p.position.y);
        ch.update(dt, false, "down", camera);
      }
      for (const [id, ch] of remoteChars) {
        if (!seen.has(id)) {
          scene.remove(ch.root);
          remoteChars.delete(id);
        }
      }

      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    // ── Cleanup ──────────────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(raf);
      footsteps.stop();
      city.stop();
      window.removeEventListener("resize", resize);
      canvasEl.removeEventListener("mousedown", onCanvasDown);
      document.removeEventListener("mousemove", onMove);
      canvasEl.removeEventListener("wheel", onWheel);
      canvasEl.removeEventListener("contextmenu", onContext);
      renderer.domElement.removeEventListener("webglcontextlost", onCtxLost);
      if (document.pointerLockElement === canvasEl) document.exitPointerLock();
      try { localStorage.setItem(POS_KEY, JSON.stringify({ x: pos.x, y: pos.z })); } catch {}

      // Free all GPU resources, then drop the WebGL context. Without this every
      // re-mount leaks a context; browsers cap them (~16) and start crashing.
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = (mesh as any).material;
        if (mat) {
          const mats = Array.isArray(mat) ? mat : [mat];
          for (const m of mats) {
            for (const key of Object.keys(m)) {
              const v = (m as any)[key];
              if (v && v.isTexture) v.dispose();
            }
            m.dispose?.();
          }
        }
      });
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
    // Depend only on STABLE primitives so the heavy 3D scene is built once per
    // guild — not rebuilt whenever `map`/`user` get a new object reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map?.guildId, user?.id, guildId]);

  const activeVoiceRoom = map?.regions
    .flatMap((r) => r.rooms)
    .find((r) => r.id === currentRoomId && r.hasVoice);

  if (userLoading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <p>Carregando usuário…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className={styles.loading}>
        <p>Não autenticado.</p>
        <a href={`${process.env.NEXT_PUBLIC_SERVER_URL}/auth/login`} style={{ color: "#5865f2", marginTop: 12 }}>
          Entrar com Discord
        </a>
      </div>
    );
  }

  if (!map) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <p>Carregando mapa do servidor…</p>
      </div>
    );
  }

  async function requestMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicPermission("granted");
    } catch {
      setMicPermission("denied");
    }
  }

  return (
    <div className={styles.container}>
      <div ref={mountRef} className={styles.canvas} style={{ width: "100vw", height: "100vh" }} />
      {/* first-person crosshair */}
      <div className={styles.crosshair} />
      <ServerSwitcher currentGuildId={guildId} />
      {micPermission === "pending" && (
        <div className={styles.micHud}>
          <div className={styles.micCard}>
            <div className={styles.micIcon}>🎙️</div>
            <h2>PERMISSÃO DE MIC</h2>
            <p>Para falar nas salas de voz permita o acesso ao microfone.</p>
            <button className={styles.micPrimaryBtn} onClick={requestMic}>
              ▶ PERMITIR
            </button>
            <button className={styles.micSkipBtn} onClick={() => setMicPermission("denied")}>
              jogar sem voz
            </button>
          </div>
        </div>
      )}
      {activeVoiceRoom && user && micPermission !== "pending" && (
        <VoiceRoom
          roomId={activeVoiceRoom.id}
          identity={user.id}
          name={user.global_name ?? user.username}
          players={players}
          localPosition={localPosition}
          micGranted={micPermission === "granted"}
        />
      )}
    </div>
  );
}
