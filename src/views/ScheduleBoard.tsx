import React, { useState } from 'react';
import { useStore, fmtDate } from '../store';
import { Avatar, MonthNav } from '../ui';
import type { Channel } from '../types';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function ScheduleBoard({ channel }: { channel: Channel }) {
  const { state, me, addSignup, removeSignup } = useStore();
  const today = new Date();
  const [month, setMonth] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const [selected, setSelected] = useState<string>(fmtDate(today));
  const [note, setNote] = useState('');

  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const offset = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
  const signups = state.signups.filter((s) => s.channelId === channel.id);
  const byDate = (d: string) => signups.filter((s) => s.date === d);
  const todayStr = fmtDate(today);

  const daySignups = byDate(selected);
  const mine = daySignups.find((s) => s.userId === me.id);
  const selectedLabel = new Date(selected + 'T12:00:00').toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

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
                        className="dot"
                        style={{ background: u?.color ?? '#999' }}
                      />
                    );
                  })}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="card day-card">
        <h3>{selectedLabel}</h3>
        {daySignups.length === 0 && (
          <p className="hint">Nobody yet — the espresso machine is lonely 🥺</p>
        )}
        {daySignups.map((s) => {
          const u = state.users.find((x) => x.id === s.userId);
          const canRemove = s.userId === me.id || me.role === 'admin';
          return (
            <div key={s.id} className="signup-row">
              {u && <Avatar user={u} size={30} />}
              <span className="signup-name">{u?.name ?? '?'}</span>
              {s.note && <span className="signup-note">{s.note}</span>}
              {canRemove && (
                <button
                  className="del"
                  onClick={() => removeSignup(s.id)}
                  aria-label="Remove"
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
        {mine ? (
          <p className="hint granted">You’re on the books for this day ✅</p>
        ) : (
          <form
            className="add-row"
            onSubmit={(e) => {
              e.preventDefault();
              addSignup(channel.id, selected, note.trim());
              setNote('');
            }}
          >
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Hours, e.g. 9–1 (optional)"
            />
            <button type="submit" className="btn primary small">
              I can work ✋
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
