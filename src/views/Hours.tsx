import React, { useMemo, useState } from 'react';
import { useStore, fmtDate } from '../store';
import { Avatar, EmptyState, Segmented } from '../ui';
import {
  DEFAULT_PERIOD_START_DAY,
  findPeriod,
  money,
  paydayFor,
  periodBounds,
  periodLabel,
  rateOn,
  shiftPeriod,
  totalsFor,
} from '../lib/payroll';

const fmtHours = (n: number) => String(parseFloat(n.toFixed(2)));

// Steps a whole pay period at a time rather than a calendar month, since
// the two are only the same thing when the cycle starts on the 1st.
function PeriodNav({
  anchor,
  startDay,
  onChange,
}: {
  anchor: Date;
  startDay: number;
  onChange: (d: Date) => void;
}) {
  const { from, to } = periodBounds(anchor, startDay);
  return (
    <div className="month-nav">
      <button
        aria-label="Previous pay period"
        onClick={() => onChange(shiftPeriod(anchor, startDay, -1))}
      >
        ‹
      </button>
      <span>{periodLabel(from, to)}</span>
      <button
        aria-label="Next pay period"
        onClick={() => onChange(shiftPeriod(anchor, startDay, 1))}
      >
        ›
      </button>
    </div>
  );
}

export function Hours() {
  const { state, me } = useStore();
  const [mode, setMode] = useState<'mine' | 'payroll'>('mine');
  // An anchor date; the period containing it is what's on screen.
  const [anchor, setAnchor] = useState(() => new Date());
  const startDay =
    state.teams.find((t) => t.id === state.currentTeamId)?.payPeriodStartDay ??
    DEFAULT_PERIOD_START_DAY;

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
        {mode === 'mine' ? (
          <MyHours anchor={anchor} onAnchor={setAnchor} startDay={startDay} />
        ) : (
          <Payroll anchor={anchor} onAnchor={setAnchor} startDay={startDay} />
        )}
      </div>
    </div>
  );
}

function MyHours({
  anchor,
  onAnchor,
  startDay,
}: {
  anchor: Date;
  onAnchor: (d: Date) => void;
  startDay: number;
}) {
  const { state, me, addHours, deleteHours } = useStore();
  const { from, to } = periodBounds(anchor, startDay);
  const label = periodLabel(from, to);

  const entries = state.hoursEntries
    .filter(
      (e) =>
        e.userId === me.id &&
        e.teamId === state.currentTeamId &&
        e.date >= from &&
        e.date <= to
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  const totals = totalsFor(state.hoursEntries, state.wageRates, me.id, from, to);
  const period = findPeriod(state.payPeriods, from, to);
  const myLine = period?.lines.find((l) => l.userId === me.id);
  const locked = !!myLine?.paidAt;

  const [date, setDate] = useState(fmtDate(new Date()));
  const [hours, setHours] = useState('');
  const [tips, setTips] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const h = parseFloat(hours);
    if (!date || !h || h <= 0) return;
    setError('');
    // The shift belongs to the period it was WORKED in, wherever you're
    // browsing. A date outside the current view used to be a dead-end
    // error, which combined with a settled period meant a late shift had
    // nowhere legal to go at all (Shannon, Aug 2026).
    const d = new Date(date + 'T12:00:00');
    const target = periodBounds(d, startDay);
    const targetLine = findPeriod(state.payPeriods, target.from, target.to)?.lines.find(
      (l) => l.userId === me.id
    );
    if (targetLine?.paidAt) {
      setError(
        `You've already been paid out for ${periodLabel(
          target.from,
          target.to
        )}, so it's locked. Ask the owner to reopen it in Payroll — then this shift can be logged and settled with the difference.`
      );
      return;
    }
    addHours(date, h, parseFloat(tips) || 0, note.trim());
    if (date < from || date > to) onAnchor(d); // follow the entry to its period
    setHours('');
    setTips('');
    setNote('');
  };

  return (
    <>
      <div className="card">
        <PeriodNav anchor={anchor} startDay={startDay} onChange={onAnchor} />
      </div>

      <div className="card total-card">
        <div className="total-head">
          <span className="total-num">{fmtHours(totals.hours)}</span>
          <span className="total-label">
            {startDay === 1 ? `hours in ${label}` : 'hours this pay period'}
          </span>
        </div>
        <div className="earn-row">
          <span className="earn-chip">
            <strong>{money(myLine?.gross ?? totals.gross)}</strong> wages
          </span>
          <span className="earn-chip">
            <strong>{money(myLine?.tips ?? totals.tips)}</strong> tips
          </span>
        </div>
        {totals.missingRate && !myLine && (
          <p className="hint">
            Some shifts have no wage on record yet, so this is only part of what
            you’re owed. Ask the owner to set your rate.
          </p>
        )}
        {locked && (
          <p className="hint granted">
            ✓ Paid{' '}
            {myLine?.paidAt
              ? new Date(myLine.paidAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })
              : ''}
            . These entries are locked. Worked a shift inside this period
            since then? Ask the owner to reopen it in Payroll — then log it
            and they can settle the difference.
          </p>
        )}
      </div>

      {!locked && (
        <form className="card form-card" onSubmit={submit}>
          <h3>Log a shift</h3>
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
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={tips}
            onChange={(e) => setTips(e.target.value)}
            placeholder="Tips you took home (optional)"
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What'd you do? (optional)"
          />
          {error && <p className="hint error-hint">{error}</p>}
          <button className="btn primary" type="submit" disabled={!hours}>
            Add ⏱
          </button>
        </form>
      )}

      <div className="card">
        <h3>{startDay === 1 ? 'This month' : 'This pay period'}</h3>
        {entries.length === 0 && (
          <p className="hint">No shifts logged yet in this pay period.</p>
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
            <span className="entry-note">
              {e.note}
              {e.tips > 0 && <span className="tip-tag"> · {money(e.tips)} tips</span>}
            </span>
            <span className="entry-hours">{e.hours}h</span>
            {!locked && (
              <button className="del" onClick={() => deleteHours(e.id)} aria-label="Delete">
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

type Span = 'month' | 'year';

function Payroll({
  anchor,
  onAnchor,
  startDay,
}: {
  anchor: Date;
  onAnchor: (d: Date) => void;
  startDay: number;
}) {
  const { state, setWageRate, markPersonPaid, reopenPerson, setStaffNote } = useStore();
  const [span, setSpan] = useState<Span>('month');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [rateFor, setRateFor] = useState<string | null>(null);
  const [rateVal, setRateVal] = useState('');
  const [rateFrom, setRateFrom] = useState('');
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteVal, setNoteVal] = useState('');

  const year = anchor.getFullYear();
  const bounds = periodBounds(anchor, startDay);
  // A yearly view is the tax-time report: same maths, wider window, and
  // always a calendar year regardless of the pay cycle.
  const from = span === 'month' ? bounds.from : `${year}-01-01`;
  const to = span === 'month' ? bounds.to : `${year}-12-31`;
  const spanLabel =
    span === 'month' ? periodLabel(bounds.from, bounds.to) : String(year);

  const inRange = useMemo(
    () =>
      state.hoursEntries.filter(
        (e) => e.teamId === state.currentTeamId && e.date >= from && e.date <= to
      ),
    [state.hoursEntries, state.currentTeamId, from, to]
  );

  // Paying is a per-month operation, so it only makes sense against a month.
  const period = span === 'month' ? findPeriod(state.payPeriods, from, to) : undefined;

  // Everyone on the team shows up, including people who haven't logged a
  // shift yet — otherwise a new hire is invisible here until their first
  // entry, and you can't set their rate before they start.
  const perUser = state.users.map((u) => {
    const entries = inRange
      .filter((e) => e.userId === u.id)
      .sort((a, b) => a.date.localeCompare(b.date));
    const line = period?.lines.find((l) => l.userId === u.id);
    const live = totalsFor(state.hoursEntries, state.wageRates, u.id, from, to);
    // Once someone's paid, show the frozen numbers — that's the point.
    const totals = line?.paidAt ? { ...live, ...line } : live;
    return { user: u, entries, totals, line, paid: !!line?.paidAt };
  });

  const withHours = perUser.filter((r) => r.entries.length > 0);
  const grandHours = withHours.reduce((s, r) => s + r.totals.hours, 0);
  const grandGross = withHours.reduce((s, r) => s + r.totals.gross, 0);
  const grandTips = withHours.reduce((s, r) => s + r.totals.tips, 0);
  const anyMissingRate = withHours.some((r) => r.totals.missingRate && !r.paid);

  const unpaid = withHours.filter((r) => !r.paid);
  const overdue = span === 'month' && unpaid.length > 0 && new Date() > paydayFor(to);

  const copyCsv = async () => {
    const rows = [
      `Percolate payroll — ${spanLabel}`,
      '',
      'Name,Date,Hours,Tips,Rate,Note',
      ...inRange.map((e) => {
        const name = state.users.find((u) => u.id === e.userId)?.name ?? '?';
        const rate = rateOn(state.wageRates, e.userId, e.date);
        return `${name},${e.date},${e.hours},${e.tips},${rate ?? ''},"${e.note.replace(/"/g, '""')}"`;
      }),
      '',
      'Name,Total hours,Gross wages,Tips,Paid',
      ...withHours.map(
        (r) =>
          `${r.user.name},${r.totals.hours},${r.totals.gross.toFixed(2)},${r.totals.tips.toFixed(
            2
          )},${r.paid ? 'yes' : 'no'}`
      ),
      `TEAM TOTAL,${fmtHours(grandHours)},${grandGross.toFixed(2)},${grandTips.toFixed(2)},`,
    ];
    await navigator.clipboard.writeText(rows.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const doPay = async (userId: string, name: string, gross: number) => {
    // Settling a period that isn't over locks out any shift worked after
    // today — that's how Shannon's Aug 22 shift got stranded. Warn loudly.
    const early = to > fmtDate(new Date());
    if (
      !window.confirm(
        `Mark ${name} paid for ${spanLabel}?\n\n${money(
          gross
        )} in wages. Their totals lock in and their entries can't be edited until you reopen.` +
          (early
            ? `\n\n⚠️ This pay period runs through ${new Date(
                to + 'T12:00:00'
              ).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })} and isn't over yet. Any shift ${name} works between now and then would be locked out until you reopen it.`
            : '')
      )
    ) {
      return;
    }
    setBusy(userId);
    setError('');
    const res = await markPersonPaid(from, to, userId);
    setBusy(null);
    if (res.error) setError(res.error);
  };

  const doReopen = async (userId: string) => {
    setBusy(userId);
    setError('');
    const res = await reopenPerson(from, to, userId);
    setBusy(null);
    if (res.error) setError(res.error);
  };

  const saveRate = async () => {
    if (!rateFor) return;
    const v = parseFloat(rateVal);
    if (!(v >= 0)) return;
    setBusy(rateFor);
    setError('');
    const res = await setWageRate(rateFor, v, rateFrom);
    setBusy(null);
    if (res.error) setError(res.error);
    else {
      setRateFor(null);
      setRateVal('');
    }
  };

  const saveNote = async () => {
    if (!noteFor) return;
    setBusy(noteFor);
    setError('');
    const res = await setStaffNote(noteFor, noteVal.trim());
    setBusy(null);
    if (res.error) setError(res.error);
    else setNoteFor(null);
  };

  return (
    <>
      <Segmented
        options={[
          { value: 'month' as const, label: 'Pay period' },
          { value: 'year' as const, label: 'Year' },
        ]}
        value={span}
        onChange={(v) => {
          setSpan(v);
          setExpanded(null);
        }}
      />

      <div className="card">
        {span === 'month' ? (
          <PeriodNav anchor={anchor} startDay={startDay} onChange={onAnchor} />
        ) : (
          <div className="year-nav">
            <button
              className="link"
              onClick={() => onAnchor(new Date(year - 1, anchor.getMonth(), anchor.getDate()))}
            >
              ‹
            </button>
            <strong>{year}</strong>
            <button
              className="link"
              onClick={() => onAnchor(new Date(year + 1, anchor.getMonth(), anchor.getDate()))}
            >
              ›
            </button>
          </div>
        )}
      </div>

      {overdue && (
        <div className="attn-strip" role="status">
          <span className="attn-emoji">🧾</span>
          <span className="attn-text">
            <strong>
              {unpaid.length} {unpaid.length === 1 ? 'person' : 'people'} still unpaid
            </strong>{' '}
            for {spanLabel} — payday was{' '}
            {paydayFor(to).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}.
          </span>
        </div>
      )}

      <div className="card total-card">
        <div className="total-head">
          <span className="total-num">{money(grandGross)}</span>
          <span className="total-label">
            wages · {spanLabel} · {fmtHours(grandHours)}h
          </span>
        </div>
        <div className="earn-row">
          <span className="earn-chip">
            <strong>{money(grandTips)}</strong> tips (staff keep)
          </span>
          <span className="earn-chip">
            <strong>
              {withHours.length - unpaid.length}/{withHours.length}
            </strong>{' '}
            paid
          </span>
        </div>
      </div>

      {anyMissingRate && (
        <p className="hint error-hint">
          Someone below has shifts with no wage on record — their gross is
          incomplete until you set a rate.
        </p>
      )}
      {error && <p className="hint error-hint">{error}</p>}
      {span === 'year' && (
        <p className="hint">
          The yearly view is a read-only calendar-year summary for taxes.
          Switch to Pay period to set rates or mark someone paid.
        </p>
      )}

      {perUser.map(({ user, entries, totals, line, paid }) => {
        const currentRate = rateOn(state.wageRates, user.id, to);
        const staffNote = state.staffNotes.find((n) => n.userId === user.id);
        const open = expanded === user.id;
        return (
          <div className="card" key={user.id}>
            <button className="payroll-row" onClick={() => setExpanded(open ? null : user.id)}>
              <Avatar user={user} size={34} />
              <span className="payroll-name">
                {user.name}
                <span className="payroll-sub">
                  {entries.length === 0
                    ? 'No shifts yet'
                    : `${fmtHours(totals.hours)}h${
                        currentRate != null ? ` · ${money(currentRate)}/h` : ' · no rate set'
                      }`}
                </span>
              </span>
              {paid && <span className="paid-badge">Paid</span>}
              <span className="payroll-total">{money(totals.gross)}</span>
              <span className="chevron">{open ? '▾' : '›'}</span>
            </button>

            {open && (
              <>
                {entries.map((e) => (
                  <div key={e.id} className="entry-row sub-entry">
                    <span className="entry-date">
                      {new Date(e.date + 'T12:00:00').toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                    <span className="entry-note">
                      {e.note}
                      {e.tips > 0 && <span className="tip-tag"> · {money(e.tips)} tips</span>}
                    </span>
                    <span className="entry-hours">{e.hours}h</span>
                  </div>
                ))}
                {entries.length > 0 && (
                  <div className="entry-row sub-entry">
                    <span className="entry-note">
                      <strong>Tips kept</strong>
                    </span>
                    <span className="entry-hours">{money(totals.tips)}</span>
                  </div>
                )}

                {/* Owner-only note: hire date, raises, anything personal. */}
                <div className="rate-editor">
                  {noteFor === user.id ? (
                    <>
                      <textarea
                        value={noteVal}
                        onChange={(ev) => setNoteVal(ev.target.value)}
                        rows={4}
                        placeholder="Hired Mar 2026 · raise to $18 in July · prefers weekend shifts…"
                        autoFocus
                      />
                      <p className="hint">Only you can see this — never shown to staff.</p>
                      <div className="btn-row">
                        <button className="btn ghost small" onClick={() => setNoteFor(null)}>
                          Cancel
                        </button>
                        <button
                          className="btn primary small"
                          onClick={saveNote}
                          disabled={busy === user.id}
                        >
                          Save note
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      {staffNote?.note && <p className="staff-note">{staffNote.note}</p>}
                      <button
                        className="link"
                        onClick={() => {
                          setNoteFor(user.id);
                          setNoteVal(staffNote?.note ?? '');
                        }}
                      >
                        {staffNote?.note ? 'Edit note 🔒' : 'Add a note 🔒'}
                      </button>
                    </>
                  )}
                </div>

                {span === 'month' && !paid && (
                  <div className="rate-editor">
                    {rateFor === user.id ? (
                      <>
                        <div className="form-grid">
                          <input
                            type="number"
                            inputMode="decimal"
                            step="0.25"
                            min="0"
                            value={rateVal}
                            onChange={(ev) => setRateVal(ev.target.value)}
                            placeholder="$ / hour"
                            autoFocus
                          />
                          <input
                            type="date"
                            value={rateFrom}
                            onChange={(ev) => setRateFrom(ev.target.value)}
                          />
                        </div>
                        <p className="hint">
                          Applies from this date onward. Earlier shifts keep the
                          rate they were worked at.
                        </p>
                        <div className="btn-row">
                          <button className="btn ghost small" onClick={() => setRateFor(null)}>
                            Cancel
                          </button>
                          <button
                            className="btn primary small"
                            onClick={saveRate}
                            disabled={busy === user.id || !rateVal}
                          >
                            Save rate
                          </button>
                        </div>
                      </>
                    ) : (
                      <button
                        className="link"
                        onClick={() => {
                          setRateFor(user.id);
                          setRateVal(currentRate != null ? String(currentRate) : '');
                          setRateFrom(from);
                        }}
                      >
                        {currentRate != null ? 'Change hourly rate' : 'Set hourly rate'}
                      </button>
                    )}
                  </div>
                )}

                {span === 'month' && entries.length > 0 && (
                  <div className="btn-row" style={{ marginTop: 10 }}>
                    {paid ? (
                      <>
                        <span className="hint" style={{ flex: 1 }}>
                          ✓ Paid{' '}
                          {line?.paidAt
                            ? new Date(line.paidAt).toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric',
                              })
                            : ''}
                        </span>
                        <button
                          className="btn ghost small"
                          onClick={() => doReopen(user.id)}
                          disabled={busy === user.id}
                        >
                          {busy === user.id ? 'Working…' : 'Reopen'}
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn primary small"
                        onClick={() => doPay(user.id, user.name, totals.gross)}
                        disabled={busy === user.id}
                      >
                        {busy === user.id ? 'Working…' : `Mark ${user.name} paid ✓`}
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}

      {withHours.length === 0 && (
        <EmptyState
          emoji="🧾"
          title={`No hours in ${spanLabel}`}
          hint="Shifts your staff log will show up here, totaled and ready for payroll."
        />
      )}

      <button className="btn primary" onClick={copyCsv}>
        {copied ? 'Copied! 📋' : `Copy ${span === 'year' ? 'year' : 'month'} as CSV`}
      </button>
    </>
  );
}
