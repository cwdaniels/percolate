import React, { useState } from 'react';
import { useStore } from '../store';
import { EmptyState } from '../ui';
import type { Channel, Order } from '../types';

// Turns pasted text into one or more orders. Any non-bulleted line starts a
// new store (its heading); bulleted lines (-, *, •) below become that store's
// beans. Blank lines are ignored, so you can paste several stores at once.
export function parseOrders(text: string): { title: string; items: string[] }[] {
  const orders: { title: string; items: string[] }[] = [];
  let current: { title: string; items: string[] } | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[-*•]\s+/.test(line)) {
      const item = line.replace(/^[-*•]\s*/, '').trim();
      if (!current) {
        current = { title: 'Order', items: [] };
        orders.push(current);
      }
      if (item) current.items.push(item);
    } else {
      // Heading — strip a trailing colon ("Scupps:" → "Scupps").
      current = { title: line.replace(/[:：]\s*$/, '').trim(), items: [] };
      orders.push(current);
    }
  }
  return orders.filter((o) => o.title || o.items.length);
}

// Minimal inline renderer: **bold** only, no block wrapping.
function boldify(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    )
  );
}

// Indentation is stored as leading tabs in the item text (no schema column).
const indentOf = (text: string) => (text.match(/^\t*/)?.[0].length ?? 0);
const stripIndent = (text: string) => text.replace(/^\t+/, '');
const withIndent = (clean: string, level: number) => '\t'.repeat(Math.max(0, level)) + clean;

function OrderCard({ order }: { order: Order }) {
  const {
    state,
    me,
    toggleOrderItem,
    setOrderStage,
    completeOrder,
    uncompleteOrder,
    editOrderItem,
    deleteOrderItem,
    addOrderItem,
    deleteOrder,
  } = useStore();
  const [editing, setEditing] = useState(false);
  const [newItem, setNewItem] = useState('');

  const o = order;
  const doneCount = o.items.filter((i) => i.done).length;
  const allDone = o.items.length === 0 || doneCount === o.items.length;
  const by = state.users.find((u) => u.id === o.createdBy);
  const deliveredBy = state.users.find((u) => u.id === o.deliveredBy);
  const canDelete = o.createdBy === me.id || me.role === 'admin';
  const canEdit = o.stage !== 'delivered';

  const addItem = (e: React.FormEvent) => {
    e.preventDefault();
    const t = newItem.trim();
    if (!t) return;
    addOrderItem?.(o.id, t);
    setNewItem('');
  };

  return (
    <div className={'card order-card' + (o.stage !== 'roast' ? ' order-quiet' : '')}>
      <div className="order-head">
        {o.stage === 'delivered' ? (
          <span className="check check-on order-check">✓</span>
        ) : (
          <button
            className={
              'check order-check' +
              (o.stage === 'ready' ? ' check-on' : allDone ? '' : ' check-dim')
            }
            onClick={() =>
              o.stage === 'roast' ? completeOrder(o.id) : uncompleteOrder?.(o.id)
            }
            title={
              o.stage === 'roast'
                ? 'Check off the whole order — marks every bean roasted, moves to Ready'
                : 'Uncheck the whole order — clears the beans, sends it back to roast'
            }
            aria-label="Toggle whole order"
          >
            {o.stage === 'ready' ? '✓' : ''}
          </button>
        )}
        <span className="order-title">{boldify(o.title)}</span>
        {o.items.length > 0 && !editing && (
          <span className="order-progress">
            {doneCount}/{o.items.length}
          </span>
        )}
        {canEdit && (
          <button className="link order-edit" onClick={() => setEditing(!editing)}>
            {editing ? 'Done' : 'Edit'}
          </button>
        )}
      </div>

      {o.items.map((i) => {
        const level = indentOf(i.text);
        const clean = stripIndent(i.text);
        if (editing) {
          return (
            <div key={i.id} className="edit-item" style={{ paddingLeft: level * 16 }}>
              <button
                className="ei-btn"
                onClick={() => editOrderItem?.(i.id, withIndent(clean, level - 1))}
                disabled={level === 0}
                aria-label="Outdent"
              >
                ⇤
              </button>
              <button
                className="ei-btn"
                onClick={() => editOrderItem?.(i.id, withIndent(clean, level + 1))}
                aria-label="Indent"
              >
                ⇥
              </button>
              <input
                key={i.id + i.text}
                className="ei-input"
                defaultValue={clean}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== clean) editOrderItem?.(i.id, withIndent(v, level));
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
              <button
                className="ei-btn ei-del"
                onClick={() => deleteOrderItem?.(i.id)}
                aria-label="Delete item"
              >
                ✕
              </button>
            </div>
          );
        }
        return (
          <div
            key={i.id}
            className={'item' + (i.done ? ' item-done' : '')}
            style={{ paddingLeft: level * 16 }}
          >
            <button
              className={'check' + (i.done ? ' check-on' : '')}
              onClick={() => o.stage === 'roast' && toggleOrderItem(o.id, i.id)}
              aria-label={i.done ? 'Uncheck' : 'Check off'}
            >
              {i.done ? '✓' : ''}
            </button>
            <div className="item-body">{boldify(clean)}</div>
          </div>
        );
      })}

      {editing && (
        <>
          <form className="add-row" onSubmit={addItem}>
            <input
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              placeholder="Add a bean… (use **bold** for names)"
            />
            <button type="submit">+</button>
          </form>
          {canDelete && (
            <button
              className="link danger"
              onClick={() => {
                if (window.confirm(`Delete the whole “${o.title}” order?`)) deleteOrder(o.id);
              }}
            >
              Delete this order
            </button>
          )}
        </>
      )}

      {!editing && (
        <div className="order-foot">
          <span className="note-meta">
            {by?.name ?? '?'} ·{' '}
            {new Date(o.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            {o.stage === 'delivered' && deliveredBy && <> · delivered by {deliveredBy.name}</>}
          </span>
          <span className="order-actions">
            {o.stage === 'ready' && (
              <button className="btn primary small" onClick={() => setOrderStage(o.id, 'delivered')}>
                Delivered 🚚
              </button>
            )}
            {o.stage === 'delivered' && canDelete && (
              <button
                className="link danger"
                onClick={() => {
                  if (window.confirm(`Remove “${o.title}” from history?`)) deleteOrder(o.id);
                }}
              >
                Remove
              </button>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

export function OrdersBoard({ channel }: { channel: Channel }) {
  const { state, addOrder } = useStore();
  const [draft, setDraft] = useState('');
  const [showDelivered, setShowDelivered] = useState(false);

  const orders = state.orders
    .filter((o) => o.channelId === channel.id)
    .sort((a, b) => b.ts - a.ts);
  const byStage = (s: Order['stage']) => orders.filter((o) => o.stage === s);
  const roasting = byStage('roast');
  const ready = byStage('ready');
  const delivered = byStage('delivered');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseOrders(draft);
    if (!parsed.length) return;
    for (const ord of parsed) {
      await addOrder(channel.id, ord.title, ord.items);
    }
    setDraft('');
  };

  const pending = parseOrders(draft);

  return (
    <div className="screen-pad">
      <form className="card" onSubmit={submit}>
        <h3>New order{pending.length > 1 ? `s (${pending.length})` : ''}</h3>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            'Paste one or several straight from your notes:\n\nDeep Roots\n* Honduras 12oz — 1cs\n* Guatemala 12oz — 1cs\n\nBestway\n* 3 Light\n* 3 Dark'
          }
          rows={Math.min(14, Math.max(4, draft.split('\n').length))}
        />
        <button className="btn primary" type="submit" disabled={!pending.length}>
          {pending.length > 1 ? `Add ${pending.length} orders 🧾` : 'Add order 🧾'}
        </button>
        <p className="hint">
          Each un-bulleted line starts a new store; the bulleted lines below become
          its beans. Tap <strong>Edit</strong> on any order to bold, indent, delete,
          or add beans.
        </p>
      </form>

      <h3 className="stage-title">🔥 To roast</h3>
      {roasting.length === 0 && (
        <p className="hint stage-empty">Roaster’s off the hook — nothing queued.</p>
      )}
      {roasting.map((o) => (
        <OrderCard key={o.id} order={o} />
      ))}

      <h3 className="stage-title">📦 Ready to deliver</h3>
      {ready.length === 0 && <p className="hint stage-empty">Nothing waiting on a delivery run.</p>}
      {ready.map((o) => (
        <OrderCard key={o.id} order={o} />
      ))}

      <h3 className="stage-title">
        <button className="stage-toggle" onClick={() => setShowDelivered(!showDelivered)}>
          ✅ Delivered ({delivered.length}) {showDelivered ? '▾' : '›'}
        </button>
      </h3>
      {showDelivered &&
        (delivered.length === 0 ? (
          <EmptyState emoji="🚚" title="No deliveries yet" hint="Finished orders park here for your records." />
        ) : (
          delivered.map((o) => <OrderCard key={o.id} order={o} />)
        ))}
    </div>
  );
}
