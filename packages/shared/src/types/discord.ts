export interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  avatar: string | null;
  global_name: string | null;
}

export interface DiscordGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
}

export interface DiscordChannel {
  id: string;
  type: DiscordChannelType;
  name: string;
  parent_id: string | null;
  position: number;
  user_limit?: number;
}

export interface DiscordCategory {
  id: string;
  name: string;
  position: number;
}

export interface DiscordRole {
  id: string;
  name: string;
  color: number;
  position: number;
  permissions: string;
}

export interface GuildStructure {
  guild: DiscordGuild;
  categories: DiscordCategory[];
  channels: DiscordChannel[];
  roles: DiscordRole[];
}

export enum DiscordChannelType {
  TEXT = 0,
  VOICE = 2,
  CATEGORY = 4,
  STAGE = 13,
  FORUM = 15,
}
