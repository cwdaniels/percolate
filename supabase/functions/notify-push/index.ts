// notify-push — sends real push notifications for a couple of events.
//
// Driven by pg_net triggers in the database (see schema.sql), which POST a
// payload of { type, record }. Handles:
//   type "message" (the default when absent) — an INSERT on `messages`:
//     notifies anyone @mentioned or @team'd in a team channel, and everyone
//     in a private/DM thread (every message there is "addressed").
//   type "member_joined" — an INSERT on `team_members`: notifies that
//     team's owners that someone accepted their invite code.
//   type "roast_ready" / "delivered" — an order changed stage.
//   type "supply_added" — a new checklist item landed.
//   type "task_assigned" — a checklist item got assigned to someone.
// All four of the above are opt-out per person via public.notify_prefs.
//   type "shift_promoted" — an alternate was auto-promoted into a real
//     shift slot after someone dropped out. NOT pref-gated: like mentions
//     and DMs it's personally addressed, and missing it could mean not
//     showing up for a shift you're now scheduled to work.
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

// Shared secret proving a request really came from the database trigger.
// Without this, the platform's JWT gate is satisfied by the *anon* key —
// which ships in the browser bundle — so anyone could POST a forged
// `record` and push arbitrary text to a channel under any sender's name.
const NOTIFY_PUSH_SECRET = Deno.env.get("NOTIFY_PUSH_SECRET") ?? "";

// Constant-time compare so a caller can't probe the secret byte by byte.
function secretMatches(given: string | null): boolean {
  if (!NOTIFY_PUSH_SECRET || !given) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(NOTIFY_PUSH_SECRET);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

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

// Shared tail for every kind of notification: drop anyone in Focus Mode, look
// up their devices, send, and prune subscriptions the push service has
// retired. Kept in one place so a new notification kind can't accidentally
// skip the Focus Mode check.
async function deliver(ids: string[], title: string, body: string): Promise<Response> {
  const targetIds0 = [...new Set(ids)];
  if (!targetIds0.length) return new Response("no targets", { status: 200 });

  const { data: focus } = await admin
    .from("focus_settings")
    .select("user_id, paused_until, schedule_enabled, schedule_start_min, schedule_end_min")
    .in("user_id", targetIds0);
  const nowMs = Date.now();
  const nowUtcMin = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
  const pausedIds = new Set(
    (focus ?? [])
      .filter((f) => {
        if (f.paused_until && new Date(f.paused_until).getTime() > nowMs) return true;
        if (!f.schedule_enabled || f.schedule_start_min == null || f.schedule_end_min == null) {
          return false;
        }
        const { schedule_start_min: start, schedule_end_min: end } = f;
        return start <= end
          ? nowUtcMin >= start && nowUtcMin < end
          : nowUtcMin >= start || nowUtcMin < end;
      })
      .map((f) => f.user_id as string)
  );
  const targetIds = targetIds0.filter((id) => !pausedIds.has(id));
  if (!targetIds.length) return new Response("all targets in focus mode", { status: 200 });

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("user_id, endpoint, keys")
    .in("user_id", targetIds);
  if (!subs?.length) return new Response("no subscriptions", { status: 200 });

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
}


// Drops anyone who has switched this event off. An absent row means "on":
// these are opt-OUT, so a teammate who never visits Settings still hears
// about a roast being ready.
async function respectingPrefs(ids: string[], event: string): Promise<string[]> {
  if (!ids.length) return ids;
  const { data } = await admin
    .from("notify_prefs")
    .select("user_id, enabled")
    .eq("event", event)
    .in("user_id", ids);
  const off = new Set(
    (data ?? []).filter((r) => r.enabled === false).map((r) => r.user_id as string)
  );
  return ids.filter((id) => !off.has(id));
}

// Everyone on the team except whoever caused the event.
async function teamAudience(teamId: string, exclude?: string): Promise<string[]> {
  const { data } = await admin
    .from("team_members")
    .select("user_id")
    .eq("team_id", teamId);
  return (data ?? [])
    .map((m) => m.user_id as string)
    .filter((id) => id !== exclude);
}

Deno.serve(async (req) => {
  try {
    if (!VAPID_PRIVATE_KEY) {
      console.error("VAPID_PRIVATE_KEY secret is not set");
      return new Response("not configured", { status: 200 });
    }

    if (!NOTIFY_PUSH_SECRET) {
      console.error("NOTIFY_PUSH_SECRET is not set — refusing to send");
      return new Response("not configured", { status: 500 });
    }
    if (!secretMatches(req.headers.get("x-percolate-signature"))) {
      // 403, not 200: this is a real rejection, and unlike a malformed
      // payload it should be visible in logs if it ever starts happening.
      return new Response("forbidden", { status: 403 });
    }

    const payload = await req.json();
    // `type` arrived with member-join notifications. A payload without it is
    // a message insert from the original trigger, so default accordingly —
    // that keeps things working if the trigger and this function are ever
    // deployed out of order.
    const kind: string = payload.type ?? "message";
    const record = payload.record;

    // ---- someone joined a team → tell that team's owners ----------------
    if (kind === "member_joined") {
      if (!record?.team_id || !record?.user_id) {
        return new Response("ignored", { status: 200 });
      }
      // The owner row written alongside a brand-new team isn't a "join".
      // The trigger already skips this; belt and braces.
      if (record.role === "owner") return new Response("ignored", { status: 200 });

      const [teamRes, joinerRes, ownersRes] = await Promise.all([
        admin.from("teams").select("name").eq("id", record.team_id).maybeSingle(),
        admin.from("profiles").select("name").eq("id", record.user_id).maybeSingle(),
        admin
          .from("team_members")
          .select("user_id")
          .eq("team_id", record.team_id)
          .eq("role", "owner"),
      ]);

      const owners = (ownersRes.data ?? [])
        .map((o) => o.user_id as string)
        .filter((id) => id !== record.user_id);

      // Deliberately no email in the body — this lands on a lock screen.
      return await deliver(
        owners,
        "🎉 New teammate",
        `${joinerRes.data?.name ?? "Someone"} just joined ${
          teamRes.data?.name ?? "your team"
        }.`
      );
    }


    // ---- an order moved to ready / delivered -----------------------------
    if (kind === "roast_ready" || kind === "delivered") {
      if (!record?.channel_id) return new Response("ignored", { status: 200 });
      const { data: channel } = await admin
        .from("channels")
        .select("team_id, name")
        .eq("id", record.channel_id)
        .maybeSingle();
      if (!channel?.team_id) return new Response("no channel", { status: 200 });

      const actor = kind === "delivered" ? record.delivered_by : undefined;
      const ids = await respectingPrefs(
        await teamAudience(channel.team_id, actor ?? undefined),
        kind
      );
      const title = kind === "roast_ready" ? "🔥 Roast ready" : "🚚 Delivered";
      const body =
        kind === "roast_ready"
          ? `${record.title ?? "An order"} is roasted and ready to go out.`
          : `${record.title ?? "An order"} has been delivered.`;
      return await deliver(ids, title, body);
    }

    // ---- a new item landed on a checklist --------------------------------
    if (kind === "supply_added") {
      if (!record?.channel_id) return new Response("ignored", { status: 200 });
      const { data: channel } = await admin
        .from("channels")
        .select("team_id, name, emoji")
        .eq("id", record.channel_id)
        .maybeSingle();
      if (!channel?.team_id) return new Response("no channel", { status: 200 });

      const { data: who } = await admin
        .from("profiles")
        .select("name")
        .eq("id", record.added_by)
        .maybeSingle();

      const ids = await respectingPrefs(
        await teamAudience(channel.team_id, record.added_by),
        "supply_added"
      );
      return await deliver(
        ids,
        `${channel.emoji ?? "📋"} ${channel.name}`,
        `${who?.name ?? "Someone"} added: ${String(record.text ?? "").slice(0, 100)}`
      );
    }

    // ---- a checklist item got assigned to someone ------------------------
    if (kind === "task_assigned") {
      if (!record?.assigned_to || !record?.channel_id) {
        return new Response("ignored", { status: 200 });
      }
      const { data: channel } = await admin
        .from("channels")
        .select("name, emoji")
        .eq("id", record.channel_id)
        .maybeSingle();
      const { data: who } = record.assigned_by
        ? await admin.from("profiles").select("name").eq("id", record.assigned_by).maybeSingle()
        : { data: null };

      const ids = await respectingPrefs([record.assigned_to as string], "task_assigned");
      return await deliver(
        ids,
        `📌 Assigned to you`,
        `${who?.name ?? "Someone"} assigned you a task in ${channel?.name ?? "a checklist"}: ${String(
          record.text ?? ""
        ).slice(0, 100)}`
      );
    }

    // ---- an alternate got promoted into a real shift slot ----------------
    if (kind === "shift_promoted") {
      if (!record?.user_id || !record?.date) {
        return new Response("ignored", { status: 200 });
      }
      // date is a bare YYYY-MM-DD; pin to UTC noon so the weekday can't
      // slip a day in either direction when formatted.
      const when = new Date(`${record.date}T12:00:00Z`).toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
      // Deliberately not pref-gated (see header comment) — but Focus Mode
      // still applies via deliver().
      return await deliver(
        [record.user_id as string],
        "📣 You're off the bench!",
        `A spot opened up for ${when} — you've been called up from the bullpen. You're on the books now ⚾️`
      );
    }

    // ---- a message landed → tell whoever it was addressed to ------------
    const message = record;
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

    return await deliver(
      targetIds,
      channel.type === "dm" ? `${senderName} (private)` : `${senderName} · #${channel.name}`,
      (message.text as string).replace(/[*`#]/g, "").slice(0, 140)
    );
  } catch (err) {
    console.error(err);
    // 200 so the webhook doesn't retry-storm on a bug.
    return new Response("error", { status: 200 });
  }
});
