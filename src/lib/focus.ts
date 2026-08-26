import { supabase } from './supabase';

export interface FocusSettings {
  pausedUntil: number | null; // epoch ms, or null if not manually paused
  scheduleEnabled: boolean;
  scheduleStartLocalMin: number | null; // minutes since local midnight
  scheduleEndLocalMin: number | null;
}

// Local-time-of-day <-> UTC-minutes-of-day, using today's offset. Doesn't
// account for the schedule's start/end days straddling a DST transition —
// acceptable for a quiet-hours window, not worth a timezone-table dependency.
const localToUtcMin = (localMin: number) =>
  (localMin + new Date().getTimezoneOffset() + 1440) % 1440;
const utcToLocalMin = (utcMin: number) =>
  (utcMin - new Date().getTimezoneOffset() + 1440) % 1440;

export async function getFocusSettings(userId: string): Promise<FocusSettings> {
  const { data } = await supabase
    .from('focus_settings')
    .select('paused_until, schedule_enabled, schedule_start_min, schedule_end_min')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) {
    return { pausedUntil: null, scheduleEnabled: false, scheduleStartLocalMin: null, scheduleEndLocalMin: null };
  }
  return {
    pausedUntil: data.paused_until ? new Date(data.paused_until).getTime() : null,
    scheduleEnabled: data.schedule_enabled,
    scheduleStartLocalMin:
      data.schedule_start_min == null ? null : utcToLocalMin(data.schedule_start_min),
    scheduleEndLocalMin: data.schedule_end_min == null ? null : utcToLocalMin(data.schedule_end_min),
  };
}

async function upsert(userId: string, patch: Record<string, unknown>) {
  const { error } = await supabase
    .from('focus_settings')
    .upsert({ user_id: userId, updated_at: new Date().toISOString(), ...patch });
  return { ok: !error, error: error?.message };
}

export function pauseFor(userId: string, minutes: number) {
  return upsert(userId, { paused_until: new Date(Date.now() + minutes * 60_000).toISOString() });
}

// A pause with no natural end, until the user turns it back on themselves.
export function pauseIndefinitely(userId: string) {
  const farFuture = new Date();
  farFuture.setFullYear(farFuture.getFullYear() + 10);
  return upsert(userId, { paused_until: farFuture.toISOString() });
}

export function resumeNow(userId: string) {
  return upsert(userId, { paused_until: null });
}

export function setSchedule(
  userId: string,
  opts: { enabled: boolean; startLocalMin: number; endLocalMin: number }
) {
  return upsert(userId, {
    schedule_enabled: opts.enabled,
    schedule_start_min: localToUtcMin(opts.startLocalMin),
    schedule_end_min: localToUtcMin(opts.endLocalMin),
  });
}

export function isPausedNow(s: FocusSettings): boolean {
  if (s.pausedUntil && s.pausedUntil > Date.now()) return true;
  if (!s.scheduleEnabled || s.scheduleStartLocalMin == null || s.scheduleEndLocalMin == null) {
    return false;
  }
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const { scheduleStartLocalMin: start, scheduleEndLocalMin: end } = s;
  return start <= end ? nowMin >= start && nowMin < end : nowMin >= start || nowMin < end;
}

// ---------------------------------------------------------------------
// Event notification preferences (roast ready / delivered / new supply).
// Opt-OUT: no row means enabled, so a new teammate hears about things
// without having to go and switch them on.
// ---------------------------------------------------------------------

export type NotifyEvent = 'roast_ready' | 'delivered' | 'supply_added' | 'task_assigned';

export const NOTIFY_EVENTS: { event: NotifyEvent; label: string; blurb: string }[] = [
  { event: 'roast_ready', label: '🔥 Roast ready', blurb: 'An order finishes roasting and is ready to go out.' },
  { event: 'delivered', label: '🚚 Delivered', blurb: 'An order gets marked delivered.' },
  { event: 'supply_added', label: '📋 New checklist item', blurb: 'Someone adds to supplies or another checklist.' },
  { event: 'task_assigned', label: '📌 Task assigned to you', blurb: 'Someone puts your name on a checklist item.' },
];

export async function getNotifyPrefs(userId: string): Promise<Record<string, boolean>> {
  const { data } = await supabase
    .from('notify_prefs')
    .select('event, enabled')
    .eq('user_id', userId);
  const out: Record<string, boolean> = {};
  for (const e of NOTIFY_EVENTS) out[e.event] = true; // default on
  for (const r of data ?? []) out[r.event] = r.enabled;
  return out;
}

export async function setNotifyPref(userId: string, event: NotifyEvent, enabled: boolean) {
  const { error } = await supabase
    .from('notify_prefs')
    .upsert({ user_id: userId, event, enabled }, { onConflict: 'user_id,event' });
  return { ok: !error, error: error?.message };
}
