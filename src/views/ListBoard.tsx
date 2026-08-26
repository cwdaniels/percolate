import React, { useState } from 'react';
import { useStore } from '../store';
import { Markdown } from '../markdown';
import type { Channel } from '../types';
import { buildOrderText, buildMailto, looksLikeEmail } from '../lib/listexport';

// Local-midnight YYYY-MM-DD, matching what a bare <input type="date"> both
// shows and expects — comparing this to ISO date strings elsewhere in the
// app is what lets "due today" line up with the Schedule calendar's cells.
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function dueLabel(due: string): { text: string; overdue: boolean } {
  const today = todayStr();
  if (due === today) return { text: 'Due today', overdue: false };
  if (due < today) return { text: 'Overdue', overdue: true };
  const d = new Date(due + 'T12:00:00');
  return {
    text: `Due ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
    overdue: false,
  };
}

export function ListBoard({ channel }: { channel: Channel }) {
  const { state, me, addListItem, toggleListItem, editListItemDetails, clearDone, setListEmail } =
    useStore();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [copyErr, setCopyErr] = useState('');
  const [emailFor, setEmailFor] = useState<string | null>(null);
  const [emailVal, setEmailVal] = useState('');
  const [emailErr, setEmailErr] = useState('');
  const [sentNote, setSentNote] = useState('');
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  const teamName =
    state.teams.find((t) => t.id === channel.teamId)?.name ?? 'Percolate';
  const lists = channel.lists ?? [];

  const openItemsFor = (listId: string) =>
    state.listItems
      .filter((i) => i.channelId === channel.id && i.listId === listId && !i.done)
      .sort((a, b) => a.ts - b.ts);

  const copy = async (key: string, text: string) => {
    setCopyErr('');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000);
    } catch {
      // Clipboard access can be refused (odd browser, insecure context) —
      // say so rather than silently doing nothing.
      setCopyErr('Couldn’t reach the clipboard. Try again, or copy by hand.');
    }
  };

  const emailOrder = async (list: { id: string; title: string; orderEmail?: string }) => {
    const to = list.orderEmail;
    if (!to) return;
    setCopyErr('');
    setSentNote('');
    const body = buildOrderText(list.title, teamName, [
      { title: list.title, items: openItemsFor(list.id) },
    ]);
    const subject = `${list.title} order — ${teamName}`;
    const plan = buildMailto(to, subject, body);
    if (plan.viaClipboard) {
      // Too long to survive a mailto: — hand it over via the clipboard
      // rather than letting the mail client quietly truncate the order.
      try {
        await navigator.clipboard.writeText(body);
        setSentNote('That list is long, so it’s on your clipboard — paste it into the email.');
      } catch {
        setCopyErr('List is too long to put in an email link, and the clipboard refused. Use Copy instead.');
        return;
      }
    }
    window.location.href = plan.url;
  };

  const saveEmail = async (listId: string) => {
    const v = emailVal.trim();
    if (v && !looksLikeEmail(v)) {
      setEmailErr('That doesn’t look like an email address.');
      return;
    }
    setEmailErr('');
    const res = await setListEmail(channel.id, listId, v);
    if (res.error) setEmailErr(res.error);
    else setEmailFor(null);
  };

  const totalOpen = lists.reduce((n, l) => n + openItemsFor(l.id).length, 0);

  return (
    <div className="screen-pad">
      {lists.map((list) => {
        const items = state.listItems
          .filter((i) => i.channelId === channel.id && i.listId === list.id)
          .sort((a, b) => Number(a.done) - Number(b.done) || a.ts - b.ts);
        const doneCount = items.filter((i) => i.done).length;
        const open = openItemsFor(list.id);
        return (
          <section className="card" key={list.id}>
            <div className="card-head">
              <h3>
                {list.emoji} {list.title}
              </h3>
              <div className="head-actions">
                {open.length > 0 && (
                  <button
                    className="link"
                    onClick={() =>
                      copy(
                        list.id,
                        buildOrderText(list.title, teamName, [
                          { title: list.title, items: open },
                        ])
                      )
                    }
                  >
                    {copied === list.id ? 'Copied ✓' : `Copy ${open.length} 📋`}
                  </button>
                )}
                {doneCount > 0 && me.role === 'admin' && (
                  <button className="link" onClick={() => clearDone(channel.id, list.id)}>
                    Clear {doneCount} done
                  </button>
                )}
              </div>
            </div>
            {items.length === 0 && (
              <p className="hint">Nothing here yet — the shelf is bare 🕸️</p>
            )}
            {items.map((item) => {
              const by = state.users.find((u) => u.id === item.addedBy);
              const assignee = item.assignedTo
                ? state.users.find((u) => u.id === item.assignedTo)
                : undefined;
              const due = item.dueDate && !item.done ? dueLabel(item.dueDate) : undefined;
              const open = expandedItem === item.id;
              return (
                <div key={item.id} className={'item-block' + (item.done ? ' item-done' : '')}>
                  <div className="item">
                    <button
                      className={'check' + (item.done ? ' check-on' : '')}
                      onClick={() => toggleListItem(item.id)}
                      aria-label={item.done ? 'Uncheck' : 'Check off'}
                    >
                      {item.done ? '✓' : ''}
                    </button>
                    <button
                      className="item-body item-body-btn"
                      onClick={() => setExpandedItem(open ? null : item.id)}
                    >
                      <Markdown text={item.text} />
                      <span className="item-badges">
                        <span className="by">{by?.name ?? '?'}</span>
                        {due && (
                          <span className={'item-badge' + (due.overdue ? ' item-badge-due' : '')}>
                            📅 {due.text}
                          </span>
                        )}
                        {assignee && <span className="item-badge">📌 {assignee.name}</span>}
                      </span>
                    </button>
                  </div>

                  {open && (
                    <div className="item-detail">
                      <label className="field-label">Due date</label>
                      <div className="form-grid">
                        <input
                          type="date"
                          value={item.dueDate ?? ''}
                          onChange={(e) =>
                            editListItemDetails(item.id, { dueDate: e.target.value || null })
                          }
                        />
                        {item.dueDate && (
                          <button
                            className="btn ghost small"
                            onClick={() => editListItemDetails(item.id, { dueDate: null })}
                          >
                            Clear
                          </button>
                        )}
                      </div>
                      <p className="hint">Shows up on the team's Schedule calendar.</p>

                      <label className="field-label">Assign to</label>
                      <select
                        value={item.assignedTo ?? ''}
                        onChange={(e) =>
                          editListItemDetails(item.id, { assignedTo: e.target.value || null })
                        }
                      >
                        <option value="">Nobody in particular</option>
                        {state.users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                      {assignee && item.assignedBy && (
                        <p className="hint">
                          Assigned by{' '}
                          {state.users.find((u) => u.id === item.assignedBy)?.name ?? '?'}
                        </p>
                      )}

                      <label className="field-label">Notes</label>
                      <textarea
                        defaultValue={item.notes ?? ''}
                        onBlur={(e) => editListItemDetails(item.id, { notes: e.target.value })}
                        placeholder="Any detail worth keeping with this item…"
                        rows={2}
                      />
                    </div>
                  )}
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

            {emailFor === list.id ? (
              <div className="rate-editor">
                <input
                  type="email"
                  inputMode="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={emailVal}
                  onChange={(e) => setEmailVal(e.target.value)}
                  placeholder="orders@supplier.com"
                  autoFocus
                />
                <p className="hint">
                  Orders from <strong>{list.title}</strong> get emailed here.
                  Leave blank to remove.
                </p>
                {emailErr && <p className="hint error-hint">{emailErr}</p>}
                <div className="btn-row">
                  <button className="btn ghost small" onClick={() => setEmailFor(null)}>
                    Cancel
                  </button>
                  <button className="btn primary small" onClick={() => saveEmail(list.id)}>
                    Save
                  </button>
                </div>
              </div>
            ) : (
              (list.orderEmail || me.role === 'admin') && (
                <div className="list-actions">
                  {list.orderEmail && open.length > 0 && (
                    <button className="btn primary small" onClick={() => emailOrder(list)}>
                      ✉️ Email {open.length} to {list.orderEmail.split('@')[0]}
                    </button>
                  )}
                  {me.role === 'admin' && (
                    <button
                      className="link"
                      onClick={() => {
                        setEmailFor(list.id);
                        setEmailVal(list.orderEmail ?? '');
                        setEmailErr('');
                      }}
                    >
                      {list.orderEmail ? 'Change supplier' : 'Set supplier email'}
                    </button>
                  )}
                </div>
              )
            )}
          </section>
        );
      })}

      {lists.length > 1 && totalOpen > 0 && (
        <button
          className="btn primary"
          onClick={() =>
            copy(
              '__all__',
              buildOrderText(
                channel.name,
                teamName,
                lists.map((l) => ({
                  title: `${l.emoji} ${l.title}`,
                  items: openItemsFor(l.id),
                }))
              )
            )
          }
        >
          {copied === '__all__' ? 'Copied ✓' : `Copy all ${totalOpen} open items 📋`}
        </button>
      )}

      {sentNote && <p className="hint granted">{sentNote}</p>}
      {copyErr && <p className="hint error-hint">{copyErr}</p>}

      <p className="footnote">
        Anyone can add or check off. Copy grabs the <strong>unchecked</strong>{' '}
        items as plain text, ready to paste into an order email — checked-off
        things are left out so you don’t re-order them.
      </p>
    </div>
  );
}
