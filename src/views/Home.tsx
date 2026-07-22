import React, { useMemo, useState } from 'react';
import { useStore, favoritesFor, MAX_FAVORITES } from '../store';

const CHANNEL_EMOJI = ['💬', '📦', '🔥', '📖', '📅', '🧾', '🎉', '🛠️', '🚚', '🧊', '🌱', '☕️'];

type NewChannelType = 'chat' | 'board' | 'notes' | 'schedule' | 'catalog' | 'orders';

const TYPE_OPTIONS: { value: NewChannelType; label: string; blurb: string }[] = [
  { value: 'chat', label: 'Chat', blurb: 'Just talk — like #general.' },
  { value: 'board', label: 'Checklist', blurb: 'Shared checklists — like #roast list.' },
  { value: 'notes', label: 'Pages', blurb: 'Editable pages — like #field guide.' },
  { value: 'schedule', label: 'Schedule', blurb: 'A month calendar staff sign up on — like #scheduling.' },
  { value: 'catalog', label: 'Catalog', blurb: 'A sortable, searchable table — like #bean library.' },
  { value: 'orders', label: 'Orders', blurb: 'Paste-an-order → roast → deliver — like #wholesale.' },
];

export type OpenTarget = {
  id: string;
  view?: 'board' | 'notes' | 'chat';
  noteId?: string;
};

export function Home({ onOpen }: { onOpen: (t: OpenTarget) => void }) {
  const { state, me, switchTeam, addTeam, addChannel, toggleFavorite } = useStore();
  const team = state.teams.find((t) => t.id === state.currentTeamId) ?? state.teams[0];
  const channels = state.channels.filter((c) => c.teamId === team.id);
  const [showTeams, setShowTeams] = useState(false);
  const [newTeam, setNewTeam] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [chName, setChName] = useState('');
  const [chEmoji, setChEmoji] = useState('💬');
  const [chType, setChType] = useState<NewChannelType>('chat');
  const [chSections, setChSections] = useState('');
  const [q, setQ] = useState('');
  const [editFav, setEditFav] = useState(false);

  const favIds = favoritesFor(state, me.id);
  const favChannels = favIds
    .map((id) => channels.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => !!c);
  const restChannels = channels.filter((c) => !favIds.includes(c.id));

  // Orders anywhere on this team that are roasted and waiting on a run —
  // the one thing worth a banner because someone has to physically act.
  const readyOrders = state.orders.filter(
    (o) => channels.some((c) => c.id === o.channelId) && o.stage === 'ready'
  );

  const createChannel = (e: React.FormEvent) => {
    e.preventDefault();
    const n = chName.trim();
    if (!n) return;
    const lists =
      chType === 'board'
        ? chSections
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((title) => ({ title }))
        : undefined;
    addChannel(team.id, n, chEmoji, chType, lists);
    setChName('');
    setChSections('');
    setChType('chat');
    setShowNew(false);
  };

  const preview = (channelId: string, type: string): string => {
    if (type === 'schedule') {
      const n = state.signups.filter((s) => s.channelId === channelId).length;
      return n ? `${n} shift${n === 1 ? '' : 's'} on the books` : 'Nobody scheduled yet';
    }
    if (type === 'notes') {
      const n = state.notes.filter((x) => x.channelId === channelId).length;
      return n ? `${n} page${n === 1 ? '' : 's'}` : 'Empty — add your first page';
    }
    if (type === 'board') {
      const open = state.listItems.filter((i) => i.channelId === channelId && !i.done).length;
      return open ? `${open} open item${open === 1 ? '' : 's'}` : 'All caught up ✨';
    }
    if (type === 'catalog') {
      const n = state.catalogItems.filter((c) => c.channelId === channelId).length;
      return n ? `${n} bean${n === 1 ? '' : 's'} on file` : 'Empty — add your first bean';
    }
    if (type === 'orders') {
      const os = state.orders.filter((o) => o.channelId === channelId);
      const roast = os.filter((o) => o.stage === 'roast').length;
      const ready = os.filter((o) => o.stage === 'ready').length;
      if (!roast && !ready) return 'All orders out the door ✨';
      return [roast && `${roast} to roast`, ready && `${ready} to deliver`]
        .filter(Boolean)
        .join(' · ');
    }
    const msgs = state.messages.filter((m) => m.channelId === channelId);
    const last = msgs[msgs.length - 1];
    if (!last) return 'Nothing brewing yet — say hi!';
    const who = state.users.find((u) => u.id === last.userId)?.name ?? '?';
    const plain = last.text.replace(/[*`#]/g, '').replace(/\n/g, ' ');
    return `${who}: ${plain.length > 48 ? plain.slice(0, 48) + '…' : plain}`;
  };

  // Tile status = the list preview plus whether it represents pending
  // work (rendered in accent so the eye lands on it).
  const tileStatus = (c: (typeof channels)[number]) => {
    const text = preview(c.id, c.type);
    let urgent = false;
    if (c.type === 'orders') {
      urgent = state.orders.some(
        (o) => o.channelId === c.id && (o.stage === 'ready' || o.stage === 'roast')
      );
    } else if (c.type === 'board') {
      urgent = state.listItems.some((i) => i.channelId === c.id && !i.done);
    }
    return { text, urgent };
  };

  // Global search across everything the current user can see.
  type Result = { key: string; emoji: string; title: string; sub: string; go: OpenTarget };
  const results = useMemo<Result[]>(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const hit = (s: string) => s.toLowerCase().includes(needle);
    const teamIds = new Set(channels.map((c) => c.id));
    const visible = (cid: string) => {
      if (teamIds.has(cid)) return true;
      const c = state.channels.find((x) => x.id === cid);
      return c?.type === 'dm' && !!c.memberIds?.includes(me.id);
    };
    const chanName = (cid: string) => {
      const c = state.channels.find((x) => x.id === cid);
      if (!c) return '?';
      if (c.type === 'dm') return '🔒 private';
      return `${c.emoji} ${c.name}`;
    };
    const out: Result[] = [];
    for (const c of channels.filter((c) => hit(c.name) || hit(c.description))) {
      out.push({ key: 'c' + c.id, emoji: c.emoji, title: c.name, sub: 'Channel', go: { id: c.id } });
    }
    for (const m of state.messages.filter((m) => visible(m.channelId) && hit(m.text)).slice(-8).reverse()) {
      const who = state.users.find((u) => u.id === m.userId)?.name ?? '?';
      out.push({
        key: 'm' + m.id,
        emoji: '💬',
        title: m.text.replace(/[*`#\n]/g, ' ').slice(0, 60),
        sub: `${who} · in ${chanName(m.channelId)}`,
        go: { id: m.channelId, view: 'chat' },
      });
    }
    for (const n of state.notes.filter((n) => visible(n.channelId) && (hit(n.title) || hit(n.body))).slice(0, 6)) {
      out.push({
        key: 'n' + n.id,
        emoji: '📖',
        title: n.title,
        sub: `Page · in ${chanName(n.channelId)}`,
        go: { id: n.channelId, view: 'notes', noteId: n.id },
      });
    }
    for (const i of state.listItems.filter((i) => visible(i.channelId) && hit(i.text)).slice(0, 6)) {
      out.push({
        key: 'i' + i.id,
        emoji: i.done ? '✅' : '⬜️',
        title: i.text.replace(/[*`#]/g, ''),
        sub: `List item · in ${chanName(i.channelId)}`,
        go: { id: i.channelId, view: 'board' },
      });
    }
    for (const c of state.catalogItems.filter(
      (c) => visible(c.channelId) && hit([c.name, c.origin, c.roast, c.flavor, c.certs, c.notes].join(' '))
    )) {
      out.push({
        key: 'b' + c.id,
        emoji: '🫘',
        title: c.name,
        sub: `${c.roast || 'Bean'} · in ${chanName(c.channelId)}`,
        go: { id: c.channelId, view: 'board' },
      });
    }
    for (const o of state.orders.filter(
      (o) => visible(o.channelId) && (hit(o.title) || o.items.some((i) => hit(i.text)))
    )) {
      out.push({
        key: 'o' + o.id,
        emoji: '🧾',
        title: o.title,
        sub: `Order (${o.stage === 'roast' ? 'to roast' : o.stage === 'ready' ? 'ready to deliver' : 'delivered'})`,
        go: { id: o.channelId, view: 'board' },
      });
    }
    return out.slice(0, 24);
  }, [q, channels, state, me.id]);

  return (
    <div className="screen">
      <header className="large-header">
        <button className="team-title" onClick={() => setShowTeams(true)}>
          <h1>
            {team.emoji} {team.name}
          </h1>
          <span className="chev">▾</span>
        </button>
      </header>

      <div className="search-wrap">
        <input
          className="search-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search messages, pages, beans, orders…"
        />
        {q && (
          <button className="link" onClick={() => setQ('')}>
            Cancel
          </button>
        )}
      </div>

      {q.trim() ? (
        <div className="list-group">
          {results.length === 0 && (
            <p className="hint search-none">Nothing found for “{q.trim()}” 🕵️</p>
          )}
          {results.map((r) => (
            <button
              key={r.key}
              className="row"
              onClick={() => {
                onOpen(r.go);
                setQ('');
              }}
            >
              <span className="row-emoji">{r.emoji}</span>
              <span className="row-body">
                <span className="row-title">{r.title}</span>
                <span className="row-sub">{r.sub}</span>
              </span>
              <span className="chevron">›</span>
            </button>
          ))}
        </div>
      ) : editFav ? (
        <div className="fav-edit">
          <div className="qa-head">
            <span className="qa-head-title">
              Star up to {MAX_FAVORITES} for quick access ({favIds.length}/{MAX_FAVORITES})
            </span>
            <button className="link" onClick={() => setEditFav(false)}>
              Done
            </button>
          </div>
          <div className="list-group">
            {channels.map((c) => {
              const on = favIds.includes(c.id);
              const disabled = !on && favIds.length >= MAX_FAVORITES;
              return (
                <button
                  key={c.id}
                  className={'row fav-row' + (disabled ? ' fav-disabled' : '')}
                  onClick={() => !disabled && toggleFavorite(c.id)}
                >
                  <span className={'fav-star' + (on ? ' fav-on' : '')}>
                    {on ? '★' : '☆'}
                  </span>
                  <span className="row-emoji">{c.emoji}</span>
                  <span className="row-body">
                    <span className="row-title">{c.name}</span>
                  </span>
                </button>
              );
            })}
            {me.role === 'admin' && (
              <button className="row row-new" onClick={() => setShowNew(true)}>
                <span className="row-emoji">＋</span>
                <span className="row-body">
                  <span className="row-title">New channel</span>
                  <span className="row-sub">Chat, checklist, pages, schedule, catalog, or orders</span>
                </span>
              </button>
            )}
          </div>
          <p className="footnote">
            Star a channel to pin it as a tile · tap ＋ to make a new one.
          </p>
        </div>
      ) : (
        <>
          {readyOrders.length > 0 && (
            <button
              className="attn-strip"
              onClick={() => onOpen({ id: readyOrders[0].channelId, view: 'board' })}
            >
              <span className="attn-emoji">🚚</span>
              <span className="attn-text">
                <strong>
                  {readyOrders.length} order{readyOrders.length === 1 ? '' : 's'} ready to
                  deliver
                </strong>{' '}
                — {readyOrders.map((o) => o.title).slice(0, 2).join(', ')}
                {readyOrders.length > 2 ? '…' : ''}
              </span>
              <span className="chevron">›</span>
            </button>
          )}

          {favChannels.length > 0 && (
            <>
              <div className="qa-head">
                <span className="qa-head-title">Quick access</span>
                <button className="link" onClick={() => setEditFav(true)}>
                  Edit
                </button>
              </div>
              <div className="qa-grid">
                {favChannels.map((c) => {
                  const st = tileStatus(c);
                  return (
                    <button
                      key={c.id}
                      className="qa-tile"
                      onClick={() => onOpen({ id: c.id })}
                    >
                      <span className="qa-emoji">{c.emoji}</span>
                      <span className="qa-name">{c.name}</span>
                      <span className={'qa-status' + (st.urgent ? ' qa-urgent' : '')}>
                        {st.text}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <div className="list-group">
            {restChannels.map((c) => (
              <button key={c.id} className="row" onClick={() => onOpen({ id: c.id })}>
                <span className="row-emoji">{c.emoji}</span>
                <span className="row-body">
                  <span className="row-title">{c.name}</span>
                  <span className="row-sub">{preview(c.id, c.type)}</span>
                </span>
                <span className="chevron">›</span>
              </button>
            ))}
          </div>
          {me.role === 'admin' && (
            <p className="footnote">
              Tap <button className="link" onClick={() => setEditFav(true)}>Edit</button> to
              pin tiles or add a new channel.
            </p>
          )}
        </>
      )}

      {showNew && (
        <div className="sheet-backdrop" onClick={() => setShowNew(false)}>
          <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={createChannel}>
            <div className="sheet-handle" />
            <h2>New channel</h2>
            <input
              value={chName}
              onChange={(e) => setChName(e.target.value)}
              placeholder="Channel name, e.g. deliveries"
              autoFocus
            />
            <div className="emoji-pick">
              {CHANNEL_EMOJI.map((e) => (
                <button
                  type="button"
                  key={e}
                  className={'emoji-opt' + (e === chEmoji ? ' picked' : '')}
                  onClick={() => setChEmoji(e)}
                >
                  {e}
                </button>
              ))}
            </div>
            <div className="sort-chips">
              {TYPE_OPTIONS.map((t) => (
                <button
                  type="button"
                  key={t.value}
                  className={'sort-chip' + (chType === t.value ? ' chip-on' : '')}
                  onClick={() => setChType(t.value)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="hint">{TYPE_OPTIONS.find((t) => t.value === chType)?.blurb}</p>
            {chType === 'board' && (
              <input
                value={chSections}
                onChange={(e) => setChSections(e.target.value)}
                placeholder="Sections, comma-separated (e.g. To Do, Done)"
              />
            )}
            <button className="btn primary big" type="submit" disabled={!chName.trim()}>
              Create {chEmoji} {chName.trim() || '…'}
            </button>
          </form>
        </div>
      )}

      {showTeams && (
        <div className="sheet-backdrop" onClick={() => setShowTeams(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <h2>Your teams</h2>
            {state.teams.map((t) => (
              <button
                key={t.id}
                className="row"
                onClick={() => {
                  switchTeam(t.id);
                  setShowTeams(false);
                }}
              >
                <span className="row-emoji">{t.emoji}</span>
                <span className="row-body">
                  <span className="row-title">{t.name}</span>
                </span>
                {t.id === team.id && <span className="check-mark">✓</span>}
              </button>
            ))}
            <form
              className="add-row"
              onSubmit={(e) => {
                e.preventDefault();
                const n = newTeam.trim();
                if (!n) return;
                addTeam(n, '🫖');
                setNewTeam('');
                setShowTeams(false);
              }}
            >
              <input
                value={newTeam}
                onChange={(e) => setNewTeam(e.target.value)}
                placeholder="New team name…"
              />
              <button type="submit">+</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
