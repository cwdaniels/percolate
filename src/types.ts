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
  // Day of month a pay period opens. 1 = calendar months; 16 = periods
  // running the 16th to the 15th. Absent means 1.
  payPeriodStartDay?: number;
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
  // Where this section's order gets emailed (e.g. a supplier). Optional,
  // per-section so a board can order from more than one place.
  orderEmail?: string;
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
  scheduleCapacity?: ScheduleCapacity; // schedule-type channels only
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
  replyToId?: string;
}

export interface ShiftSignup {
  id: string;
  channelId: string;
  date: string; // YYYY-MM-DD
  userId: string;
  note: string;
  isAlternate?: boolean;
}

// Per-weekday staffing cap on a schedule channel. Keyed by JS day-of-week
// as a string ("0" Sun .. "6" Sat) since object keys are always strings.
// A day absent from the map is unlimited.
export type ScheduleCapacity = Record<string, { max: number; altMax?: number }>;

export interface ListItem {
  id: string;
  channelId: string;
  listId: string;
  text: string;
  addedBy: string;
  done: boolean;
  ts: number;
  dueDate?: string; // YYYY-MM-DD — surfaces on the team's Schedule calendar
  notes?: string;
  assignedTo?: string;
  assignedBy?: string;
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
  sourceUrl: string; // where this bean was bought — clicks straight out to it
  cost?: number;
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
  invoiced?: boolean;
  invoicedBy?: string;
  invoicedAt?: number;
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
  tips: number; // taken home at the end of this shift
  note: string;
}

// Wage history. A raise is a new entry with a later effectiveFrom, never an
// edit to an old one — that's what stops past periods being restated.
export interface WageRate {
  id: string;
  teamId: string;
  userId: string;
  rate: number;
  effectiveFrom: string; // YYYY-MM-DD
}

// A closed pay period. `lines` are the frozen per-person totals, written
// when the period is marked paid.
export interface PayPeriod {
  id: string;
  teamId: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;
  note: string;
  lines: PayPeriodLine[];
}

// Paid state lives on the line, not the period, so one person can be
// settled early without freezing everyone else's timesheet.
export interface PayPeriodLine {
  userId: string;
  hours: number;
  gross: number;
  tips: number;
  paidAt?: number;
  paidBy?: string;
}

// Owner-only notes about a teammate: hire date, raise history, anything
// personal. Never visible to the staff member themselves.
export interface StaffNote {
  userId: string;
  note: string;
  updatedAt: number;
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
  wageRates: WageRate[]; // RLS-scoped: your own, or the team's if you're owner
  payPeriods: PayPeriod[];
  staffNotes: StaffNote[]; // owner-only; empty for staff
  mentionMeta: Record<string, Record<string, MentionMeta>>; // userId -> messageId -> meta
  threadReadAt: Record<string, Record<string, number>>; // userId -> dm channelId -> last-read ts
  mentionsSeenAt: Record<string, number>; // userId -> last time they opened Mentions
  favorites?: Record<string, string[]>; // userId -> pinned channel ids (quick-access tiles)
  channelOrder?: Record<string, string[]>; // userId -> preferred display order of channel ids
}
