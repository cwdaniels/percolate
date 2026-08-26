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

const EMPTY_FIELDS = {
  name: '',
  origin: '',
  roast: '',
  flavor: '',
  certs: '',
  notes: '',
  sourceUrl: '',
  cost: undefined as number | undefined,
};

// A bare domain reads better next to a price than a full URL string.
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// Only web URLs may become a tappable link. The stored value is
// team-editable text, so a "javascript:" (or any other scheme) must render
// as plain text, never as an href the whole team can be handed.
function webUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

export function CatalogBoard({ channel }: { channel: Channel }) {
  const { state, addCatalogItem, updateCatalogItem, deleteCatalogItem } = useStore();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('name');
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  // Cards show everything except their notes, which are long enough to
  // swamp the list. Per-card rather than one global switch, so reading one
  // bean's notes doesn't push every other bean off the screen.
  const [openNotes, setOpenNotes] = useState<Set<string>>(new Set());
  const [fields, setFields] = useState(EMPTY_FIELDS);

  const toggleNotes = (id: string) =>
    setOpenNotes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Origins already on file, so a new entry can be pointed at an existing
  // one instead of forking a near-duplicate spelling ("Ethiopia" vs
  // "Ethiopia, Guji Zone"). Scoped to this library, not the whole team.
  const knownOrigins = useMemo(() => {
    const set = new Set(
      state.catalogItems
        .filter((c) => c.channelId === channel.id && c.origin.trim())
        .map((c) => c.origin.trim())
    );
    return [...set].sort();
  }, [state.catalogItems, channel.id]);

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
    setFields({
      name: c.name,
      origin: c.origin,
      roast: c.roast,
      flavor: c.flavor,
      certs: c.certs,
      notes: c.notes,
      sourceUrl: c.sourceUrl,
      cost: c.cost,
    });
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
            list="cat-origins"
            value={fields.origin}
            onChange={(e) => setFields({ ...fields, origin: e.target.value })}
            placeholder="Origin (region, country)"
          />
          <datalist id="cat-origins">
            {knownOrigins.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
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
          <div className="form-grid">
            <input
              type="url"
              inputMode="url"
              value={fields.sourceUrl}
              onChange={(e) => setFields({ ...fields, sourceUrl: e.target.value })}
              placeholder="Where you buy it (URL, optional)"
            />
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={fields.cost ?? ''}
              onChange={(e) =>
                setFields({
                  ...fields,
                  cost: e.target.value === '' ? undefined : parseFloat(e.target.value),
                })
              }
              placeholder="Cost ($)"
            />
          </div>
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
      <button className="btn primary" onClick={startNew}>
        Add a bean 🫘
      </button>

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
          hint={q ? 'Try a different search.' : 'Add your first bean above.'}
        />
      )}
      {items.map((c) => {
        const by = state.users.find((u) => u.id === c.updatedBy);
        const buy = webUrl(c.sourceUrl);
        const notesOpen = openNotes.has(c.id);
        return (
          <div key={c.id} className="card cat-card">
            <div className="cat-card-body">
              {/* Whole card is on show — nothing is behind a tap except the
                  notes, which are the only field long enough to bury the
                  bean below it. Finding a bean is search and sort's job. */}
              <div className="cat-card-top">
                <div className="cat-summary">
                  <span className="cat-name">{c.name}</span>
                  {c.origin && <span className="cat-line">📍 {c.origin}</span>}
                  {c.roast && <span className="cat-line">🔥 {c.roast}</span>}
                  {c.flavor && <span className="cat-line">👅 {c.flavor}</span>}
                  {(c.cost != null || c.sourceUrl) && (
                    <span className="cat-line cat-source">
                      {c.cost != null && <span className="cat-cost">${c.cost.toFixed(2)}</span>}
                      {c.sourceUrl && <span>🔗 {hostOf(c.sourceUrl)}</span>}
                    </span>
                  )}
                  {c.certs && (
                    <span className="cat-certs">
                      {c.certs.split(',').map((cert, i) => (
                        <span key={i} className="cert-badge">
                          {cert.trim()}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
                <button className="cat-edit-btn" onClick={() => startEdit(c)}>
                  Edit
                </button>
              </div>

              {c.notes && (
                <div className="cat-notes-block">
                  <button
                    className="cat-notes-toggle"
                    onClick={() => toggleNotes(c.id)}
                    aria-expanded={notesOpen}
                  >
                    <span className="cat-notes-caret" aria-hidden="true">
                      {notesOpen ? '▾' : '▸'}
                    </span>
                    {notesOpen ? 'Hide notes' : 'Notes'}
                  </button>
                  {notesOpen && <p className="cat-notes-full">{c.notes}</p>}
                </div>
              )}

              <span className="note-meta">
                {by?.name ?? '?'} ·{' '}
                {new Date(c.updatedAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            </div>

            {buy && (
              <a className="cat-buy-link" href={buy} target="_blank" rel="noreferrer">
                Buy ↗
              </a>
            )}
          </div>
        );
      })}
      <p className="footnote">
        Works like a wiki — anyone on the team can add or edit a bean.
      </p>
    </div>
  );
}
