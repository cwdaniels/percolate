import React, { useState } from 'react';
import { useStore } from '../store';
import { Markdown, toggleTaskInText } from '../markdown';
import { EmptyState } from '../ui';
import type { Channel, Note } from '../types';

export function NotesBoard({
  channel,
  initialOpenId,
}: {
  channel: Channel;
  initialOpenId?: string;
}) {
  const { state, addNote, updateNote, deleteNote } = useStore();
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const notes = state.notes
    .filter((n) => n.channelId === channel.id)
    .filter(
      (n) =>
        !needle ||
        n.title.toLowerCase().includes(needle) ||
        n.body.toLowerCase().includes(needle)
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const [openId, setOpenId] = useState<string | null>(initialOpenId ?? null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const open = state.notes.find((n) => n.id === openId) ?? null;

  const startNew = () => {
    setOpenId(null);
    setTitle('');
    setBody('');
    setEditing(true);
  };

  const startEdit = (n: Note) => {
    setTitle(n.title);
    setBody(n.body);
    setEditing(true);
  };

  const save = () => {
    const t = title.trim();
    if (!t) return;
    if (open) updateNote(open.id, t, body);
    else addNote(channel.id, t, body);
    setEditing(false);
  };

  const remove = () => {
    if (open && window.confirm(`Delete “${open.title}”? This can’t be undone.`)) {
      deleteNote(open.id);
      setEditing(false);
      setOpenId(null);
    }
  };

  if (editing) {
    return (
      <div className="screen-pad">
        <div className="card note-editor">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Note title"
            autoFocus
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={
              'Write it down…\n\n**bold**, *italic*, - bullets, [links](url)\n- [ ] a to-do   - [x] done'
            }
            rows={12}
          />
          <div className="btn-row">
            <button className="btn ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
            {open && (
              <button className="btn ghost danger" onClick={remove}>
                Delete
              </button>
            )}
            <button className="btn primary" onClick={save} disabled={!title.trim()}>
              Save
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (open) {
    const by = state.users.find((u) => u.id === open.updatedBy);
    return (
      <div className="screen-pad">
        <div className="card note-view">
          <div className="card-head">
            <h3>{open.title}</h3>
            <button className="link" onClick={() => startEdit(open)}>
              Edit
            </button>
          </div>
          <Markdown
            text={open.body}
            onToggleTask={(i) =>
              updateNote(open.id, open.title, toggleTaskInText(open.body, i))
            }
          />
          <span className="note-meta">
            Updated by {by?.name ?? '?'} ·{' '}
            {new Date(open.updatedAt).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            })}
          </span>
        </div>
        <button className="btn ghost" onClick={() => setOpenId(null)}>
          ‹ All pages
        </button>
      </div>
    );
  }

  return (
    <div className="screen-pad">
      <input
        className="search-input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search pages…"
      />
      {notes.length === 0 && (
        <EmptyState
          emoji={needle ? '🔍' : '📖'}
          title={needle ? 'No pages match' : 'No pages yet'}
          hint={
            needle
              ? 'Try a different search.'
              : 'Recipes, cheat sheets, how-tos — write down the things everyone keeps asking you.'
          }
        />
      )}
      {notes.map((n) => {
        const by = state.users.find((u) => u.id === n.updatedBy);
        const preview = n.body.replace(/[*`#\-\[\]]/g, '').replace(/\n+/g, ' · ');
        return (
          <button key={n.id} className="card note-card" onClick={() => setOpenId(n.id)}>
            <span className="note-title">{n.title}</span>
            <span className="note-preview">
              {preview.length > 90 ? preview.slice(0, 90) + '…' : preview}
            </span>
            <span className="note-meta">
              {by?.name ?? '?'} ·{' '}
              {new Date(n.updatedAt).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}
            </span>
          </button>
        );
      })}
      <button className="btn primary" onClick={startNew}>
        New page ✏️
      </button>
      <p className="footnote">
        Good for recipes and how-tos. Please keep passwords in the password
        manager, not here 🔐
      </p>
    </div>
  );
}
