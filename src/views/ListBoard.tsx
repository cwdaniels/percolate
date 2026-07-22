import React, { useState } from 'react';
import { useStore } from '../store';
import { Markdown } from '../markdown';
import type { Channel } from '../types';

export function ListBoard({ channel }: { channel: Channel }) {
  const { state, me, addListItem, toggleListItem, clearDone } = useStore();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  return (
    <div className="screen-pad">
      {(channel.lists ?? []).map((list) => {
        const items = state.listItems
          .filter((i) => i.channelId === channel.id && i.listId === list.id)
          .sort((a, b) => Number(a.done) - Number(b.done) || a.ts - b.ts);
        const doneCount = items.filter((i) => i.done).length;
        return (
          <section className="card" key={list.id}>
            <div className="card-head">
              <h3>
                {list.emoji} {list.title}
              </h3>
              {doneCount > 0 && me.role === 'admin' && (
                <button
                  className="link"
                  onClick={() => clearDone(channel.id, list.id)}
                >
                  Clear {doneCount} done
                </button>
              )}
            </div>
            {items.length === 0 && (
              <p className="hint">Nothing here yet — the shelf is bare 🕸️</p>
            )}
            {items.map((item) => {
              const by = state.users.find((u) => u.id === item.addedBy);
              return (
                <div key={item.id} className={'item' + (item.done ? ' item-done' : '')}>
                  <button
                    className={'check' + (item.done ? ' check-on' : '')}
                    onClick={() => toggleListItem(item.id)}
                    aria-label={item.done ? 'Uncheck' : 'Check off'}
                  >
                    {item.done ? '✓' : ''}
                  </button>
                  <div className="item-body">
                    <Markdown text={item.text} />
                    <span className="by">{by?.name ?? '?'}</span>
                  </div>
                </div>
              );
            })}
            <form
              className="add-row"
              onSubmit={(e) => {
                e.preventDefault();
                const t = (drafts[list.id] ?? '').trim();
                if (!t) return;
                addListItem(channel.id, list.id, t);
                setDrafts((d) => ({ ...d, [list.id]: '' }));
              }}
            >
              <input
                value={drafts[list.id] ?? ''}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, [list.id]: e.target.value }))
                }
                placeholder={`Add to ${list.title}…`}
              />
              <button type="submit">+</button>
            </form>
          </section>
        );
      })}
      <p className="footnote">
        Anyone can add or check off. Tip: use **bold** for customer names.
      </p>
    </div>
  );
}
