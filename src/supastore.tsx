import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './lib/supabase';
import { useAuth } from './auth';
import { StoreCtx, accentForEmoji, orderedChannelIds, type Api } from './store';
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
import { totalsFor } from './lib/payroll';

const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : 0);

// CatalogFields is camelCase (it mirrors the client-side CatalogItem type);
// the table column is source_url. Every other field happens to be a single
// word so this was invisible until sourceUrl was added — worth a named
// mapper rather than a silent bug in the next multi-word field.
const catalogFieldsToRow = (f: import('./store').CatalogFields) => ({
  name: f.name,
  origin: f.origin,
  roast: f.roast,
  flavor: f.flavor,
  certs: f.certs,
  notes: f.notes,
  source_url: f.sourceUrl,
  cost: f.cost ?? null,
});
const roleToLocal = (r: string): 'admin' | 'staff' => (r === 'owner' ? 'admin' : 'staff');
const roleToDb = (r: 'admin' | 'staff') => (r === 'admin' ? 'owner' : 'staff');
const favKey = (uid: string) => `ct-fav-${uid}`;
const orderKey = (uid: string) => `ct-order-${uid}`;

// How much chat history to hold in memory. Generous for a small team, and
// bounded so the payload can't grow without limit. Note this is a global
// window across all channels, not per-channel — a very chatty channel could
// crowd out a quiet one's older history. Per-channel pagination (with a
// "load older" control) is the real fix if that ever becomes noticeable.
const MESSAGE_WINDOW = 2000;

function loadFavorites(uid: string): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(favKey(uid));
    return raw ? { [uid]: JSON.parse(raw) } : {};
  } catch {
    return {};
  }
}

function loadChannelOrder(uid: string): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(orderKey(uid));
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
    wageRates,
    payPeriods,
    payLines,
    staffNotes,
  ] = await Promise.all([
    q<any[]>(supabase.from('team_members').select('team_id, role, teams(id,name,emoji)').eq('user_id', uid)),
    q<any[]>(supabase.from('team_members').select('user_id, role').eq('team_id', teamId)),
    q<any[]>(supabase.from('profiles').select('*')),
    q<any[]>(supabase.from('channels').select('*').eq('team_id', teamId)),
    q<any[]>(supabase.from('channels').select('*').eq('type', 'dm')),
    q<any[]>(supabase.from('channel_members').select('*')),
    // Newest-first + explicit limit, reversed back to chronological below.
    // Fetching ascending relied on PostgREST's implicit row cap, which meant
    // that once history outgrew it the *newest* messages were the ones
    // silently dropped — i.e. chat would appear to stop updating. Descending
    // makes the oldest fall off instead, which is what you'd expect.
    q<any[]>(
      supabase
        .from('messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(MESSAGE_WINDOW)
    ),
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
    q<any[]>(supabase.from('wage_rates').select('*')),
    q<any[]>(supabase.from('pay_periods').select('*').eq('team_id', teamId)),
    q<any[]>(supabase.from('pay_period_lines').select('*')),
    // RLS returns nothing here unless you're the owner.
    q<any[]>(supabase.from('staff_notes').select('*').eq('team_id', teamId)),
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
    scheduleCapacity: c.schedule_capacity ?? undefined,
  }));

  const pinned = new Set(pins.map((p) => p.message_id));
  const reactionsByMsg = new Map<string, Record<string, string[]>>();
  for (const r of reactions) {
    const rec = reactionsByMsg.get(r.message_id) ?? {};
    (rec[r.emoji] = rec[r.emoji] ?? []).push(r.user_id);
    reactionsByMsg.set(r.message_id, rec);
  }
  // Back to oldest-first: Home's channel preview takes the *last* element as
  // "most recent message", so state.messages must stay chronological.
  const msgs: Message[] = [...messages].reverse().map((m) => ({
    id: m.id,
    channelId: m.channel_id,
    userId: m.user_id,
    text: m.text,
    ts: ms(m.created_at),
    pinned: pinned.has(m.id) || undefined,
    edited: m.edited || undefined,
    reactions: reactionsByMsg.get(m.id),
    replyToId: m.reply_to_id ?? undefined,
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
    invoiced: o.invoiced ?? false,
    invoicedBy: o.invoiced_by ?? undefined,
    invoicedAt: o.invoiced_at ? ms(o.invoiced_at) : undefined,
    items: (itemsByOrder.get(o.id) ?? [])
      .sort((a, b) => a.position - b.position)
      .map(({ id, text, done }) => ({ id, text, done })),
  }));

  const mmForUser: Record<string, MentionMeta> = {};
  for (const r of mentionMeta) {
    mmForUser[r.message_id] = { read: r.read, archived: r.archived, deleted: r.deleted };
  }
  // Keyed by user, not just the caller: RLS now also returns fellow DM
  // members' rows so private threads can show "Seen by …". Team-channel
  // rows still only ever come back for the caller.
  const readsByUser: Record<string, Record<string, number>> = {};
  for (const r of channelReads) {
    (readsByUser[r.user_id] ??= {})[r.channel_id] = ms(r.last_read_at);
  }
  readsByUser[uid] ??= {};

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
      isAlternate: s.is_alternate ?? false,
    })) as ShiftSignup[],
    listItems: listItems.map((i) => ({
      id: i.id,
      channelId: i.channel_id,
      listId: i.list_id,
      text: i.text,
      addedBy: i.added_by,
      done: i.done,
      ts: ms(i.created_at),
      dueDate: i.due_date ?? undefined,
      notes: i.notes ?? undefined,
      assignedTo: i.assigned_to ?? undefined,
      assignedBy: i.assigned_by ?? undefined,
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
      sourceUrl: c.source_url ?? '',
      cost: c.cost == null ? undefined : Number(c.cost),
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
      tips: Number(h.tips ?? 0),
      note: h.note ?? '',
    })) as HoursEntry[],
    wageRates: wageRates.map((w) => ({
      id: w.id,
      teamId: w.team_id,
      userId: w.user_id,
      rate: Number(w.rate),
      effectiveFrom: w.effective_from,
    })),
    payPeriods: payPeriods.map((p) => ({
      id: p.id,
      teamId: p.team_id,
      periodStart: p.period_start,
      periodEnd: p.period_end,
      note: p.note ?? '',
      lines: payLines
        .filter((l) => l.pay_period_id === p.id)
        .map((l) => ({
          userId: l.user_id,
          hours: Number(l.hours),
          gross: Number(l.gross),
          tips: Number(l.tips),
          paidAt: l.paid_at ? ms(l.paid_at) : undefined,
          paidBy: l.paid_by ?? undefined,
        })),
    })),
    staffNotes: staffNotes.map((n) => ({
      userId: n.user_id,
      note: n.note ?? '',
      updatedAt: ms(n.updated_at),
    })),
    mentionMeta: { [uid]: mmForUser },
    threadReadAt: readsByUser,
    mentionsSeenAt: {},
    favorites: loadFavorites(uid),
    channelOrder: loadChannelOrder(uid),
  };
}

export function SupabaseStoreProvider({
  team,
  children,
}: {
  team: MyTeam;
  children: React.ReactNode;
}) {
  const userId = useAuth().user?.id;
  const uidRef = useRef<string>('');
  const teamIdRef = useRef<string>(team.teamId);
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState('');

  // Channel ids we've loaded, readable synchronously from the realtime
  // handler (component state is a render behind and can't be consulted there).
  const knownChannelsRef = useRef<Set<string>>(new Set());

  const reload = useCallback(async () => {
    const uid = uidRef.current;
    if (!uid) return;
    try {
      const next = await loadState(teamIdRef.current, uid);
      knownChannelsRef.current = new Set(next.channels.map((c) => c.id));
      setState(next);
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    // Take the id from the session AuthProvider already has. This used to
    // call supabase.auth.getUser(), which hits /auth/v1/user over the
    // network — a full round trip that every one of the queries below had
    // to queue behind, for an id we were already holding.
    uidRef.current = userId ?? '';
    if (uidRef.current) void reload();
    // Live updates. RLS on realtime means we only get events for rows we're
    // allowed to see. Most changes fall back to a debounced full reload,
    // but an incoming message — the overwhelmingly most frequent event —
    // gets appended directly: refetching all 18 tables because one person
    // typed was re-downloading the entire workspace on every keystroke-worth
    // of conversation.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(reload, 250);
    };

    // Pure updater — the id guard covers our own sends, which have already
    // been pulled in by the reload that followed the insert.
    const appendMessage = (row: any) =>
      setState((s) => {
        if (!s || s.messages.some((m) => m.id === row.id)) return s;
        return {
          ...s,
          messages: [
            ...s.messages,
            {
              id: row.id,
              channelId: row.channel_id,
              userId: row.user_id,
              text: row.text,
              ts: ms(row.created_at),
              edited: row.edited || undefined,
              replyToId: row.reply_to_id ?? undefined,
            },
          ],
        };
      });

    const sub = supabase
      .channel('percolate')
      .on('postgres_changes', { event: '*', schema: 'public' }, (payload: any) => {
        const row = payload.new;
        // The channel check has to be synchronous, so it reads a ref rather
        // than component state. An unknown channel means something
        // structural also changed (a brand-new DM thread, say), so that
        // needs the full reload to pick the channel itself up.
        if (
          payload.table === 'messages' &&
          payload.eventType === 'INSERT' &&
          row &&
          knownChannelsRef.current.has(row.channel_id)
        ) {
          appendMessage(row);
          return;
        }
        bump();
      })
      .subscribe();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      supabase.removeChannel(sub);
    };
  }, [reload, userId]);

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
    send: (channelId, text, replyToId) =>
      run(
        supabase
          .from('messages')
          .insert({ channel_id: channelId, user_id: uid, text, reply_to_id: replyToId ?? null })
      ),
    editMessage: (id, text) => run(supabase.from('messages').update({ text }).eq('id', id)),
    deleteMessage: (id) => run(supabase.from('messages').delete().eq('id', id)),
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
    addSignup: (channelId, date, note, isAlternate) =>
      run(
        supabase
          .from('shift_signups')
          .insert({ channel_id: channelId, user_id: uid, date, note, is_alternate: !!isAlternate })
      ),
    // The DB trigger (promote_alternate_on_signup_delete) handles promoting
    // the next alternate server-side — nothing extra to do here.
    removeSignup: (id) => run(supabase.from('shift_signups').delete().eq('id', id)),
    setScheduleCapacity: async (channelId, patch) => {
      const ch = state.channels.find((c) => c.id === channelId);
      if (!ch) return { error: 'Channel not found.' };
      const next = { ...(ch.scheduleCapacity ?? {}) };
      for (const [day, val] of Object.entries(patch)) {
        if (val) next[day] = val;
        else delete next[day];
      }
      const { error } = await supabase
        .from('channels')
        .update({ schedule_capacity: Object.keys(next).length ? next : null })
        .eq('id', channelId);
      if (error) return { error: error.message };
      await reload();
      return {};
    },
    addListItem: (channelId, listId, text) =>
      run(supabase.from('list_items').insert({ channel_id: channelId, list_id: listId, text, added_by: uid })),
    toggleListItem: (id) => {
      const cur = state.listItems.find((i) => i.id === id);
      return run(supabase.from('list_items').update({ done: !cur?.done }).eq('id', id));
    },
    editListItemDetails: (id, patch) => {
      const row: Record<string, unknown> = {};
      if (patch.dueDate !== undefined) row.due_date = patch.dueDate;
      if (patch.notes !== undefined) row.notes = patch.notes;
      if (patch.assignedTo !== undefined) {
        row.assigned_to = patch.assignedTo;
        row.assigned_by = patch.assignedTo ? uid : null;
      }
      return run(supabase.from('list_items').update(row).eq('id', id));
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
      run(
        supabase
          .from('catalog_items')
          .insert({ channel_id: channelId, ...catalogFieldsToRow(fields), updated_by: uid })
      ),
    updateCatalogItem: (id, fields) =>
      run(supabase.from('catalog_items').update(catalogFieldsToRow(fields)).eq('id', id)),
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
    setOrderInvoiced: (orderId, invoiced) =>
      run(supabase.from('orders').update({ invoiced }).eq('id', orderId)),
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
    addHours: (date, hours, tips, note) =>
      run(
        supabase
          .from('hours_entries')
          .insert({ team_id: teamIdRef.current, user_id: uid, date, hours, tips, note })
      ),
    editHours: (id, hours, tips, note) =>
      run(supabase.from('hours_entries').update({ hours, tips, note }).eq('id', id)),
    deleteHours: (id) => run(supabase.from('hours_entries').delete().eq('id', id)),

    setWageRate: async (userId, rate, effectiveFrom) => {
      // Upsert on (user_id, effective_from): correcting a rate you just
      // entered replaces it, while a genuinely new date appends to history.
      const { error } = await supabase
        .from('wage_rates')
        .upsert(
          {
            team_id: teamIdRef.current,
            user_id: userId,
            rate,
            effective_from: effectiveFrom,
            created_by: uid,
          },
          { onConflict: 'user_id,effective_from' }
        );
      if (error) return { error: error.message };
      await reload();
      return {};
    },

    // Freezes what each person earned, then stamps the period paid. Lines
    // are written BEFORE paid_at for failure atomicity: if the stamp fails
    // we're left with an unpaid period carrying a stale snapshot, which the
    // next attempt just overwrites. The other order would leave a period
    // marked paid with no record of what was paid — and with its entries
    // already locked, so the totals couldn't be recomputed.
    // Settles ONE person. Their line is frozen and stamped paid; everyone
    // else's timesheet stays editable. Line is written before the stamp so a
    // failure leaves an unpaid line the next attempt just overwrites, rather
    // than a paid line with no totals behind it.
    markPersonPaid: async (periodStart, periodEnd, userId) => {
      // `state` is non-null here — the provider early-returns a loading
      // screen above, and this object is rebuilt each render.
      const snapshot = state;

      const { data: period, error: pErr } = await supabase
        .from('pay_periods')
        .upsert(
          { team_id: teamIdRef.current, period_start: periodStart, period_end: periodEnd },
          { onConflict: 'team_id,period_start,period_end' }
        )
        .select('id')
        .single();
      if (pErr || !period) return { error: pErr?.message ?? 'Could not open the period.' };

      const t = totalsFor(
        snapshot.hoursEntries,
        snapshot.wageRates,
        userId,
        periodStart,
        periodEnd
      );
      const { error: lErr } = await supabase.from('pay_period_lines').upsert(
        {
          pay_period_id: period.id,
          user_id: userId,
          hours: t.hours,
          gross: t.gross,
          tips: t.tips,
        },
        { onConflict: 'pay_period_id,user_id' }
      );
      if (lErr) return { error: lErr.message };

      const { error: mErr } = await supabase
        .from('pay_period_lines')
        .update({ paid_at: new Date().toISOString(), paid_by: uid })
        .eq('pay_period_id', period.id)
        .eq('user_id', userId);
      if (mErr) return { error: mErr.message };
      await reload();
      return {};
    },

    reopenPerson: async (periodStart, periodEnd, userId) => {
      const period = state.payPeriods.find(
        (p) => p.periodStart === periodStart && p.periodEnd === periodEnd
      );
      if (!period) return {};
      const { error } = await supabase
        .from('pay_period_lines')
        .update({ paid_at: null, paid_by: null })
        .eq('pay_period_id', period.id)
        .eq('user_id', userId);
      if (error) return { error: error.message };
      await reload();
      return {};
    },

    setStaffNote: async (userId, note) => {
      const { error } = await supabase.from('staff_notes').upsert(
        {
          team_id: teamIdRef.current,
          user_id: userId,
          note,
          updated_by: uid,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'team_id,user_id' }
      );
      if (error) return { error: error.message };
      await reload();
      return {};
    },

    setListEmail: async (channelId, listId, email) => {
      const ch = state.channels.find((c) => c.id === channelId);
      if (!ch) return { error: 'Channel not found.' };
      const lists = (ch.lists ?? []).map((l) =>
        l.id === listId ? { ...l, orderEmail: email || undefined } : l
      );
      const { error } = await supabase.from('channels').update({ lists }).eq('id', channelId);
      if (error) return { error: error.message };
      await reload();
      return {};
    },
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
    ensureDm: async (otherIds) => {
      const { data, error } = await supabase.rpc('open_dm', { other_ids: otherIds });
      if (error) {
        setError(error.message ?? String(error));
        return '';
      }
      await reload();
      return data as string;
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
    // Hits the server rather than the loaded window, so search finds old
    // messages this client never downloaded. RLS does the access control:
    // the query is unscoped on purpose and the database returns only rows
    // this user may see. Newest-first, since a search for something recent
    // is the common case.
    searchMessages: async (query) => {
      const needle = query.trim();
      if (!needle) return [];
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .ilike('text', `%${needle}%`)
        .order('created_at', { ascending: false })
        .limit(40);
      if (error || !data) return [];
      return data.map((m) => ({
        id: m.id,
        channelId: m.channel_id,
        userId: m.user_id,
        text: m.text,
        ts: ms(m.created_at),
        edited: m.edited || undefined,
        replyToId: m.reply_to_id ?? undefined,
      }));
    },
    moveChannel: (channelId, direction) => {
      const teamIds = state.channels.filter((c) => c.teamId === teamIdRef.current).map((c) => c.id);
      const order = orderedChannelIds(state, uid, teamIds);
      const i = order.indexOf(channelId);
      const j = direction === 'up' ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= order.length) return;
      const next = [...order];
      [next[i], next[j]] = [next[j], next[i]];
      localStorage.setItem(orderKey(uid), JSON.stringify(next));
      setState((s) => (s ? { ...s, channelOrder: { ...s.channelOrder, [uid]: next } } : s));
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
    setTeamEmoji: (emoji) =>
      run(supabase.from('teams').update({ emoji }).eq('id', teamIdRef.current)),
    // Not meaningful with real accounts (kept as no-ops so the UI can’t crash).
    addUser: () => {},
    switchUser: () => {},
    markMentionsSeen: () => {},
    resetAll: () => {},
  };

  return <StoreCtx.Provider value={api}>{children}</StoreCtx.Provider>;
}
