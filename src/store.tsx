import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type {
  CatalogItem,
  Channel,
  HoursEntry,
  ListItem,
  MentionMeta,
  Message,
  Note,
  Order,
  OrderStage,
  ShiftSignup,
  State,
  Team,
  User,
} from './types';

// Local, persisted-to-device data layer for the prototype. The Api surface
// below is deliberately shaped like the calls a hosted backend (e.g.
// Supabase) will expose, so swapping in real sync later doesn't touch views.

export const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

export const fmtDate = (d: Date) => {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

export const monthKey = (d: Date) => fmtDate(d).slice(0, 7);

const KEY = 'percolate-v1';
const VERSION = 6;

// Deterministic id for a private thread: everyone computes the same id
// for the same set of people, so a thread is never duplicated.
export const dmIdFor = (ids: string[]) => 'dm:' + [...new Set(ids)].sort().join(':');

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Messages across the current team that @mention a given user (by name)
// or the whole team (@team/@everyone/@all), newest first. Excludes the
// user's own messages. Shared by the Mentions view and the tab badge.
export function mentionsFor(state: State, userId: string): Message[] {
  const user = state.users.find((u) => u.id === userId);
  if (!user) return [];
  const teamChannelIds = new Set(
    state.channels.filter((c) => c.teamId === state.currentTeamId).map((c) => c.id)
  );
  const nameRe = new RegExp(`@${escapeRegex(user.name)}\\b`, 'i');
  const teamRe = /@(team|everyone|all)\b/i;
  return state.messages
    .filter(
      (m) =>
        teamChannelIds.has(m.channelId) &&
        m.userId !== userId &&
        (nameRe.test(m.text) || teamRe.test(m.text))
    )
    .sort((a, b) => b.ts - a.ts);
}

const USER_COLORS = ['#e0a63c', '#7fa86d', '#c96f8e', '#6d9fc9', '#9b7fc9', '#c9836d'];
const USER_EMOJI = ['🌻', '🚴', '🎨', '🦊', '🍩', '⭐️', '🌱', '🫘', '🎸', '🧦'];

// Each profile emoji carries an accent color. Picking your icon retints
// the whole app (buttons, highlights, your avatar) — mid-deep tones so
// light text reads on them in both light and dark mode.
export const EMOJI_ACCENTS: Record<string, string> = {
  '☕️': '#b5562c',
  '🌱': '#4e9c5f',
  '🔥': '#d1552f',
  '🌻': '#c98a1e',
  '🦊': '#c96a2e',
  '🍩': '#c96f8e',
  '🎨': '#8f6fc0',
  '🚴': '#3f9c86',
  '⭐️': '#c99a1e',
  '🫘': '#8a5a3c',
  '🎸': '#7a6cc4',
  '🧦': '#c46f9b',
};

export const accentForEmoji = (emoji: string): string =>
  EMOJI_ACCENTS[emoji] ?? '#b5562c';

function fieldGuideChannel(): Channel {
  return {
    id: 'field-guide',
    teamId: 'fireweed',
    name: 'field guide',
    emoji: '📖',
    type: 'notes',
    description: 'Recipes, profiles & how-tos',
  };
}

function beanLibraryChannel(): Channel {
  return {
    id: 'bean-library',
    teamId: 'fireweed',
    name: 'bean library',
    emoji: '🫘',
    type: 'catalog',
    description: 'Every bean we roast — searchable & sortable',
  };
}

// The roasting hub: every roast job — wholesale orders, pickups, and
// shelf restocks — flows To roast → Ready → Done. (id stays 'wholesale'
// so existing orders/favorites keep pointing here.)
function roastingChannel(): Channel {
  return {
    id: 'wholesale',
    teamId: 'fireweed',
    name: 'roasting',
    emoji: '🔥',
    type: 'orders',
    description: 'Paste a job → roast it → hand it off',
  };
}

function seedCatalogItems(): CatalogItem[] {
  const now = Date.now();
  return [
    { id: uid(), channelId: 'bean-library', name: 'Ethiopia Guji', origin: 'Guji Zone, Ethiopia', roast: 'City (light)', flavor: 'Bright, floral, stone fruit', certs: 'Organic', notes: 'Market favorite — sells out fast', updatedBy: 'quinn', updatedAt: now - 86400000 * 2 },
    { id: uid(), channelId: 'bean-library', name: 'Colombia Huila', origin: 'Huila, Colombia', roast: 'City+ (medium)', flavor: 'Caramel, red apple, cocoa', certs: 'Fair Trade', notes: 'Backbone of Public Universal Blend', updatedBy: 'quinn', updatedAt: now - 86400000 * 5 },
    { id: uid(), channelId: 'bean-library', name: 'Decaf Mexico', origin: 'Chiapas, Mexico', roast: 'Full City (med-dark)', flavor: 'Chocolate, graham cracker', certs: 'Swiss Water, Organic', notes: 'Low stock — reorder soon', updatedBy: 'maya', updatedAt: now - 86400000 },
    { id: uid(), channelId: 'bean-library', name: 'Brazil Cerrado', origin: 'Cerrado Mineiro, Brazil', roast: 'Full City (med-dark)', flavor: 'Nutty, chocolate, low acid', certs: '', notes: 'Espresso base for One Too Many Mornings', updatedBy: 'jonah', updatedAt: now - 86400000 * 8 },
  ];
}

function seedOrders(): Order[] {
  const now = Date.now();
  return [
    {
      id: uid(),
      channelId: 'wholesale',
      title: 'Bestway Grocery',
      stage: 'roast',
      createdBy: 'maya',
      ts: now - 3600000 * 5,
      items: [
        { id: uid(), text: 'Ethiopia Guji — 5 lb', done: true },
        { id: uid(), text: 'One Too Many Mornings — 8 lb', done: true },
        { id: uid(), text: 'Decaf Mexico — 2 lb', done: false },
      ],
    },
    {
      id: uid(),
      channelId: 'wholesale',
      title: 'Sarah P. — pickup Friday',
      stage: 'roast',
      createdBy: 'maya',
      ts: now - 3600000 * 2,
      items: [{ id: uid(), text: 'Ethiopia Guji — 2 lb, whole bean', done: false }],
    },
    {
      id: uid(),
      channelId: 'wholesale',
      title: 'Shelf restock (market Saturday)',
      stage: 'roast',
      createdBy: 'quinn',
      ts: now - 3600000 * 3,
      items: [
        { id: uid(), text: 'Light roast Guji — 12 market bags', done: false },
        { id: uid(), text: 'House blend — 10 bags', done: false },
      ],
    },
    {
      id: uid(),
      channelId: 'wholesale',
      title: 'Corner Blend Café',
      stage: 'ready',
      createdBy: 'jonah',
      ts: now - 86400000,
      items: [
        { id: uid(), text: 'Espresso Blend — 10 lb', done: true },
        { id: uid(), text: 'Decaf Colombia — 5 lb', done: true },
      ],
    },
  ];
}

function seedNotes(): Note[] {
  const now = Date.now();
  return [
    {
      id: uid(),
      channelId: 'field-guide',
      title: 'Roast recipes ☕️',
      body:
        '**One Too Many Mornings (house blend)**\n- Level: Full City (medium-dark)\n- Drop: ~430°F around 14:30\n- Label: *body and smokiness, chocolate finish*\n\n**Public Universal Blend**\n- Level: City+ (medium)\n- Label: *balanced, friendly, fruity notes*\n\n**Ethiopia Guji**\n- Level: City (light)\n- First crack ~8:30, drop 30–45s after\n- Label: *bright, floral, stone fruit*',
      updatedBy: 'quinn',
      updatedAt: now - 86400000 * 3,
    },
    {
      id: uid(),
      channelId: 'field-guide',
      title: 'Labelling cheat sheet 🏷️',
      body:
        'Every bag gets:\n- Blend/origin name\n- Roast date (the day it was roasted, not bagged!)\n- Profile line — copy it from **Roast recipes**\n- Your initials on the bottom seam\n\nMarket bags: add the [website](https://fireweedcoffeeco.com) sticker on the back.',
      updatedBy: 'maya',
      updatedAt: now - 86400000,
    },
    {
      id: uid(),
      channelId: 'wholesale', // the roasting channel's Notes tab
      title: 'Quick roast levels',
      body:
        '- **One Too Many Mornings** → Full City\n- **Public Universal Blend** → City+\n- **Ethiopia Guji** → City (light)\n\nFull recipes live in 📖 *field guide*.',
      updatedBy: 'quinn',
      updatedAt: now - 86400000 * 2,
    },
  ];
}

// Stepwise migrations so older stored states pick up new features
// without losing existing data.
function migrate(old: State & { version: number }): State {
  let s = old;
  if (s.version === 1) {
    // v2 added the notes feature.
    s = {
      ...s,
      version: 2,
      channels: s.channels.some((c) => c.id === 'field-guide')
        ? s.channels
        : [...s.channels, fieldGuideChannel()],
      notes: seedNotes(),
    };
  }
  if (s.version === 2) {
    // v3 marks each team's #general as its home/feed channel.
    s = {
      ...s,
      version: 3,
      channels: s.channels.map((c) =>
        c.type === 'chat' && c.name === 'general' ? { ...c, isHome: true } : c
      ),
    };
  }
  if (s.version === 3) {
    // v4 adds the Mentions inbox and its per-user seen timestamps.
    s = { ...s, version: 4, mentionsSeenAt: s.mentionsSeenAt ?? {} };
  }
  if (s.version === 4) {
    // v5: private threads, inbox read/archive state, bean catalog,
    // and the wholesale-orders workflow.
    s = {
      ...s,
      version: 5,
      channels: [
        ...s.channels,
        ...(s.channels.some((c) => c.id === 'bean-library') ? [] : [beanLibraryChannel()]),
        ...(s.channels.some((c) => c.id === 'wholesale') ? [] : [roastingChannel()]),
      ],
      catalogItems: s.catalogItems ?? seedCatalogItems(),
      orders: s.orders ?? seedOrders(),
      mentionMeta: s.mentionMeta ?? {},
      threadReadAt: s.threadReadAt ?? {},
    };
  }
  if (s.version === 5) {
    // v6: the orders flow becomes the roasting hub. Rename #wholesale to
    // #roasting and retire the now-redundant #roast checklist board (its
    // "what to roast next" job is the roasting channel's To-roast column).
    s = {
      ...s,
      version: 6,
      channels: s.channels
        .filter((c) => c.id !== 'roast')
        .map((c) =>
          c.id === 'wholesale'
            ? { ...c, name: 'roasting', emoji: '🔥', description: 'Paste a job → roast it → hand it off' }
            : c
        ),
      listItems: s.listItems.filter((i) => i.channelId !== 'roast'),
      // Keep roast-list notes & chat — move them onto the roasting channel.
      notes: s.notes.map((n) =>
        n.channelId === 'roast' ? { ...n, channelId: 'wholesale' } : n
      ),
      messages: s.messages.map((m) =>
        m.channelId === 'roast' ? { ...m, channelId: 'wholesale' } : m
      ),
    };
  }
  return s.version === VERSION ? s : seed();
}

function seed(): State {
  const now = Date.now();
  const today = new Date();
  const dayThisMonth = (n: number) =>
    fmtDate(new Date(today.getFullYear(), today.getMonth(), n));

  const users: User[] = [
    { id: 'maya', name: 'Maya', emoji: '🌻', color: '#e0a63c', role: 'staff' },
    { id: 'jonah', name: 'Jonah', emoji: '🚴', color: '#7fa86d', role: 'staff' },
    { id: 'quinn', name: 'Quinn', emoji: '🎨', color: '#c96f8e', role: 'staff' },
  ];

  const teams: Team[] = [
    { id: 'fireweed', name: 'Fireweed Coffee Co', emoji: '☕️' },
    { id: 'campus', name: 'Campus Crew', emoji: '🎓' },
  ];

  const channels: Channel[] = [
    {
      id: 'general',
      teamId: 'fireweed',
      name: 'general',
      emoji: '☕️',
      type: 'chat',
      description: 'The watercooler, but it pours coffee',
      isHome: true,
    },
    {
      id: 'scheduling',
      teamId: 'fireweed',
      name: 'scheduling',
      emoji: '📅',
      type: 'schedule',
      description: 'Who’s on deck this month',
    },
    {
      id: 'stock',
      teamId: 'fireweed',
      name: 'stock & orders',
      emoji: '📦',
      type: 'board',
      description: 'What we have, what we need',
      lists: [
        { id: 'shelf', title: 'On the Shelf', emoji: '🫘' },
        { id: 'order', title: 'To Order', emoji: '🛒' },
      ],
    },
    fieldGuideChannel(),
    beanLibraryChannel(),
    roastingChannel(),
    {
      id: 'campus-general',
      teamId: 'campus',
      name: 'general',
      emoji: '💬',
      type: 'chat',
      description: 'A second team, to show how teams work',
      isHome: true,
    },
  ];

  const messages: Message[] = [
    {
      id: uid(),
      channelId: 'general',
      userId: 'maya',
      text: 'Morning all! The Guji smells **incredible** today 🤤',
      ts: now - 1000 * 60 * 60 * 5,
    },
    {
      id: uid(),
      channelId: 'general',
      userId: 'jonah',
      text:
        'New café order just landed:\n**Corner Blend Café**\n- 10 lb Espresso Blend\n- 5 lb Decaf Colombia\n- 2 cases oat milk\nAdding it to the roast list 🔥',
      ts: now - 1000 * 60 * 60 * 3,
    },
    {
      id: uid(),
      channelId: 'general',
      userId: 'quinn',
      text:
        'On it — roasting Thursday. Also the new bag stamps arrived and they are *adorable*',
      ts: now - 1000 * 60 * 47,
    },
    {
      id: uid(),
      channelId: 'wholesale',
      userId: 'quinn',
      text: 'Guji is smelling ripe — pulling it at **City** today, drop right after first crack',
      ts: now - 1000 * 60 * 95,
    },
    {
      id: uid(),
      channelId: 'wholesale',
      userId: 'maya',
      text: 'Perfect — @Quinn make sure Sarah P’s 2 lb comes out of that batch',
      ts: now - 1000 * 60 * 85,
    },
    {
      id: uid(),
      channelId: 'stock',
      userId: 'jonah',
      text: 'Kraft bags are down to one box, added them to To Order 🛒',
      ts: now - 1000 * 60 * 25,
    },
    {
      id: uid(),
      channelId: 'general',
      userId: 'maya',
      text: 'Quick heads up @team — staff meeting Monday 8am before we open ☕️',
      ts: now - 1000 * 60 * 18,
    },
    {
      id: uid(),
      channelId: 'campus-general',
      userId: 'maya',
      text: 'This is a second team — same app, separate channels 🎉',
      ts: now - 1000 * 60 * 60 * 24,
    },
  ];

  const signups: ShiftSignup[] = [
    {
      id: uid(),
      channelId: 'scheduling',
      date: dayThisMonth(Math.min(today.getDate() + 2, 28)),
      userId: 'maya',
      note: '9–1',
    },
    {
      id: uid(),
      channelId: 'scheduling',
      date: dayThisMonth(Math.min(today.getDate() + 2, 28)),
      userId: 'jonah',
      note: '1–5',
    },
    {
      id: uid(),
      channelId: 'scheduling',
      date: dayThisMonth(Math.min(today.getDate() + 4, 28)),
      userId: 'quinn',
      note: 'all day',
    },
  ];

  const listItems: ListItem[] = [
    { id: uid(), channelId: 'stock', listId: 'shelf', text: '**Ethiopia Guji** — 14 lb', addedBy: 'quinn', done: false, ts: now - 86400000 },
    { id: uid(), channelId: 'stock', listId: 'shelf', text: '**Colombia Huila** — 9 lb', addedBy: 'quinn', done: false, ts: now - 86000000 },
    { id: uid(), channelId: 'stock', listId: 'shelf', text: '**Decaf Mexico** — 3 lb *(running low!)*', addedBy: 'maya', done: false, ts: now - 4000000 },
    { id: uid(), channelId: 'stock', listId: 'order', text: '5 lb kraft bags', addedBy: 'jonah', done: false, ts: now - 3600000 },
    { id: uid(), channelId: 'stock', listId: 'order', text: 'Green: Brazil Cerrado, 60 lb', addedBy: 'quinn', done: true, ts: now - 7200000 },
  ];

  const hoursEntries: HoursEntry[] = [
    { id: uid(), userId: 'maya', teamId: 'fireweed', date: dayThisMonth(2), hours: 5.5, note: 'Market prep' },
    { id: uid(), userId: 'maya', teamId: 'fireweed', date: dayThisMonth(9), hours: 4, note: 'Roast day' },
    { id: uid(), userId: 'jonah', teamId: 'fireweed', date: dayThisMonth(3), hours: 6, note: 'Deliveries' },
    { id: uid(), userId: 'jonah', teamId: 'fireweed', date: dayThisMonth(10), hours: 4.25, note: 'Bagging + labels' },
    { id: uid(), userId: 'quinn', teamId: 'fireweed', date: dayThisMonth(9), hours: 7, note: 'Roasting' },
  ];

  return {
    version: VERSION,
    onboarded: false,
    currentUserId: '',
    currentTeamId: 'fireweed',
    users,
    teams,
    channels,
    messages,
    signups,
    listItems,
    notes: seedNotes(),
    catalogItems: seedCatalogItems(),
    orders: seedOrders(),
    hoursEntries,
    mentionsSeenAt: {},
    mentionMeta: {},
    threadReadAt: {},
    favorites: {},
  };
}

export const MAX_FAVORITES = 4;

// Which channels get quick-access tiles for a user. If they haven't
// customized, fall back to the most operational channels this team has
// (so the tiles show useful live status out of the box).
const FAVORITE_DEFAULT_PRIORITY = ['wholesale', 'stock', 'scheduling', 'field-guide', 'general'];

export function favoritesFor(state: State, userId: string): string[] {
  const teamChannels = state.channels.filter((c) => c.teamId === state.currentTeamId);
  const inTeam = (id: string) => teamChannels.some((c) => c.id === id);
  const stored = state.favorites?.[userId];
  if (stored) return stored.filter(inTeam).slice(0, MAX_FAVORITES);
  const byPriority = FAVORITE_DEFAULT_PRIORITY.filter(inTeam);
  const rest = teamChannels
    .filter((c) => !c.isHome && !byPriority.includes(c.id))
    .map((c) => c.id);
  return [...byPriority, ...rest].slice(0, MAX_FAVORITES);
}

// Unread count for the Mentions tab badge: channel mentions the user
// hasn't read/archived/deleted, plus private threads with messages from
// others newer than the user's last read of that thread.
export function unreadInboxCount(state: State, userId: string): number {
  const meta = state.mentionMeta[userId] ?? {};
  const unreadMentions = mentionsFor(state, userId).filter((m) => {
    const mm = meta[m.id];
    return !mm?.read && !mm?.archived && !mm?.deleted;
  }).length;
  const reads = state.threadReadAt[userId] ?? {};
  const unreadThreads = state.channels.filter((c) => {
    if (c.type !== 'dm' || !c.memberIds?.includes(userId)) return false;
    const lastFromOthers = state.messages
      .filter((m) => m.channelId === c.id && m.userId !== userId)
      .reduce((mx, m) => Math.max(mx, m.ts), 0);
    return lastFromOthers > (reads[c.id] ?? 0);
  }).length;
  return unreadMentions + unreadThreads;
}

export interface Api {
  state: State;
  me: User;
  createProfile(name: string, emoji: string): void;
  finishOnboarding(): void;
  send(channelId: string, text: string): void;
  addSignup(channelId: string, date: string, note: string): void;
  removeSignup(id: string): void;
  togglePin(id: string): void;
  editMessage(id: string, text: string): void;
  toggleReaction(id: string, emoji: string): void;
  renameChannel(id: string, name: string, emoji: string): void;
  addChannel(
    teamId: string,
    name: string,
    emoji: string,
    type: 'chat' | 'board' | 'notes' | 'schedule' | 'catalog' | 'orders',
    lists?: { title: string }[]
  ): void;
  ensureDm(otherIds: string[]): void;
  markThreadRead(channelId: string): void;
  setMentionMeta(messageId: string, patch: MentionMeta): void;
  addCatalogItem(
    channelId: string,
    fields: Pick<CatalogItem, 'name' | 'origin' | 'roast' | 'flavor' | 'certs' | 'notes'>
  ): void;
  updateCatalogItem(
    id: string,
    fields: Pick<CatalogItem, 'name' | 'origin' | 'roast' | 'flavor' | 'certs' | 'notes'>
  ): void;
  deleteCatalogItem(id: string): void;
  addOrder(channelId: string, title: string, items: string[]): void;
  toggleOrderItem(orderId: string, itemId: string): void;
  setOrderStage(orderId: string, stage: OrderStage): void;
  completeOrder(orderId: string): void;
  // Order-item editing (Supabase-backed provider only; optional so the
  // legacy local provider still satisfies the interface).
  uncompleteOrder?(orderId: string): void;
  editOrderItem?(itemId: string, text: string): void;
  deleteOrderItem?(itemId: string): void;
  addOrderItem?(orderId: string, text: string): void;
  deleteOrder(id: string): void;
  deleteChannel(id: string): void;
  addUser(name: string): void;
  setRole(id: string, role: 'admin' | 'staff'): void;
  addListItem(channelId: string, listId: string, text: string): void;
  toggleListItem(id: string): void;
  clearDone(channelId: string, listId: string): void;
  addNote(channelId: string, title: string, body: string): void;
  updateNote(id: string, title: string, body: string): void;
  deleteNote(id: string): void;
  addHours(date: string, hours: number, note: string): void;
  deleteHours(id: string): void;
  markMentionsSeen(): void;
  switchUser(id: string): void;
  toggleFavorite(channelId: string): void;
  switchTeam(id: string): void;
  addTeam(name: string, emoji: string): void;
  updateProfile(name: string, emoji: string): void;
  resetAll(): void;
}

// Exported so the Supabase-backed provider (supastore.tsx) can supply the
// same context that useStore() reads — views don't care which engine fills it.
export const StoreCtx = createContext<Api | null>(null);
const Ctx = StoreCtx;

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as State;
        if (parsed.version === VERSION) {
          // Defensive: never let a missing collection crash the views.
          return {
            ...parsed,
            notes: parsed.notes ?? [],
            mentionsSeenAt: parsed.mentionsSeenAt ?? {},
            catalogItems: parsed.catalogItems ?? [],
            orders: parsed.orders ?? [],
            mentionMeta: parsed.mentionMeta ?? {},
            threadReadAt: parsed.threadReadAt ?? {},
            favorites: parsed.favorites ?? {},
          };
        }
        if (parsed.version) return migrate(parsed);
      }
    } catch {
      // corrupted storage — fall through to fresh seed
    }
    return seed();
  });

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(state));
  }, [state]);

  const actions = useMemo(
    () => ({
      createProfile(name: string, emoji: string) {
        setState((s) => {
          const id = uid();
          const user: User = { id, name, emoji, color: accentForEmoji(emoji), role: 'admin' };
          return { ...s, users: [...s.users, user], currentUserId: id };
        });
      },
      finishOnboarding() {
        setState((s) => ({ ...s, onboarded: true }));
      },
      send(channelId: string, text: string) {
        setState((s) => ({
          ...s,
          messages: [
            ...s.messages,
            { id: uid(), channelId, userId: s.currentUserId, text, ts: Date.now() },
          ],
        }));
      },
      addSignup(channelId: string, date: string, note: string) {
        setState((s) => ({
          ...s,
          signups: [
            ...s.signups,
            { id: uid(), channelId, date, userId: s.currentUserId, note },
          ],
        }));
      },
      removeSignup(id: string) {
        setState((s) => ({ ...s, signups: s.signups.filter((x) => x.id !== id) }));
      },
      addListItem(channelId: string, listId: string, text: string) {
        setState((s) => ({
          ...s,
          listItems: [
            ...s.listItems,
            { id: uid(), channelId, listId, text, addedBy: s.currentUserId, done: false, ts: Date.now() },
          ],
        }));
      },
      toggleListItem(id: string) {
        setState((s) => ({
          ...s,
          listItems: s.listItems.map((i) => (i.id === id ? { ...i, done: !i.done } : i)),
        }));
      },
      clearDone(channelId: string, listId: string) {
        setState((s) => ({
          ...s,
          listItems: s.listItems.filter(
            (i) => !(i.channelId === channelId && i.listId === listId && i.done)
          ),
        }));
      },
      togglePin(id: string) {
        setState((s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === id ? { ...m, pinned: !m.pinned } : m
          ),
        }));
      },
      editMessage(id: string, text: string) {
        setState((s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === id ? { ...m, text, edited: true } : m
          ),
        }));
      },
      toggleReaction(id: string, emoji: string) {
        setState((s) => ({
          ...s,
          messages: s.messages.map((m) => {
            if (m.id !== id) return m;
            const reactions = { ...(m.reactions ?? {}) };
            const ids = reactions[emoji] ?? [];
            reactions[emoji] = ids.includes(s.currentUserId)
              ? ids.filter((x) => x !== s.currentUserId)
              : [...ids, s.currentUserId];
            if (reactions[emoji].length === 0) delete reactions[emoji];
            return { ...m, reactions };
          }),
        }));
      },
      renameChannel(id: string, name: string, emoji: string) {
        setState((s) => ({
          ...s,
          channels: s.channels.map((c) =>
            c.id === id ? { ...c, name, emoji } : c
          ),
        }));
      },
      addChannel(
        teamId: string,
        name: string,
        emoji: string,
        type: 'chat' | 'board' | 'notes' | 'schedule',
        lists?: { title: string }[]
      ) {
        setState((s) => ({
          ...s,
          channels: [
            ...s.channels,
            {
              id: uid(),
              teamId,
              name,
              emoji,
              type,
              description: '',
              lists:
                type === 'board'
                  ? (lists && lists.length ? lists : [{ title: 'List' }]).map((l) => ({
                      id: uid(),
                      title: l.title,
                      emoji: '',
                    }))
                  : undefined,
            },
          ],
        }));
      },
      ensureDm(otherIds: string[]) {
        setState((s) => {
          const members = [...new Set([s.currentUserId, ...otherIds])].sort();
          const id = dmIdFor(members);
          if (s.channels.some((c) => c.id === id)) return s;
          return {
            ...s,
            channels: [
              ...s.channels,
              {
                id,
                teamId: '', // private threads live outside every team
                name: 'private',
                emoji: '✉️',
                type: 'dm',
                description: '',
                memberIds: members,
              },
            ],
          };
        });
      },
      markThreadRead(channelId: string) {
        setState((s) => ({
          ...s,
          threadReadAt: {
            ...s.threadReadAt,
            [s.currentUserId]: {
              ...(s.threadReadAt[s.currentUserId] ?? {}),
              [channelId]: Date.now(),
            },
          },
        }));
      },
      setMentionMeta(messageId: string, patch: MentionMeta) {
        setState((s) => {
          const mine = s.mentionMeta[s.currentUserId] ?? {};
          return {
            ...s,
            mentionMeta: {
              ...s.mentionMeta,
              [s.currentUserId]: {
                ...mine,
                [messageId]: { ...mine[messageId], ...patch },
              },
            },
          };
        });
      },
      addCatalogItem(channelId, fields) {
        setState((s) => ({
          ...s,
          catalogItems: [
            ...s.catalogItems,
            {
              id: uid(),
              channelId,
              ...fields,
              updatedBy: s.currentUserId,
              updatedAt: Date.now(),
            },
          ],
        }));
      },
      updateCatalogItem(id, fields) {
        setState((s) => ({
          ...s,
          catalogItems: s.catalogItems.map((c) =>
            c.id === id
              ? { ...c, ...fields, updatedBy: s.currentUserId, updatedAt: Date.now() }
              : c
          ),
        }));
      },
      deleteCatalogItem(id: string) {
        setState((s) => ({
          ...s,
          catalogItems: s.catalogItems.filter((c) => c.id !== id),
        }));
      },
      addOrder(channelId: string, title: string, items: string[]) {
        setState((s) => ({
          ...s,
          orders: [
            ...s.orders,
            {
              id: uid(),
              channelId,
              title,
              items: items.map((t) => ({ id: uid(), text: t, done: false })),
              stage: 'roast' as OrderStage,
              createdBy: s.currentUserId,
              ts: Date.now(),
            },
          ],
        }));
      },
      toggleOrderItem(orderId: string, itemId: string) {
        setState((s) => ({
          ...s,
          orders: s.orders.map((o) =>
            o.id === orderId
              ? {
                  ...o,
                  items: o.items.map((i) =>
                    i.id === itemId ? { ...i, done: !i.done } : i
                  ),
                }
              : o
          ),
        }));
      },
      setOrderStage(orderId: string, stage: OrderStage) {
        setState((s) => ({
          ...s,
          orders: s.orders.map((o) =>
            o.id === orderId
              ? {
                  ...o,
                  stage,
                  deliveredBy: stage === 'delivered' ? s.currentUserId : undefined,
                  deliveredAt: stage === 'delivered' ? Date.now() : undefined,
                }
              : o
          ),
        }));
      },
      // Checking the order header finishes the whole thing: every bean is
      // checked off and the order advances to "ready to deliver".
      completeOrder(orderId: string) {
        setState((s) => ({
          ...s,
          orders: s.orders.map((o) =>
            o.id === orderId
              ? {
                  ...o,
                  stage: 'ready',
                  items: o.items.map((i) => ({ ...i, done: true })),
                }
              : o
          ),
        }));
      },
      deleteOrder(id: string) {
        setState((s) => ({ ...s, orders: s.orders.filter((o) => o.id !== id) }));
      },
      deleteChannel(id: string) {
        setState((s) => {
          const chan = s.channels.find((c) => c.id === id);
          if (!chan || chan.isHome) return s; // never delete the home feed
          return {
            ...s,
            channels: s.channels.filter((c) => c.id !== id),
            messages: s.messages.filter((m) => m.channelId !== id),
            listItems: s.listItems.filter((i) => i.channelId !== id),
            notes: s.notes.filter((n) => n.channelId !== id),
            signups: s.signups.filter((x) => x.channelId !== id),
            catalogItems: s.catalogItems.filter((c) => c.channelId !== id),
            orders: s.orders.filter((o) => o.channelId !== id),
          };
        });
      },
      addUser(name: string) {
        setState((s) => {
          const i = s.users.length;
          return {
            ...s,
            users: [
              ...s.users,
              {
                id: uid(),
                name,
                emoji: USER_EMOJI[i % USER_EMOJI.length],
                color: USER_COLORS[i % USER_COLORS.length],
                role: 'staff',
              },
            ],
          };
        });
      },
      setRole(id: string, role: 'admin' | 'staff') {
        setState((s) => ({
          ...s,
          users: s.users.map((u) => (u.id === id ? { ...u, role } : u)),
        }));
      },
      addNote(channelId: string, title: string, body: string) {
        setState((s) => ({
          ...s,
          notes: [
            ...s.notes,
            { id: uid(), channelId, title, body, updatedBy: s.currentUserId, updatedAt: Date.now() },
          ],
        }));
      },
      updateNote(id: string, title: string, body: string) {
        setState((s) => ({
          ...s,
          notes: s.notes.map((n) =>
            n.id === id
              ? { ...n, title, body, updatedBy: s.currentUserId, updatedAt: Date.now() }
              : n
          ),
        }));
      },
      deleteNote(id: string) {
        setState((s) => ({ ...s, notes: s.notes.filter((n) => n.id !== id) }));
      },
      addHours(date: string, hours: number, note: string) {
        setState((s) => ({
          ...s,
          hoursEntries: [
            ...s.hoursEntries,
            { id: uid(), userId: s.currentUserId, teamId: s.currentTeamId, date, hours, note },
          ],
        }));
      },
      deleteHours(id: string) {
        setState((s) => ({
          ...s,
          hoursEntries: s.hoursEntries.filter((e) => e.id !== id),
        }));
      },
      markMentionsSeen() {
        setState((s) => ({
          ...s,
          mentionsSeenAt: { ...s.mentionsSeenAt, [s.currentUserId]: Date.now() },
        }));
      },
      toggleFavorite(channelId: string) {
        setState((s) => {
          // Materialize the effective set (default or stored) before editing,
          // so a user's first tap starts from what they actually see.
          const current = favoritesFor(s, s.currentUserId);
          const has = current.includes(channelId);
          if (!has && current.length >= MAX_FAVORITES) return s;
          const next = has
            ? current.filter((id) => id !== channelId)
            : [...current, channelId];
          return {
            ...s,
            favorites: { ...(s.favorites ?? {}), [s.currentUserId]: next },
          };
        });
      },
      switchUser(id: string) {
        setState((s) => ({ ...s, currentUserId: id }));
      },
      switchTeam(id: string) {
        setState((s) => ({ ...s, currentTeamId: id }));
      },
      addTeam(name: string, emoji: string) {
        setState((s) => {
          const tid = uid();
          const team: Team = { id: tid, name, emoji };
          const chan: Channel = {
            id: uid(),
            teamId: tid,
            name: 'general',
            emoji: '💬',
            type: 'chat',
            description: 'Say hi',
            isHome: true,
          };
          return {
            ...s,
            teams: [...s.teams, team],
            channels: [...s.channels, chan],
            currentTeamId: tid,
          };
        });
      },
      updateProfile(name: string, emoji: string) {
        setState((s) => ({
          ...s,
          users: s.users.map((u) =>
            u.id === s.currentUserId
              ? { ...u, name, emoji, color: accentForEmoji(emoji) }
              : u
          ),
        }));
      },
      resetAll() {
        localStorage.removeItem(KEY);
        setState(seed());
      },
    }),
    []
  );

  const me =
    state.users.find((u) => u.id === state.currentUserId) ?? state.users[0];

  return <Ctx.Provider value={{ state, me, ...actions }}>{children}</Ctx.Provider>;
}

export function useStore(): Api {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
