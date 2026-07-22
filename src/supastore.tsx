import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './lib/supabase';
import { StoreCtx, accentForEmoji, type Api } from './store';
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
import type { MyTeam } from './views/TeamSetup';

const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : 0);
const roleToLocal = (r: string): 'admin' | 'staff' => (r === 'owner' ? 'admin' : 'staff');
const roleToDb = (r: 'admin' | 'staff') => (r === 'admin' ? 'owner' : 'staff');
const favKey = (uid: string) => `ct-fav-${uid}`;

function loadFavorites(uid: string): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(favKey(uid));
    return raw ? { [uid]: JSON.parse(raw) } : {};
  } catch {
    return {};
  }
}

// Fetch everything the signed-in user can see for a team, then reshape the
// normalized rows back into the local `State` the views already expect
// (reactions/pins folded into messages, order_items into orders, etc.).
async function loadState(teamId: string, uid: string): Promise<State> {
  const q = <T,>(p: PromiseLike<{ data: T | null; error: any }>) =>
    Promise.resolve(p).then(({ data, error }) => {
      if (error) throw error;
      return (data ?? []) as T;
    });

  const [
    myTeams,
    members,
    profiles,
    teamChannels,
    dmChannels,
    channelMembers,
    messages,
    reactions,
    pins,
    signups,
    listItems,
    notes,
    catalog,
    orders,
    orderItems,
    hours,
    mentionMeta,
    channelReads,
  ] = await Promise.all([
    q<any[]>(supabase.from('team_members').select('team_id, role, teams(id,name,emoji)').eq('user_id', uid)),
    q<any[]>(supabase.from('team_members').select('user_id, role').eq('team_id', teamId)),
    q<any[]>(supabase.from('profiles').select('*')),
    q<any[]>(supabase.from('channels').select('*').eq('team_id', teamId)),
    q<any[]>(supabase.from('channels').select('*').eq('type', 'dm')),
    q<any[]>(supabase.from('channel_members').select('*')),
    q<any[]>(supabase.from('messages').select('*').order('created_at')),
    q<any[]>(supabase.from('reactions').select('*')),
    q<any[]>(supabase.from('pins').select('*')),
    q<any[]>(supabase.from('shift_signups').select('*')),
    q<any[]>(supabase.from('list_items').select('*')),
    q<any[]>(supabase.from('notes').select('*')),
    q<any[]>(supabase.from('catalog_items').select('*')),
    q<any[]>(supabase.from('orders').select('*')),
    q<any[]>(supabase.from('order_items').select('*')),
    q<any[]>(supabase.from('hours_entries').select('*')),
    q<any[]>(supabase.from('mention_meta').select('*')),
    q<any[]>(supabase.from('channel_reads').select('*')),
  ]);

  const roleOf = new Map<string, string>(members.map((m) => [m.user_id, m.role]));
  const users: User[] = profiles.map((p) => ({
    id: p.id,
    name: p.name,
    emoji: p.emoji,
    color: p.color,
    role: roleToLocal(roleOf.get(p.id) ?? 'staff'),
  }));

  const teams: Team[] = myTeams.map((r) => {
    const t = Array.isArray(r.teams) ? r.teams[0] : r.teams;
    return { id: r.team_id, name: t?.name ?? 'Team', emoji: t?.emoji ?? '☕️' };
  });

  const dmMembersByChannel = new Map<string, string[]>();
  for (const cm of channelMembers) {
    const arr = dmMembersByChannel.get(cm.channel_id) ?? [];
    arr.push(cm.user_id);
    dmMembersByChannel.set(cm.channel_id, arr);
  }

  const channels: Channel[] = [...teamChannels, ...dmChannels].map((c) => ({
    id: c.id,
    teamId: c.team_id ?? '',
    name: c.name,
    emoji: c.emoji,
    type: c.type,
    description: c.description ?? '',
    lists: c.lists ?? undefined,
    isHome: c.is_home ?? false,
    memberIds: c.type === 'dm' ? dmMembersByChannel.get(c.id) ?? [] : undefined,
  }));

  const pinned = new Set(pins.map((p) => p.message_id));
  const reactionsByMsg = new Map<string, Record<string, string[]>>();
  for (const r of reactions) {
    const rec = reactionsByMsg.get(r.message_id) ?? {};
    (rec[r.emoji] = rec[r.emoji] ?? []).push(r.user_id);
    reactionsByMsg.set(r.message_id, rec);
  }
  const msgs: Message[] = messages.map((m) => ({
    id: m.id,
    channelId: m.channel_id,
    userId: m.user_id,
    text: m.text,
    ts: ms(m.created_at),
    pinned: pinned.has(m.id) || undefined,
    edited: m.edited || undefined,
    reactions: reactionsByMsg.get(m.id),
  }));

  const itemsByOrder = new Map<string, { id: string; text: string; done: boolean; position: number }[]>();
  for (const it of orderItems) {
    const arr = itemsByOrder.get(it.order_id) ?? [];
    arr.push({ id: it.id, text: it.text, done: it.done, position: it.position ?? 0 });
    itemsByOrder.set(it.order_id, arr);
  }
  const ordersOut: Order[] = orders.map((o) => ({
    id: o.id,
    channelId: o.channel_id,
    title: o.title,
    stage: o.stage as OrderStage,
    createdBy: o.created_by,
    ts: ms(o.created_at),
    deliveredBy: o.delivered_by ?? undefined,
    deliveredAt: o.delivered_at ? ms(o.delivered_at) : undefined,
    items: (itemsByOrder.get(o.id) ?? [])
      .sort((a, b) => a.position - b.position)
      .map(({ id, text, done }) => ({ id, text, done })),
  }));

  const mmForUser: Record<string, MentionMeta> = {};
  for (const r of mentionMeta) {
    mmForUser[r.message_id] = { read: r.read, archived: r.archived, deleted: r.deleted };
  }
  const readsForUser: Record<string, number> = {};
  for (const r of channelReads) readsForUser[r.channel_id] = ms(r.last_read_at);

  return {
    version: 0,
    onboarded: true,
    currentUserId: uid,
    currentTeamId: teamId,
    users,
    teams,
    channels,
    messages: msgs,
    signups: signups.map((s) => ({
      id: s.id,
      channelId: s.channel_id,
      userId: s.user_id,
      date: s.date,
      note: s.note ?? '',
    })) as ShiftSignup[],
    listItems: listItems.map((i) => ({
      id: i.id,
      channelId: i.channel_id,
      listId: i.list_id,
      text: i.text,
      addedBy: i.added_by,
      done: i.done,
      ts: ms(i.created_at),
    })) as ListItem[],
    notes: notes.map((n) => ({
      id: n.id,
      channelId: n.channel_id,
      title: n.title,
      body: n.body ?? '',
      updatedBy: n.updated_by,
      updatedAt: ms(n.updated_at),
    })) as Note[],
    catalogItems: catalog.map((c) => ({
      id: c.id,
      channelId: c.channel_id,
      name: c.name,
      origin: c.origin ?? '',
      roast: c.roast ?? '',
      flavor: c.flavor ?? '',
      certs: c.certs ?? '',
      notes: c.notes ?? '',
      updatedBy: c.updated_by,
      updatedAt: ms(c.updated_at),
    })) as CatalogItem[],
    orders: ordersOut,
    hoursEntries: hours.map((h) => ({
      id: h.id,
      userId: h.user_id,
      teamId: h.team_id,
      date: h.date,
      hours: Number(h.hours),
      note: h.note ?? '',
    })) as HoursEntry[],
    mentionMeta: { [uid]: mmForUser },
    threadReadAt: { [uid]: readsForUser },
    mentionsSeenAt: {},
    favorites: loadFavorites(uid),
  };
}

export function SupabaseStoreProvider({
  team,
  children,
}: {
  team: MyTeam;
  children: React.ReactNode;
}) {
  const uidRef = useRef<string>('');
  const teamIdRef = useRef<string>(team.teamId);
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    const uid = uidRef.current;
    if (!uid) return;
    try {
      setState(await loadState(teamIdRef.current, uid));
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(async ({ data }) => {
      if (!alive) return;
      uidRef.current = data.user?.id ?? '';
      await reload();
    });
    // Live updates: any change to the schema we can see triggers a debounced
    // reload. RLS on realtime means we only get events for our own rows.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(reload, 250);
    };
    const sub = supabase
      .channel('percolate')
      .on('postgres_changes', { event: '*', schema: 'public' }, bump)
      .subscribe();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      supabase.removeChannel(sub);
    };
  }, [reload]);

  // Fire a Supabase mutation, then reload. Errors surface but don't crash.
  const run = useCallback(
    async (p: PromiseLike<{ error: any }>) => {
      const { error } = await p;
      if (error) {
        setError(error.message ?? String(error));
        return;
      }
      await reload();
    },
    [reload]
  );

  if (error) {
    return (
      <div className="onboard">
        <div className="slide">
          <div className="onboard-hero">⚠️</div>
          <h1>Couldn’t load your team</h1>
          <p className="sub">{error}</p>
          <button
            className="btn ghost"
            onClick={() => {
              setError('');
              reload();
            }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="onboard">
        <div className="slide">
          <div className="onboard-hero">☕️</div>
          <p className="sub">Brewing your workspace…</p>
        </div>
      </div>
    );
  }

  const uid = uidRef.current;
  const me = state.users.find((u) => u.id === uid) ?? state.users[0];

  const api: Api = {
    state,
    me,
    createProfile: (name, emoji) =>
      run(supabase.from('profiles').upsert({ id: uid, name, emoji, color: accentForEmoji(emoji) })),
    finishOnboarding: () => {},
    updateProfile: (name, emoji) =>
      run(supabase.from('profiles').update({ name, emoji, color: accentForEmoji(emoji) }).eq('id', uid)),
    send: (channelId, text) =>
      run(supabase.from('messages').insert({ channel_id: channelId, user_id: uid, text })),
    editMessage: (id, text) => run(supabase.from('messages').update({ text }).eq('id', id)),
    togglePin: (id) => {
      const m = state.messages.find((x) => x.id === id);
      return m?.pinned
        ? run(supabase.from('pins').delete().eq('message_id', id))
        : run(supabase.from('pins').insert({ message_id: id, pinned_by: uid }));
    },
    toggleReaction: (id, emoji) => {
      const mine = state.messages.find((x) => x.id === id)?.reactions?.[emoji]?.includes(uid);
      return mine
        ? run(supabase.from('reactions').delete().eq('message_id', id).eq('user_id', uid).eq('emoji', emoji))
        : run(supabase.from('reactions').insert({ message_id: id, user_id: uid, emoji }));
    },
    addSignup: (channelId, date, note) =>
      run(supabase.from('shift_signups').insert({ channel_id: channelId, user_id: uid, date, note })),
    removeSignup: (id) => run(supabase.from('shift_signups').delete().eq('id', id)),
    addListItem: (channelId, listId, text) =>
      run(supabase.from('list_items').insert({ channel_id: channelId, list_id: listId, text, added_by: uid })),
    toggleListItem: (id) => {
      const cur = state.listItems.find((i) => i.id === id);
      return run(supabase.from('list_items').update({ done: !cur?.done }).eq('id', id));
    },
    clearDone: (channelId, listId) =>
      run(
        supabase
          .from('list_items')
          .delete()
          .eq('channel_id', channelId)
          .eq('list_id', listId)
          .eq('done', true)
      ),
    addNote: (channelId, title, body) =>
      run(supabase.from('notes').insert({ channel_id: channelId, title, body, updated_by: uid })),
    updateNote: (id, title, body) => run(supabase.from('notes').update({ title, body }).eq('id', id)),
    deleteNote: (id) => run(supabase.from('notes').delete().eq('id', id)),
    addCatalogItem: (channelId, fields) =>
      run(supabase.from('catalog_items').insert({ channel_id: channelId, ...fields, updated_by: uid })),
    updateCatalogItem: (id, fields) => run(supabase.from('catalog_items').update(fields).eq('id', id)),
    deleteCatalogItem: (id) => run(supabase.from('catalog_items').delete().eq('id', id)),
    addOrder: async (channelId, title, items) => {
      const { data, error } = await supabase
        .from('orders')
        .insert({ channel_id: channelId, title, created_by: uid })
        .select('id')
        .single();
      if (error || !data) {
        setError(error?.message ?? 'Could not create order');
        return;
      }
      await run(
        supabase
          .from('order_items')
          .insert(items.map((text, i) => ({ order_id: data.id, text, position: i })))
      );
    },
    toggleOrderItem: (orderId, itemId) => {
      const cur = state.orders.find((o) => o.id === orderId)?.items.find((i) => i.id === itemId);
      return run(supabase.from('order_items').update({ done: !cur?.done }).eq('id', itemId));
    },
    setOrderStage: (orderId, stage) =>
      run(supabase.from('orders').update({ stage }).eq('id', orderId)),
    completeOrder: async (orderId) => {
      await supabase.from('order_items').update({ done: true }).eq('order_id', orderId);
      await run(supabase.from('orders').update({ stage: 'ready' as OrderStage }).eq('id', orderId));
    },
    uncompleteOrder: async (orderId) => {
      await supabase.from('order_items').update({ done: false }).eq('order_id', orderId);
      await run(supabase.from('orders').update({ stage: 'roast' as OrderStage }).eq('id', orderId));
    },
    editOrderItem: (itemId, text) =>
      run(supabase.from('order_items').update({ text }).eq('id', itemId)),
    deleteOrderItem: (itemId) => run(supabase.from('order_items').delete().eq('id', itemId)),
    addOrderItem: (orderId, text) => {
      const pos = state.orders.find((o) => o.id === orderId)?.items.length ?? 0;
      return run(supabase.from('order_items').insert({ order_id: orderId, text, position: pos }));
    },
    deleteOrder: (id) => run(supabase.from('orders').delete().eq('id', id)),
    addHours: (date, hours, note) =>
      run(
        supabase
          .from('hours_entries')
          .insert({ team_id: teamIdRef.current, user_id: uid, date, hours, note })
      ),
    deleteHours: (id) => run(supabase.from('hours_entries').delete().eq('id', id)),
    renameChannel: (id, name, emoji) =>
      run(supabase.from('channels').update({ name, emoji }).eq('id', id)),
    addChannel: (teamId, name, emoji, type, lists) =>
      run(
        supabase.from('channels').insert({
          team_id: teamId,
          name,
          emoji,
          type,
          description: '',
          lists:
            type === 'board'
              ? (lists && lists.length ? lists : [{ title: 'List' }]).map((l, i) => ({
                  id: `l${i}-${Date.now()}`,
                  title: l.title,
                  emoji: '',
                }))
              : null,
        })
      ),
    deleteChannel: (id) => run(supabase.from('channels').delete().eq('id', id)),
    setRole: (id, role) =>
      run(
        supabase
          .from('team_members')
          .update({ role: roleToDb(role) })
          .eq('team_id', teamIdRef.current)
          .eq('user_id', id)
      ),
    setMentionMeta: (messageId, patch) => {
      const cur = state.mentionMeta[uid]?.[messageId] ?? {};
      const merged = { ...cur, ...patch };
      return run(
        supabase.from('mention_meta').upsert({
          user_id: uid,
          message_id: messageId,
          read: !!merged.read,
          archived: !!merged.archived,
          deleted: !!merged.deleted,
        })
      );
    },
    markThreadRead: (channelId) =>
      run(
        supabase
          .from('channel_reads')
          .upsert({ user_id: uid, channel_id: channelId, last_read_at: new Date().toISOString() })
      ),
    toggleFavorite: (channelId) => {
      const cur = state.favorites?.[uid] ?? [];
      const next = cur.includes(channelId)
        ? cur.filter((x) => x !== channelId)
        : cur.length >= 4
          ? cur
          : [...cur, channelId];
      localStorage.setItem(favKey(uid), JSON.stringify(next));
      setState((s) => (s ? { ...s, favorites: { ...s.favorites, [uid]: next } } : s));
    },
    switchTeam: async (id) => {
      teamIdRef.current = id;
      await reload();
    },
    addTeam: async (name, emoji) => {
      const { error } = await supabase.from('teams').insert({ name, emoji, created_by: uid });
      if (error) {
        setError(error.message);
        return;
      }
      // The new team's id comes back via reload of memberships; switch after.
      await reload();
    },
    // Not meaningful with real accounts (kept as no-ops so the UI can’t crash).
    addUser: () => {},
    switchUser: () => {},
    markMentionsSeen: () => {},
    resetAll: () => {},
  };

  return <StoreCtx.Provider value={api}>{children}</StoreCtx.Provider>;
}
