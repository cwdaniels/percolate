// notify-push — sends a real push notification when a message lands.
//
// Triggered by a Supabase Database Webhook on INSERT to `messages`.
// Notifies: (a) anyone @mentioned or @team'd in a team channel, and
// (b) everyone in a private/DM thread (every message there is "addressed").
//
// Deploy via the Supabase dashboard: Edge Functions → Create function
// "notify-push" → paste this file → Deploy. Then add ONE secret:
//   VAPID_PRIVATE_KEY  (generated alongside the public key baked in below —
//   never put the private key in git or in the client app)
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-provided by the
// platform inside every edge function; nothing to set for those.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// Public — safe to read in source. Must match VITE_VAPID_PUBLIC_KEY in the
// client's .env exactly, since both sides are one matched key pair.
const VAPID_PUBLIC_KEY =
  "BPDsCCyqqBeFcqwNexXSdoO4ybYokXcbU_KFyRvze5wd_rykbh5s3CpSe5ixX3CFqV47D5fRR4ZmraxZ08pB-g8";
const VAPID_SUBJECT = "mailto:danielscw@guilford.edu";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

function parseMentions(text: string): { names: string[]; team: boolean } {
  const raw = Array.from(text.matchAll(/@([A-Za-z0-9_]+)/g)).map((m) =>
    m[1].toLowerCase()
  );
  const team = raw.some((n) => ["team", "everyone", "all"].includes(n));
  return { names: raw.filter((n) => !["team", "everyone", "all"].includes(n)), team };
}

Deno.serve(async (req) => {
  try {
    if (!VAPID_PRIVATE_KEY) {
      console.error("VAPID_PRIVATE_KEY secret is not set");
      return new Response("not configured", { status: 200 });
    }

    const payload = await req.json();
    const message = payload.record;
    if (!message?.text || !message?.channel_id || !message?.user_id) {
      return new Response("ignored", { status: 200 });
    }

    const { data: channel } = await admin
      .from("channels")
      .select("id, team_id, type, name")
      .eq("id", message.channel_id)
      .maybeSingle();
    if (!channel) return new Response("no channel", { status: 200 });

    const { data: sender } = await admin
      .from("profiles")
      .select("name")
      .eq("id", message.user_id)
      .maybeSingle();
    const senderName = sender?.name ?? "Someone";

    let targetIds: string[] = [];

    if (channel.type === "dm") {
      const { data: members } = await admin
        .from("channel_members")
        .select("user_id")
        .eq("channel_id", channel.id);
      targetIds = (members ?? [])
        .map((m) => m.user_id as string)
        .filter((id) => id !== message.user_id);
    } else if (channel.team_id) {
      const { names, team } = parseMentions(message.text as string);
      if (names.length || team) {
        const { data: members } = await admin
          .from("team_members")
          .select("user_id, profiles(name)")
          .eq("team_id", channel.team_id);
        const rows = (members ?? []) as unknown as {
          user_id: string;
          profiles: { name: string } | null;
        }[];
        targetIds = rows
          .filter((r) => r.user_id !== message.user_id)
          .filter((r) => team || names.includes((r.profiles?.name ?? "").toLowerCase()))
          .map((r) => r.user_id);
      }
    }

    targetIds = [...new Set(targetIds)];
    if (!targetIds.length) return new Response("no targets", { status: 200 });

    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("user_id, endpoint, keys")
      .in("user_id", targetIds);
    if (!subs?.length) return new Response("no subscriptions", { status: 200 });

    const title = channel.type === "dm" ? `${senderName} (private)` : `${senderName} · #${channel.name}`;
    const body = (message.text as string).replace(/[*`#]/g, "").slice(0, 140);

    await Promise.allSettled(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: s.keys as { p256dh: string; auth: string } },
            JSON.stringify({ title, body, url: "/" })
          );
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            // Subscription is dead (uninstalled, expired) — clean it up.
            await admin
              .from("push_subscriptions")
              .delete()
              .eq("user_id", s.user_id)
              .eq("endpoint", s.endpoint);
          } else {
            console.error("push send failed", status, err);
          }
        }
      })
    );

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error(err);
    // 200 so the webhook doesn't retry-storm on a bug.
    return new Response("error", { status: 200 });
  }
});
