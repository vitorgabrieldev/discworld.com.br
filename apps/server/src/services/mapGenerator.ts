import type { GuildStructure, WorldMap, Region, Room, Tile, BiomeType, Prop } from "@repo/shared";

const TILE_SIZE = 32;
const GARDEN    = 10; // grass border (in tiles) around the whole house

// ── Seeded RNG (mulberry32) ────────────────────────────────────────────────
function makeSeed(guildId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < guildId.length; i++) {
    h ^= guildId.charCodeAt(i);
    h = (Math.imul(h, 0x01000193) >>> 0);
  }
  return h >>> 0;
}

function makeRng(seed: number) {
  let s = seed;
  return () => {
    s |= 0; s = s + 0x6d2b79f5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const BIOMES: BiomeType[] = ["plains", "forest", "cave", "desert", "snow", "volcano", "ocean"];

// ── BSP leaf: an axis-aligned interior rectangle (in tile coords) ──────────
interface Leaf {
  x: number; y: number; w: number; h: number; // INTERIOR footprint incl. its walls
  channel?: ChannelInfo;
  catId?: string;
  biome?: BiomeType;
}

interface ChannelInfo {
  id: string;
  name: string;
  type: number; // 0 text, 2 voice
  catId: string;
  catName: string;
  biome: BiomeType;
  members: number;
}

// ── Main export ────────────────────────────────────────────────────────────
export function generateWorldMap(structure: GuildStructure): WorldMap {
  const { guild, categories, channels } = structure;

  const seed = makeSeed(guild.id);
  const rng  = makeRng(seed);

  // Flatten channels into a single ordered list, tagged with their category.
  const cats = categories
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((cat, idx) => ({
      id: cat.id,
      name: cat.name,
      biome: BIOMES[idx % BIOMES.length]!,
      channels: channels
        .filter((ch) => ch.parent_id === cat.id)
        .sort((a, b) => a.position - b.position),
    }))
    .filter((c) => c.channels.length > 0);

  const uncategorized = channels.filter((ch) => !ch.parent_id);
  if (uncategorized.length > 0) {
    cats.unshift({ id: "lobby", name: "Lobby", biome: "plains", channels: uncategorized });
  }

  const channelList: ChannelInfo[] = [];
  for (const cat of cats) {
    for (const ch of cat.channels) {
      channelList.push({
        id: ch.id,
        name: ch.name,
        type: ch.type,
        catId: cat.id,
        catName: cat.name,
        biome: cat.biome,
        members: (ch as any).member_count ?? 0,
      });
    }
  }
  // Always have at least one room so the house is never empty.
  if (channelList.length === 0) {
    channelList.push({
      id: "general", name: "geral", type: 0,
      catId: "lobby", catName: "Lobby", biome: "plains", members: 0,
    });
  }

  const roomCount = channelList.length;

  // ── Size the house ─────────────────────────────────────────────────────
  // Aim for square-ish rooms ~9 tiles. House grows with the number of rooms.
  const AVG_ROOM = 9;
  const cols = Math.ceil(Math.sqrt(roomCount));
  const interiorW = Math.max(14, cols * AVG_ROOM);
  const interiorH = Math.max(14, Math.ceil(roomCount / cols) * AVG_ROOM);

  // The house interior starts at (GARDEN, GARDEN); grass surrounds it.
  const HX = GARDEN, HY = GARDEN;
  const HW = interiorW, HH = interiorH;

  const totalW = HX + HW + GARDEN;
  const totalH = HY + HH + GARDEN;

  // ── Tile grid (all grass first, then carve the house) ──────────────────
  const grid: Tile[][] = Array.from({ length: totalH }, (_, y) =>
    Array.from({ length: totalW }, (_, x) => ({
      x, y, type: "grass" as const, passable: false, biome: "plains" as BiomeType,
    }))
  );

  const setTile = (x: number, y: number, type: Tile["type"], biome: BiomeType, passable: boolean) => {
    if (x >= 0 && x < totalW && y >= 0 && y < totalH) {
      grid[y]![x] = { x, y, type, passable, biome };
    }
  };

  // ── BSP partition the interior into `roomCount` leaves ─────────────────
  // Each leaf is a rectangle; the split line becomes a shared wall.
  const root: Leaf = { x: HX, y: HY, w: HW, h: HH };
  const leaves: Leaf[] = [root];
  const MIN_LEAF = 7; // min leaf size including its walls

  // Split the largest leaf repeatedly until we have enough rooms.
  while (leaves.length < roomCount) {
    // pick the largest splittable leaf
    leaves.sort((a, b) => b.w * b.h - a.w * a.h);
    const leaf = leaves.find((l) => l.w >= MIN_LEAF * 2 || l.h >= MIN_LEAF * 2);
    if (!leaf) break; // can't split further

    const idx = leaves.indexOf(leaf);
    const canH = leaf.w >= MIN_LEAF * 2; // split vertically (left/right)
    const canV = leaf.h >= MIN_LEAF * 2; // split horizontally (top/bottom)

    // prefer splitting the longer axis for square-ish rooms
    let splitVertical: boolean;
    if (canH && canV) splitVertical = leaf.w >= leaf.h;
    else splitVertical = canH;

    let a: Leaf, b: Leaf;
    if (splitVertical) {
      const min = MIN_LEAF, max = leaf.w - MIN_LEAF;
      const cut = min + Math.floor(rng() * (max - min + 1));
      // shared wall column at leaf.x + cut. Both leaves include that wall.
      a = { x: leaf.x, y: leaf.y, w: cut + 1, h: leaf.h };
      b = { x: leaf.x + cut, y: leaf.y, w: leaf.w - cut, h: leaf.h };
    } else {
      const min = MIN_LEAF, max = leaf.h - MIN_LEAF;
      const cut = min + Math.floor(rng() * (max - min + 1));
      a = { x: leaf.x, y: leaf.y, w: leaf.w, h: cut + 1 };
      b = { x: leaf.x, y: leaf.y + cut, w: leaf.w, h: leaf.h - cut };
    }
    leaves.splice(idx, 1, a, b);
  }

  // Assign channels to leaves (sorted by position for stable layout).
  leaves.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  leaves.forEach((leaf, i) => {
    const ch = channelList[i % channelList.length]!;
    leaf.channel = ch;
    leaf.catId = ch.catId;
    leaf.biome = ch.biome;
  });

  // ── Paint floors + walls for every leaf ─────────────────────────────────
  // For each leaf: fill interior with floor, draw walls on its 4 edges.
  // Shared edges are drawn by both leaves (same wall tile) — that's fine.
  for (const leaf of leaves) {
    const biome = leaf.biome ?? "plains";
    for (let y = leaf.y; y < leaf.y + leaf.h; y++) {
      for (let x = leaf.x; x < leaf.x + leaf.w; x++) {
        const edge = x === leaf.x || x === leaf.x + leaf.w - 1 ||
                     y === leaf.y || y === leaf.y + leaf.h - 1;
        if (edge) setTile(x, y, "wall", biome, false);
        else      setTile(x, y, "floor", biome, true);
      }
    }
  }

  // ── Build a room adjacency graph and connect with doors ────────────────
  // Two leaves are adjacent if they share a wall segment of length >= 3.
  // We carve exactly one door (1 tile) in each connection, and ensure the
  // whole house is connected (spanning tree) so every room is reachable.
  interface Edge { a: number; b: number; door: DoorSpan; }
  const edges: Edge[] = [];

  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      const A = leaves[i]!, B = leaves[j]!;
      // Vertical shared wall: A right edge == B left edge (or vice versa)
      const door = sharedDoor(A, B, rng);
      if (door) edges.push({ a: i, b: j, door });
    }
  }

  // Spanning tree (union-find) so the house is fully connected, then add a
  // few extra doors for loops/flow.
  const parent = leaves.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
  const union = (x: number, y: number) => { parent[find(x)] = find(y); };

  // shuffle edges deterministically
  const shuffled = edges.slice().sort(() => rng() - 0.5);
  const usedDoors: Array<{ door: DoorSpan; biome: BiomeType }> = [];

  for (const e of shuffled) {
    if (find(e.a) !== find(e.b)) {
      union(e.a, e.b);
      usedDoors.push({ door: e.door, biome: leaves[e.a]!.biome ?? "plains" });
    }
  }
  // extra ~45% doors for nicer circulation
  const extra = Math.floor(shuffled.length * 0.45);
  let added = 0;
  for (const e of shuffled) {
    if (added >= extra) break;
    const already = usedDoors.some((d) => d.door.x === e.door.x && d.door.y === e.door.y);
    if (!already) { usedDoors.push({ door: e.door, biome: leaves[e.a]!.biome ?? "plains" }); added++; }
  }

  // Carve the doors (passable, type "door"), spanning their full width.
  for (const { door, biome } of usedDoors) {
    for (let i = 0; i < door.width; i++) {
      setTile(door.x + door.dx * i, door.y + door.dy * i, "door", biome, true);
    }
  }

  // ── Front door: a closed door on the perimeter is NOT created — the house
  // has no exit to the garden by design. (Perimeter stays solid wall.)

  // ── Rooms & regions metadata ────────────────────────────────────────────
  const rooms: Room[] = leaves.map((leaf) => {
    const ch = leaf.channel!;
    const isVoice = ch.type === 2;
    return {
      id: ch.id,
      channelId: ch.id,
      channelName: ch.name,
      channelType: isVoice ? "voice" : "text",
      x: leaf.x, y: leaf.y, width: leaf.w, height: leaf.h,
      biome: leaf.biome ?? "plains",
      color: isVoice ? "#2a5298" : "#4a4a4a",
      hasVoice: isVoice,
      requiredRoles: [],
      memberCount: ch.members,
      doors: [],
    };
  });

  const regionMap = new Map<string, Region>();
  for (const leaf of leaves) {
    const ch = leaf.channel!;
    let region = regionMap.get(ch.catId);
    if (!region) {
      region = {
        id: ch.catId, categoryId: ch.catId, categoryName: ch.catName,
        biome: ch.biome, color: "#000",
        x: leaf.x, y: leaf.y, width: leaf.w, height: leaf.h, rooms: [],
      };
      regionMap.set(ch.catId, region);
    }
    // expand bounding box
    const rx2 = Math.max(region.x + region.width, leaf.x + leaf.w);
    const ry2 = Math.max(region.y + region.height, leaf.y + leaf.h);
    region.x = Math.min(region.x, leaf.x);
    region.y = Math.min(region.y, leaf.y);
    region.width = rx2 - region.x;
    region.height = ry2 - region.y;
    region.rooms.push(rooms.find((r) => r.id === ch.id)!);
  }
  const regions = [...regionMap.values()];

  // ── Garden props (deterministic, rule-based) ────────────────────────────
  const props = generateGardenProps({
    rng, totalW, totalH,
    houseMinX: HX, houseMinY: HY, houseMaxX: HX + HW - 1, houseMaxY: HY + HH - 1,
    isGrass: (x, y) => grid[y]?.[x]?.type === "grass",
  });

  // ── Spawn inside the first room ─────────────────────────────────────────
  const first = leaves[0]!;
  const spawnX = first.x + Math.floor(first.w / 2);
  const spawnY = first.y + Math.floor(first.h / 2);

  return {
    guildId: guild.id,
    guildName: guild.name,
    width: totalW,
    height: totalH,
    tileSize: TILE_SIZE,
    regions,
    tiles: grid,
    props,
    spawnPoint: { x: spawnX, y: spawnY },
  };
}

// Door opening on the shared wall between two leaves. Returns the start tile
// plus a direction along the wall and a width (2 tiles when there's room, for
// a wide / double door; falls back to 1 tile in tight spots).
interface DoorSpan { x: number; y: number; dx: number; dy: number; width: number; }

// Keep doors off the wall ends: never place one on the first/last block of a
// shared wall (the corners). For a 5-block wall (blocks 1..5) doors only land
// on 2,3,4.
const DOOR_EDGE = 1; // blocks of margin kept clear at each end

// Given a shared wall spanning the overlap [lo..hi] (inclusive, in tile coords
// along the wall), return a valid door start within the interior, or null.
function pickDoorPos(lo: number, hi: number, rng: () => number): { pos: number; width: number } | null {
  // interior excludes DOOR_EDGE blocks at each corner
  const iLo = lo + DOOR_EDGE;
  const iHi = hi - DOOR_EDGE;
  const interior = iHi - iLo + 1; // number of usable blocks
  if (interior < 1) return null;
  const width = interior >= 2 ? 2 : 1; // double door when there's room
  const slots = interior - width + 1;  // possible start positions
  const pos = iLo + Math.floor(rng() * slots);
  return { pos, width };
}

function sharedDoor(A: Leaf, B: Leaf, rng: () => number): DoorSpan | null {
  const aRight = A.x + A.w - 1;
  const bLeft  = B.x;
  const aLeft  = A.x;
  const bRight = B.x + B.w - 1;

  // Vertical shared wall (door spans along Y, opening faces E-W)
  const vertical = (col: number): DoorSpan | null => {
    const lo = Math.max(A.y, B.y);              // top corner of the shared wall
    const hi = Math.min(A.y + A.h, B.y + B.h) - 1; // bottom corner (inclusive)
    const r = pickDoorPos(lo, hi, rng);
    if (!r) return null;
    return { x: col, y: r.pos, dx: 0, dy: 1, width: r.width };
  };
  if (aRight === bLeft) { const d = vertical(aRight); if (d) return d; }
  if (bRight === aLeft) { const d = vertical(aLeft);  if (d) return d; }

  // Horizontal shared wall (door spans along X, opening faces N-S)
  const aBottom = A.y + A.h - 1;
  const bTop    = B.y;
  const aTop    = A.y;
  const bBottom = B.y + B.h - 1;
  const horizontal = (row: number): DoorSpan | null => {
    const lo = Math.max(A.x, B.x);
    const hi = Math.min(A.x + A.w, B.x + B.w) - 1;
    const r = pickDoorPos(lo, hi, rng);
    if (!r) return null;
    return { x: r.pos, y: row, dx: 1, dy: 0, width: r.width };
  };
  if (aBottom === bTop) { const d = horizontal(aBottom); if (d) return d; }
  if (bBottom === aTop) { const d = horizontal(aTop);    if (d) return d; }

  return null;
}

// ── Garden prop generator (deterministic, rule-based) ──────────────────────
interface GardenCtx {
  rng: () => number;
  totalW: number; totalH: number;
  houseMinX: number; houseMinY: number; houseMaxX: number; houseMaxY: number;
  isGrass: (x: number, y: number) => boolean;
}

function generateGardenProps(ctx: GardenCtx): Prop[] {
  const { rng, totalW, totalH, houseMinX, houseMinY, houseMaxX, houseMaxY, isGrass } = ctx;
  const props: Prop[] = [];
  const trees: Array<{ x: number; y: number }> = [];

  const TREE_MIN_DIST = 3.0;
  const yardArea = totalW * totalH;

  const inYard = (x: number, y: number) =>
    isGrass(Math.round(x), Math.round(y)) &&
    !(x > houseMinX - 0.5 && x < houseMaxX + 0.5 && y > houseMinY - 0.5 && y < houseMaxY + 0.5);

  const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

  const nearHouse = (x: number, y: number) => {
    const dx = Math.max(houseMinX - x, x - houseMaxX, 0);
    const dy = Math.max(houseMinY - y, y - houseMaxY, 0);
    return Math.hypot(dx, dy) <= 2.2;
  };

  // TREES — scattered, never adjacent
  const treeTarget = Math.min(40, Math.max(8, Math.floor(yardArea / 90)));
  let attempts = 0;
  while (trees.length < treeTarget && attempts < treeTarget * 30) {
    attempts++;
    const x = 0.5 + Math.floor(rng() * totalW);
    const y = 0.5 + Math.floor(rng() * totalH);
    if (!inYard(x, y)) continue;
    if (trees.some((t) => dist(t.x, t.y, x, y) < TREE_MIN_DIST)) continue;
    trees.push({ x, y });
    props.push({ type: "tree", x, y, variant: Math.floor(rng() * 3) });
  }

  // BUSHES — clustered
  const bushClusters = Math.max(3, Math.floor(trees.length / 3));
  for (let c = 0; c < bushClusters; c++) {
    let sx = 0, sy = 0, ok = false;
    for (let k = 0; k < 20 && !ok; k++) {
      sx = 0.5 + Math.floor(rng() * totalW);
      sy = 0.5 + Math.floor(rng() * totalH);
      ok = inYard(sx, sy) && !trees.some((t) => dist(t.x, t.y, sx, sy) < 1.5);
    }
    if (!ok) continue;
    const count = 2 + Math.floor(rng() * 4);
    for (let b = 0; b < count; b++) {
      const bx = sx + (rng() - 0.5) * 2.4;
      const by = sy + (rng() - 0.5) * 2.4;
      if (inYard(bx, by)) props.push({ type: "bush", x: bx, y: by, variant: Math.floor(rng() * 3) });
    }
  }

  // DOGHOUSE — next to a tree, or against the house
  let dogPlaced = false;
  const shuffledTrees = trees.slice().sort(() => rng() - 0.5);
  for (const t of shuffledTrees) {
    const cands = [
      { x: t.x + 1.4, y: t.y }, { x: t.x - 1.4, y: t.y },
      { x: t.x, y: t.y + 1.4 }, { x: t.x, y: t.y - 1.4 },
    ];
    for (const c of cands) {
      if (inYard(c.x, c.y)) { props.push({ type: "doghouse", x: c.x, y: c.y, variant: 0 }); dogPlaced = true; break; }
    }
    if (dogPlaced) break;
  }
  if (!dogPlaced) {
    for (let k = 0; k < 40 && !dogPlaced; k++) {
      const x = 0.5 + Math.floor(rng() * totalW);
      const y = 0.5 + Math.floor(rng() * totalH);
      if (inYard(x, y) && nearHouse(x, y)) { props.push({ type: "doghouse", x, y, variant: 0 }); dogPlaced = true; }
    }
  }

  // BALL
  for (let i = 0; i < 2; i++) {
    for (let k = 0; k < 20; k++) {
      const x = 0.5 + Math.floor(rng() * totalW);
      const y = 0.5 + Math.floor(rng() * totalH);
      if (inYard(x, y)) { props.push({ type: "ball", x, y, variant: Math.floor(rng() * 2) }); break; }
    }
  }

  // FLOWERS
  const flowerTarget = Math.floor(trees.length * 1.5);
  for (let i = 0; i < flowerTarget; i++) {
    for (let k = 0; k < 8; k++) {
      const x = 0.5 + Math.floor(rng() * totalW);
      const y = 0.5 + Math.floor(rng() * totalH);
      if (inYard(x, y)) { props.push({ type: "flower", x, y, variant: Math.floor(rng() * 4) }); break; }
    }
  }

  return props;
}
