import { supabase } from './supabase';

export const RETENTION_OPTIONS: { days: number | null; label: string }[] = [
  { days: null, label: 'Keep everything' },
  { days: 365, label: '1 year' },
  { days: 180, label: '6 months' },
  { days: 90, label: '90 days' },
  { days: 30, label: '30 days' },
];

export async function getRetention(teamId: string): Promise<number | null> {
  const { data } = await supabase
    .from('teams')
    .select('retention_days')
    .eq('id', teamId)
    .maybeSingle();
  return data?.retention_days ?? null;
}

export async function setRetention(teamId: string, days: number | null) {
  const { error } = await supabase
    .from('teams')
    .update({ retention_days: days })
    .eq('id', teamId);
  return { ok: !error, error: error?.message };
}

// How many messages the next nightly run would remove under the CURRENT
// saved policy. Shown before any change is committed so nobody discovers
// the scope of a deletion after the fact.
export async function countPurgeable(): Promise<number> {
  const { data, error } = await supabase.rpc('count_purgeable_messages');
  return error ? 0 : (data as number) ?? 0;
}
