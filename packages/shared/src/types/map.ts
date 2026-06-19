export type TileType = "floor" | "wall" | "void" | "door" | "corridor" | "water" | "grass" | "stone";
export type BiomeType = "forest" | "cave" | "desert" | "snow" | "ocean" | "plains" | "volcano";

export interface Tile {
  x: number;
  y: number;
  type: TileType;
  passable: boolean;
  biome: BiomeType;
}

export interface Room {
  id: string;
  channelId: string;
  channelName: string;
  channelType: "text" | "voice";
  x: number;
  y: number;
  width: number;
  height: number;
  biome: BiomeType;
  color: string;
  hasVoice: boolean;
  requiredRoles: string[];
  memberCount: number;
  // door positions for corridor connections
  doors: Array<{ x: number; y: number; dir: "north" | "south" | "east" | "west" }>;
}

export interface Region {
  id: string;
  categoryId: string;
  categoryName: string;
  biome: BiomeType;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rooms: Room[];
}

// Decorative outdoor garden objects placed around the house.
export type PropType = "tree" | "bush" | "ball" | "doghouse" | "flower";

export interface Prop {
  type: PropType;
  x: number;       // tile coordinates (can be fractional)
  y: number;
  variant: number; // 0..n, lets the renderer vary appearance deterministically
}

export interface WorldMap {
  guildId: string;
  guildName: string;
  width: number;
  height: number;
  tileSize: number;
  regions: Region[];
  tiles: Tile[][];
  props: Prop[];
  spawnPoint: { x: number; y: number };
}
