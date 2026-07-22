export type Role = 'admin' | 'staff';

export interface User {
  id: string;
  name: string;
  emoji: string;
  color: string;
  role: Role;
}

export interface Team {
  id: string;
  name: string;
  emoji: string;
}

export type ChannelType =
  | 'chat'
  | 'schedule'
  | 'board'
  | 'notes'
  | 'catalog' // structured, sortable reference table (bean library)
  | 'orders' // paste-an-order → roast → deliver workflow
  | 'dm'; // private thread between 2+ people, outside any team

export interface BoardList {
  id: string;
  title: string;
  emoji: string;
}

export interface Channel {
  id: string;
  teamId: string;
  name: string;
  emoji: string;
  type: ChannelType;
  description: string;
  lists?: BoardList[];
  isHome?: boolean; // the team's main feed channel (shows cross-channel activity)
  memberIds?: string[]; // dm threads: the 2+ participants
}

export interface Message {
  id: string;
  channelId: string;
  userId: string;
  text: string;
  ts: number;
  pinned?: boolean;
  edited?: boolean;
  reactions?: Record<string, string[]>; // emoji -> userIds who reacted
}

export interface ShiftSignup {
  id: string;
  channelId: string;
  date: string; // YYYY-MM-DD
  userId: string;
  note: string;
}

export interface ListItem {
  id: string;
  channelId: string;
  listId: string;
  text: string;
  addedBy: string;
  done: boolean;
  ts: number;
}

export interface CatalogItem {
  id: string;
  channelId: string;
  name: string;
  origin: string;
  roast: string;
  flavor: string;
  certs: string;
  notes: string;
  updatedBy: string;
  updatedAt: number;
}

export type OrderStage = 'roast' | 'ready' | 'delivered';

export interface OrderItem {
  id: string;
  text: string;
  done: boolean;
}

export interface Order {
  id: string;
  channelId: string;
  title: string; // the pasted heading, e.g. "Bestway Grocery"
  items: OrderItem[];
  stage: OrderStage;
  createdBy: string;
  ts: number;
  deliveredBy?: string;
  deliveredAt?: number;
}

// Per-user status of an item in the Mentions inbox.
export interface MentionMeta {
  read?: boolean;
  archived?: boolean;
  deleted?: boolean;
}

export interface Note {
  id: string;
  channelId: string;
  title: string;
  body: string; // markdown
  updatedBy: string;
  updatedAt: number;
}

export interface HoursEntry {
  id: string;
  userId: string;
  teamId: string;
  date: string; // YYYY-MM-DD
  hours: number;
  note: string;
}

export interface State {
  version: number;
  onboarded: boolean;
  currentUserId: string;
  currentTeamId: string;
  users: User[];
  teams: Team[];
  channels: Channel[];
  messages: Message[];
  signups: ShiftSignup[];
  listItems: ListItem[];
  notes: Note[];
  catalogItems: CatalogItem[];
  orders: Order[];
  hoursEntries: HoursEntry[];
  mentionMeta: Record<string, Record<string, MentionMeta>>; // userId -> messageId -> meta
  threadReadAt: Record<string, Record<string, number>>; // userId -> dm channelId -> last-read ts
  mentionsSeenAt: Record<string, number>; // userId -> last time they opened Mentions
  favorites?: Record<string, string[]>; // userId -> pinned channel ids (quick-access tiles)
}
