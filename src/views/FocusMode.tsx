import React, { useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { useStore } from '../store';
import { RETENTION_OPTIONS, countPurgeable, getRetention, setRetention } from '../lib/retention';
import {
  NOTIFY_EVENTS,
  getNotifyPrefs,
  setNotifyPref,
  type NotifyEvent,
  getFocusSettings,
  isPausedNow,
  pauseFor,
  pauseIndefinitely,
  resumeNow,
  setSchedule,
  type FocusSettings,
} from '../lib/focus';

const pad = (n: number) => String(n).padStart(2, '0');
const minToTimeValue = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const timeValueToMin = (v: string) => {
  const [h, m] = v.split(':').map(Number);
  return h * 60 + m;
};

function untilTomorrowMinutes(): number {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 8, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 60_000);
}

export function EventNotifications() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<Record<string, boolean> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    getNotifyPrefs(user.id).then(setPrefs);
  }, [user]);

  if (!prefs) return null;

  const toggle = async (event: NotifyEvent, next: boolean) => {
    // Optimistic: a toggle that visibly lags feels broken.
    setPrefs((p) => (p ? { ...p, [event]: next } : p));
    const res = await setNotifyPref(user!.id, event, next);
    if (!res.ok) {
      setError(res.error ?? 'Could not save that.');
      setPrefs((p) => (p ? { ...p, [event]: !next } : p));
    } else {
      setError('');
    }
  };

  return (
    <div className="card">
      <h3>Tell me when…</h3>
      <p className="hint">
        Mentions and private messages always come through. These are the extras.
      </p>
      {NOTIFY_EVENTS.map(({ event, label, blurb }) => (
        <label key={event} className="notify-row">
          <input
            type="checkbox"
            checked={prefs[event]}
            onChange={(e) => toggle(event, e.target.checked)}
          />
          <span className="notify-text">
            <span className="notify-label">{label}</span>
            <span className="notify-blurb">{blurb}</span>
          </span>
        </label>
      ))}
      {error && <p className="hint error-hint">{error}</p>}
    </div>
  );
}

export function FocusModeSettings() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<FocusSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = () => {
    if (!user) return;
    getFocusSettings(user.id).then(setSettings);
  };

  useEffect(refresh, [user]);

  if (!settings) return null;
  const paused = isPausedNow(settings);

  const applyPause = async (action: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    setError('');
    const res = await action();
    setBusy(false);
    if (res.error) setError(res.error);
    refresh();
  };

  const saveSchedule = async (patch: Partial<{ enabled: boolean; startMin: number; endMin: number }>) => {
    if (!user) return;
    const startLocalMin = patch.startMin ?? settings.scheduleStartLocalMin ?? 22 * 60;
    const endLocalMin = patch.endMin ?? settings.scheduleEndLocalMin ?? 7 * 60;
    const enabled = patch.enabled ?? settings.scheduleEnabled;
    setBusy(true);
    setError('');
    const res = await setSchedule(user.id, { enabled, startLocalMin, endLocalMin });
    setBusy(false);
    if (res.error) setError(res.error);
    refresh();
  };

  return (
    <div className="card">
      <h3>Focus mode</h3>
      {paused ? (
        <>
          <p className="hint granted">
            🔕 Notifications are paused
            {settings.pausedUntil && settings.pausedUntil - Date.now() < 1000 * 60 * 60 * 24 * 30
              ? ` until ${new Date(settings.pausedUntil).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
              : ' until you turn them back on'}
            .
          </p>
          <button
            className="btn ghost"
            disabled={busy}
            onClick={() => applyPause(() => resumeNow(user!.id))}
          >
            Resume notifications
          </button>
        </>
      ) : (
        <>
          <p className="hint">Pause notifications for a bit, no matter what's happening in your channels.</p>
          <div className="focus-pause-row">
            <button className="btn ghost small" disabled={busy} onClick={() => applyPause(() => pauseFor(user!.id, 60))}>
              1 hour
            </button>
            <button
              className="btn ghost small"
              disabled={busy}
              onClick={() => applyPause(() => pauseFor(user!.id, untilTomorrowMinutes()))}
            >
              Until tomorrow
            </button>
            <button className="btn ghost small" disabled={busy} onClick={() => applyPause(() => pauseIndefinitely(user!.id))}>
              Indefinitely
            </button>
          </div>
        </>
      )}

      {error && <p className="hint error-hint">{error}</p>}

      <div className="focus-schedule">
        <label className="focus-schedule-toggle">
          <input
            type="checkbox"
            checked={settings.scheduleEnabled}
            onChange={(e) => saveSchedule({ enabled: e.target.checked })}
          />
          Quiet hours every day
        </label>
        {settings.scheduleEnabled && (
          <div className="focus-schedule-times">
            <input
              type="time"
              value={minToTimeValue(settings.scheduleStartLocalMin ?? 22 * 60)}
              onChange={(e) => saveSchedule({ startMin: timeValueToMin(e.target.value) })}
            />
            <span>to</span>
            <input
              type="time"
              value={minToTimeValue(settings.scheduleEndLocalMin ?? 7 * 60)}
              onChange={(e) => saveSchedule({ endMin: timeValueToMin(e.target.value) })}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function DataRetention() {
  const { state, me } = useStore();
  const [days, setDays] = useState<number | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [atRisk, setAtRisk] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const teamId = state.currentTeamId;

  const refresh = () => {
    getRetention(teamId).then((d) => {
      setDays(d);
      setPending(d);
    });
    countPurgeable().then(setAtRisk);
  };
  useEffect(refresh, [teamId]);

  if (me.role !== 'admin') return null;

  const changed = pending !== days;

  const save = async () => {
    // Shortening the window is the destructive direction — spell out what
    // it means before doing it. Lengthening or turning it off is safe.
    const shortening =
      pending !== null && (days === null || pending < days);
    if (shortening) {
      const label = RETENTION_OPTIONS.find((o) => o.days === pending)?.label ?? '';
      if (
        !window.confirm(
          `Delete messages older than ${label}?\n\n` +
            `This runs nightly and can't be undone. Pinned messages are kept. ` +
            `Hours, payroll, notes and orders are never touched.`
        )
      ) {
        return;
      }
    }
    setBusy(true);
    setError('');
    const res = await setRetention(teamId, pending);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'Could not save that.');
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    refresh();
  };

  return (
    <div className="card">
      <h3>Message retention</h3>
      <p className="hint">
        Old chat messages get deleted automatically, so the database stops
        being a permanent record of everything anyone ever said.
      </p>
      <div className="sort-chips">
        {RETENTION_OPTIONS.map((o) => (
          <button
            key={String(o.days)}
            className={'sort-chip' + (pending === o.days ? ' chip-on' : '')}
            onClick={() => setPending(o.days)}
          >
            {o.label}
          </button>
        ))}
      </div>

      {days !== null && atRisk > 0 && (
        <p className="hint error-hint">
          {atRisk} message{atRisk === 1 ? '' : 's'} will be deleted on the next
          nightly run under your current setting.
        </p>
      )}
      {days !== null && atRisk === 0 && (
        <p className="hint granted">
          ✓ Nothing is old enough to be deleted yet.
        </p>
      )}

      <p className="hint">
        📌 Pinned messages are always kept. Hours, payroll, notes, beans and
        orders are never deleted — only chat.
      </p>
      {error && <p className="hint error-hint">{error}</p>}
      {changed && (
        <button className="btn primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save retention setting'}
        </button>
      )}
      {saved && !changed && <p className="hint granted">Saved ✓</p>}
    </div>
  );
}
