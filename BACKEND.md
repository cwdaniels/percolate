# Percolate backend — design & plan

_Designed 2026-07-16 (Fable pass). The schema in [supabase/schema.sql](supabase/schema.sql) is the deliverable; this file explains it and hands off implementation._

## Architecture

One Supabase project provides everything:

| Piece | What it does for Percolate |
|---|---|
| **Postgres + RLS** | All data; every privacy rule enforced *in the database*, not in app code |
| **Auth (magic link)** | Staff sign in by tapping an email link — no passwords to forget |
| **Realtime** | Live messages/boards/schedules; subscriptions respect RLS |
| **Edge Functions** | Phase 2: web-push notifications on mentions/@team |
| **Storage** | Phase 3: attachments (invoices) |

The client keeps its current shape: `store.tsx`'s `Api` interface was deliberately built to mirror these calls, so views don't change — only the store's internals do.

## Security model (who sees what)

Membership rows in `team_members` are the root of all access. Roles are **per-team** (you can be owner of Fireweed and staff on another team) — this is an upgrade from the prototype's global role.

- **Team data** (channels, messages, boards, schedules, notes, bean catalog, orders): visible to members of that team only. Cross-team reads are impossible, not merely unlinked.
- **Private threads (DMs)**: channels with no team, owned by their 2+ members (`channel_members`). Only members can read them; they never appear in team feeds or team queries. Threads are created solely through `open_dm()`, which refuses participants who don't share a team with you.
- **Mentions inbox state** (`mention_meta`): read/archive/delete is per-person — archiving a mention hides it for you, never for anyone else. Same for DM read-times (`channel_reads`).
- **Payroll** (`hours_entries`): staff can only read their own rows; team **owners** read everyone's. This is the strictest table.
- **Profiles**: you can see people who share a team with you — nobody else on the platform.
- **Invite codes**: owner-only visibility (separate `team_invites` table); staff join via the `join_team(code)` function without ever being able to browse codes.
- **Editing**: you may edit/delete only your own messages; owners may delete any message in their team. "Anyone can check off a list item" is real, but a column-freeze trigger means staff can *only* flip the done flag — never rewrite an item's text or author.
- **Pins/reactions**: separate tables, so pinning someone's message never requires write access to the message itself.
- **Safety rails**: a team can never lose its last owner (trigger), home channels can't be deleted (policy), anonymous users have zero access (revoked outright).

## Design decisions worth knowing

1. **Reactions/pins as rows, not JSON** — concurrent taps from two phones can't clobber each other; toggling is insert/delete of your own row.
2. **`edited` flag is set by a database trigger** when message text changes — clients can't forge or forget it.
3. **Mentions stay client-computed** (same regex logic as today) over already-visible messages; only the "last seen" timestamp moved server-side (`user_state`). No mention data leaks because you can only scan messages RLS already gives you.
4. **Orders are two tables** (`orders` + `order_items`) so two people can check different beans simultaneously without conflict; `delivered_by/at` are stamped by a trigger, and completed orders stay in history rather than being deleted.
5. **Search stays client-side** for v1 — the team's data volume fits comfortably in the synced cache, so search needs no server round-trip. (Postgres full-text search is the upgrade path if a team's history ever outgrows this.)
6. **Fresh start on data**: the local demo data (Maya, Jonah, Quinn) stays on-device; real accounts start clean. Migrating fake seed data to production would be more work than value.

## Setup — what you (Casey) do once

1. Create a free project at [supabase.com](https://supabase.com) (name it whatever you like — e.g. `percolate`; the project name is just a dashboard label. Pick a region near NC).
2. In the dashboard: **SQL Editor → New query**, paste all of `supabase/schema.sql`, **Run**. It should say "Success".
3. **Authentication → Sign In / Up**: make sure **Email** is enabled (magic link is on by default). Turn **off** "Allow new users to sign up" *only if* you want invite-code-only growth later; leave on for now.
4. **Project Settings → API**: copy the **Project URL** and the **anon/publishable key** into a new file `percolate/.env.local`:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
   (The anon key is safe in the client — RLS is the security. Never share the `service_role` key with anyone, including chat.)

## Implementation plan (next phase — Opus/Sonnet territory)

> **Model note:** this section is deliberate, well-scoped translation work. Switch to `claude-opus-4-8` (or Sonnet 5) before starting it; Fable is not needed here.

1. `npm install @supabase/supabase-js`; create `src/lib/supabase.ts` from the env vars.
2. **Auth screens**: email field → magic link → session; onboarding's name step writes to `profiles`. Keep the existing onboarding slides.
3. **Swap the store internals**: reimplement each `Api` method as a Supabase query/mutation; hold a normalized cache in React state fed by initial fetch + `postgres_changes` subscriptions per table. Optimistic updates for send/toggle so the UI stays instant.
4. **Reshape client types** to match the schema: role moves onto membership (per-team); reactions become `(message_id, user_id, emoji)` rows; pins read from `pins`; order items come from `order_items`; DM threads call `open_dm(other_ids)` instead of computing local ids; mention read/archive state reads/writes `mention_meta`, DM unreads use `channel_reads`.
5. **Invites UI**: owner Settings gains "Invite code" (from `team_invites`) + a join-by-code field on onboarding; "add teammate by name" demo goes away.
6. **Deploy** the PWA (Netlify/Vercel) so phones can install it over HTTPS.
7. **Phase 2 — push**: service worker `push` handler, VAPID keys, an edge function triggered on message insert that notifies mentioned users' `push_subscriptions`.
8. **Phase 3 — attachments**: Supabase Storage bucket with team-scoped policies.
