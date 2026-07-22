import React, { useState } from 'react';
import { useStore, mentionsFor, dmIdFor } from '../store';
import { Markdown } from '../markdown';
import { Avatar, EmptyState, Segmented } from '../ui';

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

type Filter = 'all' | 'unread' | 'archived';

export function Mentions({ onOpen }: { onOpen: (channelId: string) => void }) {
  const { state, me } = useStore();
  const [side, setSide] = useState<'mentions' | 'private'>('mentions');

  return (
    <div className="screen">
      <header className="large-header">
        <h1>@ Mentions</h1>
      </header>
      <div className="screen-pad">
        <Segmented
          options={[
            { value: 'mentions' as const, label: 'Mentions' },
            { value: 'private' as const, label: 'Private' },
          ]}
          value={side}
          onChange={setSide}
        />
        {side === 'mentions' ? (
          <MentionList onOpen={onOpen} />
        ) : (
          <PrivateThreads onOpen={onOpen} />
        )}
      </div>
    </div>
  );
}

function MentionList({ onOpen }: { onOpen: (channelId: string) => void }) {
  const { state, me, setMentionMeta } = useStore();
  const [filter, setFilter] = useState<Filter>('all');
  const meta = state.mentionMeta[me.id] ?? {};

  const mentions = mentionsFor(state, me.id).filter((m) => {
    const mm = meta[m.id];
    if (mm?.deleted) return false;
    if (filter === 'archived') return !!mm?.archived;
    if (mm?.archived) return false;
    if (filter === 'unread') return !mm?.read;
    return true;
  });

  return (
    <>
      <div className="sort-chips">
        {(['all', 'unread', 'archived'] as Filter[]).map((f) => (
          <button
            key={f}
            className={'sort-chip' + (filter === f ? ' chip-on' : '')}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'All' : f === 'unread' ? 'Unread' : 'Archived'}
          </button>
        ))}
      </div>
      {mentions.length === 0 && (
        <EmptyState
          emoji={filter === 'archived' ? '🗄️' : '👋'}
          title={filter === 'archived' ? 'Nothing archived' : 'No mentions here'}
          hint={
            filter === 'archived'
              ? 'Archived mentions keep out of the way but stay findable.'
              : 'When a teammate @mentions you — or posts to @team — it lands here.'
          }
        />
      )}
      {mentions.map((m) => {
        const author = state.users.find((u) => u.id === m.userId);
        const channel = state.channels.find((c) => c.id === m.channelId);
        const mm = meta[m.id];
        return (
          <div key={m.id} className={'card mention-card' + (!mm?.read ? ' mention-new' : '')}>
            <button
              className="mention-open"
              onClick={() => {
                setMentionMeta(m.id, { read: true });
                onOpen(m.channelId);
              }}
            >
              <div className="mention-top">
                {author && <Avatar user={author} size={26} />}
                <span className="mention-author">{author?.name ?? '?'}</span>
                <span className="mention-chan">
                  in {channel?.emoji} {channel?.name ?? '?'}
                </span>
                <span className="mention-time">
                  {!mm?.read && <span className="new-dot" aria-label="unread" />}
                  {relativeTime(m.ts)}
                </span>
              </div>
              <div className="mention-text">
                <Markdown text={m.text} />
              </div>
            </button>
            <div className="mention-actions">
              <button className="link" onClick={() => setMentionMeta(m.id, { read: !mm?.read })}>
                {mm?.read ? 'Mark unread' : '✓ Mark read'}
              </button>
              <button
                className="link"
                onClick={() => setMentionMeta(m.id, { archived: !mm?.archived, read: true })}
              >
                {mm?.archived ? 'Unarchive' : '🗄️ Archive'}
              </button>
              <button
                className="link danger"
                onClick={() => setMentionMeta(m.id, { deleted: true })}
              >
                Delete
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}

function PrivateThreads({ onOpen }: { onOpen: (channelId: string) => void }) {
  const { state, me, ensureDm } = useStore();
  const [composing, setComposing] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const reads = state.threadReadAt[me.id] ?? {};

  const threads = state.channels
    .filter((c) => c.type === 'dm' && c.memberIds?.includes(me.id))
    .map((c) => {
      const others = c
        .memberIds!.filter((id) => id !== me.id)
        .map((id) => state.users.find((u) => u.id === id))
        .filter((u): u is NonNullable<typeof u> => !!u);
      const msgs = state.messages
        .filter((m) => m.channelId === c.id)
        .sort((a, b) => a.ts - b.ts);
      const last = msgs[msgs.length - 1];
      const lastFromOthers = msgs.filter((m) => m.userId !== me.id).pop();
      const unread = !!lastFromOthers && lastFromOthers.ts > (reads[c.id] ?? 0);
      return { channel: c, others, last, unread };
    })
    .filter((t) => t.others.length > 0)
    .sort((a, b) => (b.last?.ts ?? b.channel.id.length) - (a.last?.ts ?? a.channel.id.length));

  const start = () => {
    if (picked.length === 0) return;
    ensureDm(picked);
    setComposing(false);
    setPicked([]);
    onOpen(dmIdFor([me.id, ...picked]));
  };

  return (
    <>
      <button className="btn primary" onClick={() => setComposing(true)}>
        New private message ✏️
      </button>

      {threads.length === 0 ? (
        <EmptyState
          emoji="🤫"
          title="No private threads yet"
          hint="Private messages stay between the people in them — they never appear in the team feed."
        />
      ) : (
        <div className="list-group">
          {threads.map((t) => (
            <button key={t.channel.id} className="row" onClick={() => onOpen(t.channel.id)}>
              <span className="thread-avatars">
                {t.others.slice(0, 2).map((u) => (
                  <Avatar key={u.id} user={u} size={t.others.length > 1 ? 26 : 40} />
                ))}
              </span>
              <span className="row-body">
                <span className="row-title">
                  {t.others.map((u) => u.name).join(', ')}
                  {t.unread && <span className="new-dot" aria-label="unread" />}
                </span>
                <span className="row-sub">
                  {t.last
                    ? `${t.last.userId === me.id ? 'You' : state.users.find((u) => u.id === t.last!.userId)?.name}: ${t.last.text.replace(/[*`#]/g, '').replace(/\n/g, ' ').slice(0, 44)}`
                    : 'Say hi ☕️'}
                </span>
              </span>
              {t.last && <span className="dm-time">{relativeTime(t.last.ts)}</span>}
              <span className="chevron">›</span>
            </button>
          ))}
        </div>
      )}
      <p className="footnote">
        🔒 Private threads are only visible to their members — with real
        accounts, that’s enforced by the server.
      </p>

      {composing && (
        <div className="sheet-backdrop" onClick={() => setComposing(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <h2>New private message</h2>
            <p className="hint">Pick one person — or several for a small group thread.</p>
            <div className="user-switch">
              {state.users
                .filter((u) => u.id !== me.id)
                .map((u) => (
                  <button
                    key={u.id}
                    className={'user-chip' + (picked.includes(u.id) ? ' chip-on' : '')}
                    onClick={() =>
                      setPicked((p) =>
                        p.includes(u.id) ? p.filter((x) => x !== u.id) : [...p, u.id]
                      )
                    }
                  >
                    <Avatar user={u} size={24} /> {u.name}
                  </button>
                ))}
            </div>
            <button className="btn primary big" onClick={start} disabled={picked.length === 0}>
              Start chatting {picked.length > 1 ? `(${picked.length} people)` : ''}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
