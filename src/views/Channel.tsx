import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { Markdown } from '../markdown';
import { Avatar, EmptyState, Segmented } from '../ui';
import type { Channel, Message } from '../types';
import { ScheduleBoard } from './ScheduleBoard';
import { ListBoard } from './ListBoard';
import { NotesBoard } from './NotesBoard';
import { CatalogBoard } from './CatalogBoard';
import { OrdersBoard } from './OrdersBoard';

export type ChannelViewMode = 'board' | 'notes' | 'chat';

const REACTIONS = ['☕️', '✅', '👍', '🎉', '👀', '😂'];
const CHANNEL_EMOJI = ['💬', '📦', '🔥', '📖', '📅', '🧾', '🎉', '🛠️', '🚚', '🧊', '🌱', '☕️'];

export function ChannelView({
  channelId,
  onBack,
  onOpen,
  initialView,
  initialNoteId,
}: {
  channelId: string;
  onBack: () => void;
  onOpen?: (id: string, view?: ChannelViewMode) => void;
  initialView?: ChannelViewMode;
  initialNoteId?: string;
}) {
  const { state, me, deleteChannel, renameChannel } = useStore();
  const channel = state.channels.find((c) => c.id === channelId);
  const [view, setView] = useState<ChannelViewMode>(
    initialView ??
      (channel?.type === 'chat' || channel?.type === 'dm'
        ? 'chat'
        : channel?.type === 'notes'
          ? 'notes'
          : 'board')
  );
  const [showSettings, setShowSettings] = useState(false);
  const [editName, setEditName] = useState('');
  const [editEmoji, setEditEmoji] = useState('💬');
  if (!channel) return null;

  const openSettings = () => {
    setEditName(channel.name);
    setEditEmoji(channel.emoji);
    setShowSettings(true);
  };

  const dmOthers =
    channel.type === 'dm'
      ? (channel.memberIds ?? [])
          .filter((id) => id !== me.id)
          .map((id) => state.users.find((u) => u.id === id))
          .filter((u): u is NonNullable<typeof u> => !!u)
      : [];
  const title =
    channel.type === 'dm' ? dmOthers.map((u) => u.name).join(', ') : channel.name;
  const titleEmoji = channel.type === 'dm' ? '🔒' : channel.emoji;

  const boardLabel =
    channel.type === 'schedule'
      ? 'Schedule'
      : channel.type === 'catalog'
        ? 'Library'
        : channel.type === 'orders'
          ? 'Orders'
          : 'Board';
  const segOptions =
    channel.type === 'notes'
      ? [
          { value: 'notes' as const, label: 'Pages' },
          { value: 'chat' as const, label: 'Chat' },
        ]
      : [
          { value: 'board' as const, label: boardLabel },
          { value: 'notes' as const, label: 'Notes' },
          { value: 'chat' as const, label: 'Chat' },
        ];

  return (
    <div className="push">
      <header className="bar">
        <button className="back" onClick={onBack}>
          <svg viewBox="0 0 24 24" width="24" height="24">
            <path
              d="M15 4l-8 8 8 8"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div className="bar-title">
          <span className="bar-emoji">{titleEmoji}</span> {title}
        </div>
        <div className="bar-right">
          {me.role === 'admin' && channel.type !== 'dm' && (
            <button
              className="bar-action"
              aria-label="Channel settings"
              onClick={openSettings}
            >
              <svg viewBox="0 0 24 24" width="21" height="21">
                <path
                  d="M4 20h4L18.5 9.5a2 2 0 0 0-2.8-2.8L5 17v3z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>
      </header>

      {showSettings && (
        <div className="sheet-backdrop" onClick={() => setShowSettings(false)}>
          <form
            className="sheet"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              const n = editName.trim();
              if (!n) return;
              renameChannel(channel.id, n, editEmoji);
              setShowSettings(false);
            }}
          >
            <div className="sheet-handle" />
            <h2>Channel settings</h2>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Channel name"
              autoFocus
            />
            <div className="emoji-pick">
              {CHANNEL_EMOJI.map((e) => (
                <button
                  type="button"
                  key={e}
                  className={'emoji-opt' + (e === editEmoji ? ' picked' : '')}
                  onClick={() => setEditEmoji(e)}
                >
                  {e}
                </button>
              ))}
            </div>
            <button className="btn primary big" type="submit" disabled={!editName.trim()}>
              Save
            </button>
            {!channel.isHome && (
              <button
                type="button"
                className="btn ghost danger"
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete #${channel.name} and everything in it? This can’t be undone.`
                    )
                  ) {
                    deleteChannel(channel.id);
                    onBack();
                  }
                }}
              >
                Delete channel
              </button>
            )}
          </form>
        </div>
      )}

      {channel.type !== 'chat' && channel.type !== 'dm' && (
        <div className="seg-wrap">
          <Segmented options={segOptions} value={view} onChange={setView} />
        </div>
      )}

      {view === 'chat' ? (
        <Chat channel={channel} onOpen={onOpen} />
      ) : view === 'notes' ? (
        <NotesBoard channel={channel} initialOpenId={initialNoteId} />
      ) : channel.type === 'schedule' ? (
        <ScheduleBoard channel={channel} />
      ) : channel.type === 'catalog' ? (
        <CatalogBoard channel={channel} />
      ) : channel.type === 'orders' ? (
        <OrdersBoard channel={channel} />
      ) : (
        <ListBoard channel={channel} />
      )}
    </div>
  );
}

type Burst = { channelId: string; msgs: Message[]; latest: number };
type TimelineItem =
  | { kind: 'msg'; msg: Message; ts: number }
  | { kind: 'burst'; burst: Burst; ts: number };

const BURST_GAP = 60 * 60 * 1000; // messages within an hour = one conversation
const FEED_WINDOW = 3 * 24 * 60 * 60 * 1000; // surface the last 3 days
const FEED_MAX = 6;

function Chat({
  channel,
  onOpen,
}: {
  channel: Channel;
  onOpen?: (id: string, view?: ChannelViewMode) => void;
}) {
  const { state, me, send, togglePin, editMessage, toggleReaction, markThreadRead } =
    useStore();
  const msgs = state.messages
    .filter((m) => m.channelId === channel.id)
    .sort((a, b) => a.ts - b.ts);
  const lastTs = msgs[msgs.length - 1]?.ts ?? 0;

  // Reading a private thread marks it read (drives the tab badge).
  useEffect(() => {
    if (channel.type === 'dm') markThreadRead(channel.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id, lastTs]);

  const dmNames =
    channel.type === 'dm'
      ? (channel.memberIds ?? [])
          .filter((id) => id !== me.id)
          .map((id) => state.users.find((u) => u.id === id)?.name ?? '?')
          .join(', ')
      : null;
  const [text, setText] = useState('');
  const [showHint, setShowHint] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [showPinned, setShowPinned] = useState(false);
  const [showFeed, setShowFeed] = useState(true);
  const [toast, setToast] = useState('');
  const msgsRef = useRef<HTMLDivElement>(null);

  const startEdit = (m: Message) => {
    setSelected(null);
    setEditingId(m.id);
    setEditText(m.text);
  };
  const saveEdit = () => {
    const t = editText.trim();
    if (editingId && t) editMessage(editingId, t);
    setEditingId(null);
    setEditText('');
  };

  const pinned = msgs.filter((m) => m.pinned);

  // Cross-channel conversation bursts for the team's home channel.
  const bursts = useMemo<Burst[]>(() => {
    if (!channel.isHome) return [];
    const siblings = state.channels.filter(
      (c) => c.teamId === channel.teamId && c.id !== channel.id
    );
    const out: Burst[] = [];
    for (const c of siblings) {
      const ms = state.messages
        .filter((m) => m.channelId === c.id)
        .sort((a, b) => a.ts - b.ts);
      let cur: Burst | null = null;
      for (const m of ms) {
        if (cur && m.ts - cur.latest < BURST_GAP) {
          cur.msgs.push(m);
          cur.latest = m.ts;
        } else {
          if (cur) out.push(cur);
          cur = { channelId: c.id, msgs: [m], latest: m.ts };
        }
      }
      if (cur) out.push(cur);
    }
    const cutoff = Date.now() - FEED_WINDOW;
    return out
      .filter((b) => b.latest > cutoff)
      .sort((a, b) => a.latest - b.latest)
      .slice(-FEED_MAX);
  }, [state.messages, state.channels, channel]);

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = msgs.map((m) => ({ kind: 'msg', msg: m, ts: m.ts }));
    if (showFeed) {
      for (const b of bursts) items.push({ kind: 'burst', burst: b, ts: b.latest });
    }
    return items.sort((a, b) => a.ts - b.ts);
  }, [msgs, bursts, showFeed]);

  // Pin the message list to the bottom BEFORE paint (useLayoutEffect +
  // scrollTop on the list itself). scrollIntoView scrolled ancestors and
  // reflowed mid slide-in, which is what made the transition look choppy.
  useLayoutEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [timeline.length]);

  // @mention autocomplete on the token being typed
  const mentionMatch = text.match(/@(\w*)$/);
  const query = mentionMatch ? mentionMatch[1].toLowerCase() : null;
  const userSuggestions =
    query !== null
      ? state.users.filter(
          (u) => u.id !== me.id && u.name.toLowerCase().startsWith(query)
        )
      : [];
  const teamSuggestion = query !== null && 'team'.startsWith(query);

  const applyMention = (name: string) => {
    setText(text.replace(/@\w*$/, `@${name} `));
  };

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    send(channel.id, t);
    const mentioned = state.users
      .filter((u) => new RegExp(`@${u.name}\\b`, 'i').test(t))
      .map((u) => u.name);
    if (/@(team|everyone|all)\b/i.test(t)) mentioned.push('the whole team');
    if (mentioned.length) {
      setToast(`🔔 ${mentioned.join(', ')} will get pinged once live sync is on`);
      setTimeout(() => setToast(''), 3000);
    }
    setText('');
  };

  return (
    <div className="chat">
      {pinned.length > 0 && (
        <div className="pinned-wrap">
          <button className="pinned-bar" onClick={() => setShowPinned(!showPinned)}>
            📌 {pinned.length} pinned {showPinned ? '▾' : '›'}
          </button>
          {showPinned &&
            pinned.map((m) => {
              const u = state.users.find((x) => x.id === m.userId);
              return (
                <div key={m.id} className="pinned-item">
                  <span className="pinned-author">{u?.name ?? '?'}</span>
                  <div className="pinned-body">
                    <Markdown text={m.text} />
                  </div>
                  <button className="del" onClick={() => togglePin(m.id)} aria-label="Unpin">
                    ✕
                  </button>
                </div>
              );
            })}
        </div>
      )}

      {channel.isHome && bursts.length > 0 && (
        <div className="feed-toggle">
          <span>✨ Around the roastery</span>
          <button className="link" onClick={() => setShowFeed(!showFeed)}>
            {showFeed ? 'Hide' : 'Show'}
          </button>
        </div>
      )}

      <div className="msgs" ref={msgsRef}>
        {timeline.length === 0 && (
          <EmptyState
            emoji="☕️"
            title="Nothing brewing yet"
            hint="Say hi — someone has to pour first."
          />
        )}
        {timeline.map((item, i) => {
          if (item.kind === 'burst') {
            return (
              <BurstCard
                key={'b' + item.burst.channelId + item.burst.latest}
                burst={item.burst}
                onOpen={onOpen}
              />
            );
          }
          const m = item.msg;
          const user = state.users.find((u) => u.id === m.userId);
          const prevItem = timeline[i - 1];
          const prev = prevItem && prevItem.kind === 'msg' ? prevItem.msg : null;
          const newGroup =
            !prev || prev.userId !== m.userId || m.ts - prev.ts > 5 * 60 * 1000;
          const mine = m.userId === me.id;
          return (
            <div key={m.id} className={'msg-row' + (mine ? ' mine' : '')}>
              {!mine && (
                <div className="msg-avatar">
                  {newGroup && user && <Avatar user={user} size={30} />}
                </div>
              )}
              <div className="msg-col">
                {newGroup && (
                  <div className="msg-meta">
                    {!mine && <span className="msg-name">{user?.name ?? '?'}</span>}
                    <span className="msg-time">
                      {new Date(m.ts).toLocaleTimeString(undefined, {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                    {m.pinned && <span className="msg-pin-flag">📌</span>}
                  </div>
                )}
                {editingId === m.id ? (
                  <div className="edit-box">
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          saveEdit();
                        }
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      rows={Math.min(6, Math.max(2, editText.split('\n').length))}
                      autoFocus
                    />
                    <div className="edit-actions">
                      <button className="link" onClick={() => setEditingId(null)}>
                        Cancel
                      </button>
                      <button className="link save" onClick={saveEdit} disabled={!editText.trim()}>
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className={'bubble' + (mine ? ' bubble-mine' : '')}
                    onClick={() => setSelected(selected === m.id ? null : m.id)}
                  >
                    <Markdown text={m.text} />
                    {m.edited && <span className="edited-tag">edited</span>}
                  </button>
                )}
                {m.reactions && Object.keys(m.reactions).length > 0 && (
                  <div className={'reactions' + (mine ? ' reactions-mine' : '')}>
                    {Object.entries(m.reactions).map(([emoji, ids]) => (
                      <button
                        key={emoji}
                        className={'reaction' + (ids.includes(me.id) ? ' reacted' : '')}
                        onClick={() => toggleReaction(m.id, emoji)}
                        title={ids
                          .map((id) => state.users.find((u) => u.id === id)?.name ?? '?')
                          .join(', ')}
                      >
                        {emoji} {ids.length}
                      </button>
                    ))}
                  </div>
                )}
                {selected === m.id && editingId !== m.id && (
                  <div className="msg-actions">
                    <div className="react-row">
                      {REACTIONS.map((emoji) => (
                        <button
                          key={emoji}
                          className="react-opt"
                          onClick={() => {
                            toggleReaction(m.id, emoji);
                            setSelected(null);
                          }}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                    <div className="action-row">
                      {mine && <button onClick={() => startEdit(m)}>Edit</button>}
                      <button
                        onClick={() => {
                          togglePin(m.id);
                          setSelected(null);
                        }}
                      >
                        {m.pinned ? 'Unpin' : '📌 Pin'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {toast && <div className="toast">{toast}</div>}

      <div className="composer">
        {showHint && (
          <div className="md-hint">
            <code>**bold**</code> · <code>*italic*</code> · <code>- bullet</code> ·{' '}
            <code>[link](url)</code> · <code>@name</code>
          </div>
        )}
        {(userSuggestions.length > 0 || teamSuggestion) && (
          <div className="mention-suggest">
            {teamSuggestion && (
              <button onClick={() => applyMention('team')}>📣 @team</button>
            )}
            {userSuggestions.slice(0, 4).map((u) => (
              <button key={u.id} onClick={() => applyMention(u.name)}>
                <Avatar user={u} size={20} /> @{u.name}
              </button>
            ))}
          </div>
        )}
        <div className="composer-row">
          <button
            className={'aa-btn' + (showHint ? ' aa-on' : '')}
            onClick={() => setShowHint(!showHint)}
            aria-label="Formatting help"
          >
            Aa
          </button>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={dmNames ? `Message ${dmNames}` : `Message #${channel.name}`}
            rows={Math.min(5, Math.max(1, text.split('\n').length))}
          />
          <button
            className="send-btn"
            onClick={submit}
            disabled={!text.trim()}
            aria-label="Send"
          >
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path
                d="M12 20V5M5 11l7-7 7 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function BurstCard({
  burst,
  onOpen,
}: {
  burst: Burst;
  onOpen?: (id: string, view?: ChannelViewMode) => void;
}) {
  const { state } = useStore();
  const c = state.channels.find((x) => x.id === burst.channelId);
  if (!c) return null;
  const last = burst.msgs[burst.msgs.length - 1];
  const lastUser = state.users.find((u) => u.id === last.userId);
  const names = [
    ...new Set(
      burst.msgs.map((m) => state.users.find((u) => u.id === m.userId)?.name ?? '?')
    ),
  ];
  const plain = last.text.replace(/[*`#]/g, '').replace(/\n+/g, ' ');
  return (
    <button className="burst" onClick={() => onOpen?.(c.id, 'chat')}>
      <span className="burst-head">
        <span className="burst-chan">
          {c.emoji} {c.name}
        </span>
        <span className="burst-count">
          {burst.msgs.length === 1
            ? '1 message'
            : `${burst.msgs.length} messages · ${names.join(', ')}`}
        </span>
      </span>
      <span className="burst-snippet">
        <b>{lastUser?.name ?? '?'}:</b>{' '}
        {plain.length > 110 ? plain.slice(0, 110) + '…' : plain}
      </span>
      <span className="burst-cta">Jump into #{c.name} ›</span>
    </button>
  );
}
