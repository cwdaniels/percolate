import { supabase } from './supabase';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

// Push services want the VAPID key as a raw byte array, not the base64url
// string it's distributed as.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const out = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) out[i] = rawData.charCodeAt(i);
  return out;
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export async function getPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

// Requests permission (if needed), creates a push subscription, and stores
// it in Supabase so the notify-push edge function can find it later.
export async function enablePush(userId: string): Promise<{ ok: boolean; error?: string }> {
  if (!pushSupported()) return { ok: false, error: 'Not supported in this browser.' };
  if (!VAPID_PUBLIC_KEY) return { ok: false, error: 'Push isn’t configured yet.' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, error: 'Permission wasn’t granted.' };

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    });
  }

  const json = sub.toJSON() as { endpoint?: string; keys?: Record<string, string> };
  if (!json.endpoint || !json.keys) return { ok: false, error: 'Subscription failed.' };

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({ user_id: userId, endpoint: json.endpoint, keys: json.keys });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function disablePush(userId: string): Promise<void> {
  const sub = await getPushSubscription();
  if (!sub) return;
  await supabase
    .from('push_subscriptions')
    .delete()
    .eq('user_id', userId)
    .eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}
