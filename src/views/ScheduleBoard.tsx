import React, { useState } from 'react';
import { useStore, fmtDate } from '../store';
import { Avatar, MonthNav } from '../ui';
import type { Channel } from '../types';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEKDAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

export function ScheduleBoard({
  channel,
  onOpen,
}: {
  channel: Channel;
  onOpen?: (channelId: string) => void;
}) {
  const { state, me, addSignup, removeSignup, setScheduleCapacity } = useStore();
  const today = new Date();
  const [month, setMonth] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const [selected, setSelected] = useState<string>(fmtDate(today));
  const [note, setNote] = useState('');
  const [showCapacity, setShowCapacity] = useState(false);

  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const offset = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
  const signups = state.signups.filter((s) => s.channelId === channel.id);
  const byDate = (d: string) => signups.filter((s) => s.date === d);
  const todayStr = fmtDate(today);

  // Checklist items due each day, pulled from every board channel on this
  // team (not just this schedule channel) — the whole point is one place
  // to see what's coming up.
  const teamChannelIds = new Set(
    state.channels.filter((c) => c.teamId === channel.teamId).map((c) => c.id)
  );
  const tasksByDate = (d: string) =>
    state.listItems.filter((i) => i.dueDate === d && !i.done && teamChannelIds.has(i.channelId));

  const daySignups = byDate(selected);
  const primary = daySignups.filter((s) => !s.isAlternate);
  const alternates = daySignups.filter((s) => s.isAlternate);
  const mine = daySignups.find((s) => s.userId === me.id);
  const dayTasks = tasksByDate(selected);
  const selectedLabel = new Date(selected + 'T12:00:00').toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const dow = new Date(selected + 'T12:00:00').getDay();
  const cap = channel.scheduleCapacity?.[String(dow)];
  const primaryFull = cap ? primary.length >= cap.max : false;
  const altFull = cap?.altMax != null ? alternates.length >= cap.altMax : false;

  const signUp = (asAlternate: boolean) => {
    addSignup(channel.id, selected, note.trim(), asAlternate);
    setNote('');
  };

  return (
    <div className="screen-pad">
      <div className="card cal">
        <MonthNav month={month} onChange={setMonth} />
        <div className="cal-grid cal-head-row">
          {WEEKDAYS.map((w, i) => (
            <span key={i} className="cal-head">
              {w}
            </span>
          ))}
        </div>
        <div className="cal-grid">
          {Array.from({ length: offset }).map((_, i) => (
            <span key={'b' + i} />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const d = fmtDate(new Date(month.getFullYear(), month.getMonth(), i + 1));
            const dots = byDate(d);
            const hasTask = tasksByDate(d).length > 0;
            return (
              <button
                key={d}
                className={
                  'cal-cell' +
                  (d === selected ? ' cal-selected' : '') +
                  (d === todayStr ? ' cal-today' : '')
                }
                onClick={() => setSelected(d)}
              >
                <span className="cal-day">{i + 1}</span>
                <span className="dots">
                  {dots.slice(0, 3).map((s) => {
                    const u = state.users.find((x) => x.id === s.userId);
                    return (
                      <span
                        key={s.id}
                        className={'dot' + (s.isAlternate ? ' dot-alt' : '')}
                        style={{ background: u?.color ?? '#999' }}
                      />
                    );
                  })}
                  {hasTask && <span className="dot dot-task" />}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="card day-card">
        <div className="card-head">
          <h3>{selectedLabel}</h3>
          {me.role === 'admin' && (
            <button className="link" onClick={() => setShowCapacity(!showCapacity)}>
              Staffing limits
            </button>
          )}
        </div>

        {showCapacity && (
          <CapacityEditor
            channel={channel}
            onSave={(day, val) => setScheduleCapacity(channel.id, { [day]: val })}
          />
        )}

        {cap && (
          <p className="hint">
            {WEEKDAY_NAMES[dow]}s: {primary.length}/{cap.max} filled
            {cap.altMax ? ` · ${alternates.length}/${cap.altMax} alternates` : ''}
          </p>
        )}

        {daySignups.length === 0 && (
          <p className="hint">Nobody yet — the espresso machine is lonely 🥺</p>
        )}
        {primary.map((s) => {
          const u = state.users.find((x) => x.id === s.userId);
          const canRemove = s.userId === me.id || me.role === 'admin';
          return (
            <div key={s.id} className="signup-row">
              {u && <Avatar user={u} size={30} />}
              <span className="signup-name">{u?.name ?? '?'}</span>
              {s.note && <span className="signup-note">{s.note}</span>}
              {canRemove && (
                <button className="del" onClick={() => removeSignup(s.id)} aria-label="Remove">
                  ✕
                </button>
              )}
            </div>
          );
        })}
        {alternates.length > 0 && (
          <>
            <p className="hint alt-label">🔄 Alternates — first in line if a spot opens</p>
            {alternates.map((s) => {
              const u = state.users.find((x) => x.id === s.userId);
              const canRemove = s.userId === me.id || me.role === 'admin';
              return (
                <div key={s.id} className="signup-row signup-alt">
                  {u && <Avatar user={u} size={30} />}
                  <span className="signup-name">{u?.name ?? '?'}</span>
                  {s.note && <span className="signup-note">{s.note}</span>}
                  {canRemove && (
                    <button className="del" onClick={() => removeSignup(s.id)} aria-label="Remove">
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
          </>
        )}

        {mine ? (
          <p className="hint granted">
            {mine.isAlternate
              ? "You're an alternate for this day — you'll move up automatically if a spot opens ✅"
              : "You're on the books for this day ✅"}
          </p>
        ) : (
          <form
            className="add-row"
            onSubmit={(e) => {
              e.preventDefault();
              signUp(primaryFull);
            }}
          >
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Hours, e.g. 9–1 (optional)"
            />
            {primaryFull && altFull ? (
              <button type="button" className="btn ghost small" disabled>
                Full
              </button>
            ) : (
              <button type="submit" className="btn primary small">
                {primaryFull ? 'Sign up as alternate 🔄' : 'I can work ✋'}
              </button>
            )}
          </form>
        )}
        {primaryFull && !altFull && !mine && (
          <p className="hint">
            {WEEKDAY_NAMES[dow]}s are capped at {cap!.max} — you'd be an alternate, first in
            line if someone cancels.
          </p>
        )}
        {primaryFull && altFull && !mine && (
          <p className="hint">Full up, including alternates, for this day.</p>
        )}

        {dayTasks.length > 0 && (
          <div className="day-tasks">
            <p className="hint alt-label">📌 Due this day</p>
            {dayTasks.map((t) => {
              const ch = state.channels.find((c) => c.id === t.channelId);
              const assignee = t.assignedTo
                ? state.users.find((u) => u.id === t.assignedTo)
                : undefined;
              return (
                <button
                  key={t.id}
                  className="day-task-row"
                  onClick={() => onOpen?.(t.channelId)}
                >
                  <span className="day-task-text">{t.text.replace(/[*`#]/g, '')}</span>
                  <span className="day-task-meta">
                    {ch?.emoji} {ch?.name}
                    {assignee ? ` · ${assignee.name}` : ''}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function CapacityEditor({
  channel,
  onSave,
}: {
  channel: Channel;
  onSave: (day: string, val: { max: number; altMax?: number } | null) => void;
}) {
  return (
    <div className="rate-editor">
      <p className="hint">
        Cap how many people can be scheduled on a given day of the week. Leave
        blank for no limit — today's behavior everywhere else.
      </p>
      {WEEKDAY_NAMES.map((name, i) => {
        const key = String(i);
        const cur = channel.scheduleCapacity?.[key];
        return (
          <div key={key} className="capacity-row">
            <span className="capacity-day">{name}</span>
            <input
              type="number"
              inputMode="numeric"
              min="1"
              className="capacity-input"
              defaultValue={cur?.max ?? ''}
              placeholder="Max"
              onBlur={(e) => {
                const max = e.target.value ? parseInt(e.target.value, 10) : undefined;
                onSave(key, max ? { max, altMax: cur?.altMax } : null);
              }}
            />
            <input
              type="number"
              inputMode="numeric"
              min="0"
              className="capacity-input"
              defaultValue={cur?.altMax ?? ''}
              placeholder="Alts"
              disabled={!cur}
              onBlur={(e) => {
                if (!cur) return;
                const altMax = e.target.value ? parseInt(e.target.value, 10) : undefined;
                onSave(key, { max: cur.max, altMax });
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
