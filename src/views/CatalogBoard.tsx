import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { EmptyState } from '../ui';
import type { CatalogItem, Channel } from '../types';

type SortKey = 'name' | 'origin' | 'roast' | 'updated';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'origin', label: 'Origin' },
  { key: 'roast', label: 'Roast' },
  { key: 'updated', label: 'Recent' },
];

const EMPTY_FIELDS = { name: '', origin: '', roast: '', flavor: '', certs: '', notes: '' };

export function CatalogBoard({ channel }: { channel: Channel }) {
  const { state, addCatalogItem, updateCatalogItem, deleteCatalogItem } = useStore();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('name');
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [fields, setFields] = useState(EMPTY_FIELDS);

  const items = useMemo(() => {
    const mine = state.catalogItems.filter((c) => c.channelId === channel.id);
    const needle = q.trim().toLowerCase();
    const hit = (c: CatalogItem) =>
      !needle ||
      [c.name, c.origin, c.roast, c.flavor, c.certs, c.notes]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    const sorted = mine.filter(hit).sort((a, b) => {
      if (sort === 'updated') return b.updatedAt - a.updatedAt;
      return a[sort].localeCompare(b[sort]);
    });
    return sorted;
  }, [state.catalogItems, channel.id, q, sort]);

  const startNew = () => {
    setFields(EMPTY_FIELDS);
    setEditing('new');
  };
  const startEdit = (c: CatalogItem) => {
    setFields({ name: c.name, origin: c.origin, roast: c.roast, flavor: c.flavor, certs: c.certs, notes: c.notes });
    setEditing(c.id);
  };
  const save = () => {
    if (!fields.name.trim()) return;
    const clean = { ...fields, name: fields.name.trim() };
    if (editing === 'new') addCatalogItem(channel.id, clean);
    else if (editing) updateCatalogItem(editing, clean);
    setEditing(null);
  };

  if (editing) {
    return (
      <div className="screen-pad">
        <div className="card note-editor">
          <input
            value={fields.name}
            onChange={(e) => setFields({ ...fields, name: e.target.value })}
            placeholder="Bean name (e.g. Ethiopia Guji)"
            autoFocus
          />
          <input
            value={fields.origin}
            onChange={(e) => setFields({ ...fields, origin: e.target.value })}
            placeholder="Origin (region, country)"
          />
          <input
            value={fields.roast}
            onChange={(e) => setFields({ ...fields, roast: e.target.value })}
            placeholder="Roast level (e.g. City+)"
          />
          <input
            value={fields.flavor}
            onChange={(e) => setFields({ ...fields, flavor: e.target.value })}
            placeholder="Flavor profile"
          />
          <input
            value={fields.certs}
            onChange={(e) => setFields({ ...fields, certs: e.target.value })}
            placeholder="Certifications (Organic, Fair Trade…)"
          />
          <textarea
            value={fields.notes}
            onChange={(e) => setFields({ ...fields, notes: e.target.value })}
            placeholder="Anything else — sourcing, stock notes, label copy…"
            rows={3}
          />
          <div className="btn-row">
            <button className="btn ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
            {editing !== 'new' && (
              <button
                className="btn ghost danger"
                onClick={() => {
                  if (window.confirm(`Remove “${fields.name}” from the library?`)) {
                    deleteCatalogItem(editing);
                    setEditing(null);
                  }
                }}
              >
                Delete
              </button>
            )}
            <button className="btn primary" onClick={save} disabled={!fields.name.trim()}>
              Save
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen-pad">
      <input
        className="search-input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Search ${items.length ? state.catalogItems.filter((c) => c.channelId === channel.id).length : ''} beans…`}
      />
      <div className="sort-chips">
        <span className="sort-label">Sort:</span>
        {SORTS.map((s) => (
          <button
            key={s.key}
            className={'sort-chip' + (sort === s.key ? ' chip-on' : '')}
            onClick={() => setSort(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {items.length === 0 && (
        <EmptyState
          emoji="🫘"
          title={q ? 'No beans match' : 'The library is empty'}
          hint={q ? 'Try a different search.' : 'Add your first bean below.'}
        />
      )}
      {items.map((c) => {
        const by = state.users.find((u) => u.id === c.updatedBy);
        return (
          <button key={c.id} className="card cat-card" onClick={() => startEdit(c)}>
            <span className="cat-head">
              <span className="cat-name">{c.name}</span>
              {c.roast && <span className="cat-roast">{c.roast}</span>}
            </span>
            {c.origin && <span className="cat-line">📍 {c.origin}</span>}
            {c.flavor && <span className="cat-line">👅 {c.flavor}</span>}
            {c.certs && (
              <span className="cat-certs">
                {c.certs.split(',').map((cert) => (
                  <span key={cert} className="cert-badge">
                    {cert.trim()}
                  </span>
                ))}
              </span>
            )}
            {c.notes && <span className="cat-notes">{c.notes}</span>}
            <span className="note-meta">
              {by?.name ?? '?'} ·{' '}
              {new Date(c.updatedAt).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}{' '}
              · tap to edit
            </span>
          </button>
        );
      })}
      <button className="btn primary" onClick={startNew}>
        Add a bean 🫘
      </button>
      <p className="footnote">
        Works like a wiki — anyone on the team can add or edit a bean.
      </p>
    </div>
  );
}
