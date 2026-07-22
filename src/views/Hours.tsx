import React, { useMemo, useState } from 'react';
import { useStore, fmtDate, monthKey } from '../store';
import { Avatar, EmptyState, MonthNav, Segmented } from '../ui';

const fmtHours = (n: number) => String(parseFloat(n.toFixed(2)));

export function Hours() {
  const { me } = useStore();
  const [mode, setMode] = useState<'mine' | 'payroll'>('mine');
  const [month, setMonth] = useState(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), 1);
  });

  return (
    <div className="screen">
      <header className="large-header">
        <h1>⏱ Hours</h1>
      </header>
      <div className="screen-pad">
        {me.role === 'admin' && (
          <Segmented
            options={[
              { value: 'mine' as const, label: 'My hours' },
              { value: 'payroll' as const, label: 'Payroll' },
            ]}
            value={mode}
            onChange={setMode}
          />
        )}
        <div className="card">
          <MonthNav month={month} onChange={setMonth} />
        </div>
        {mode === 'mine' ? <MyHours month={month} /> : <Payroll month={month} />}
      </div>
    </div>
  );
}

function MyHours({ month }: { month: Date }) {
  const { state, me, addHours, deleteHours } = useStore();
  const mk = monthKey(month);
  const entries = state.hoursEntries
    .filter(
      (e) =>
        e.userId === me.id &&
        e.teamId === state.currentTeamId &&
        e.date.startsWith(mk)
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  const total = entries.reduce((sum, e) => sum + e.hours, 0);

  const [date, setDate] = useState(fmtDate(new Date()));
  const [hours, setHours] = useState('');
  const [note, setNote] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const h = parseFloat(hours);
    if (!date || !h || h <= 0) return;
    addHours(date, h, note.trim());
    setHours('');
    setNote('');
  };

  return (
    <>
      <div className="card total-card">
        <span className="total-num">{fmtHours(total)}</span>
        <span className="total-label">
          hours in {month.toLocaleDateString(undefined, { month: 'long' })}
        </span>
      </div>

      <form className="card form-card" onSubmit={submit}>
        <h3>Log time</h3>
        <div className="form-grid">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
          <input
            type="number"
            inputMode="decimal"
            step="0.25"
            min="0.25"
            max="24"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="Hours"
            required
          />
        </div>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What'd you do? (optional)"
        />
        <button className="btn primary" type="submit" disabled={!hours}>
          Add ⏱
        </button>
      </form>

      <div className="card">
        <h3>This month</h3>
        {entries.length === 0 && (
          <p className="hint">No hours logged yet this month.</p>
        )}
        {entries.map((e) => (
          <div key={e.id} className="entry-row">
            <span className="entry-date">
              {new Date(e.date + 'T12:00:00').toLocaleDateString(undefined, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              })}
            </span>
            <span className="entry-note">{e.note}</span>
            <span className="entry-hours">{e.hours}h</span>
            <button className="del" onClick={() => deleteHours(e.id)} aria-label="Delete">
              ✕
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

function Payroll({ month }: { month: Date }) {
  const { state } = useStore();
  const mk = monthKey(month);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const inMonth = useMemo(
    () =>
      state.hoursEntries.filter(
        (e) => e.teamId === state.currentTeamId && e.date.startsWith(mk)
      ),
    [state.hoursEntries, state.currentTeamId, mk]
  );

  const perUser = state.users
    .map((u) => ({
      user: u,
      entries: inMonth
        .filter((e) => e.userId === u.id)
        .sort((a, b) => a.date.localeCompare(b.date)),
    }))
    .filter((r) => r.entries.length > 0)
    .map((r) => ({ ...r, total: r.entries.reduce((s, e) => s + e.hours, 0) }));

  const grand = perUser.reduce((s, r) => s + r.total, 0);

  const copyCsv = async () => {
    const rows = [
      'Name,Date,Hours,Note',
      ...inMonth.map((e) => {
        const name = state.users.find((u) => u.id === e.userId)?.name ?? '?';
        return `${name},${e.date},${e.hours},"${e.note.replace(/"/g, '""')}"`;
      }),
    ];
    await navigator.clipboard.writeText(rows.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (perUser.length === 0) {
    return (
      <EmptyState
        emoji="🧾"
        title="No hours this month"
        hint="Entries your staff log will show up here, totaled and ready for payroll."
      />
    );
  }

  return (
    <>
      <div className="card total-card">
        <span className="total-num">{fmtHours(grand)}</span>
        <span className="total-label">team hours · tap a person for detail</span>
      </div>
      {perUser.map(({ user, entries, total }) => (
        <div className="card" key={user.id}>
          <button
            className="payroll-row"
            onClick={() => setExpanded(expanded === user.id ? null : user.id)}
          >
            <Avatar user={user} size={34} />
            <span className="payroll-name">{user.name}</span>
            <span className="payroll-total">{fmtHours(total)}h</span>
            <span className="chevron">{expanded === user.id ? '▾' : '›'}</span>
          </button>
          {expanded === user.id &&
            entries.map((e) => (
              <div key={e.id} className="entry-row sub-entry">
                <span className="entry-date">
                  {new Date(e.date + 'T12:00:00').toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
                <span className="entry-note">{e.note}</span>
                <span className="entry-hours">{e.hours}h</span>
              </div>
            ))}
        </div>
      ))}
      <button className="btn primary" onClick={copyCsv}>
        {copied ? 'Copied! 📋' : 'Copy as CSV for payroll'}
      </button>
    </>
  );
}
