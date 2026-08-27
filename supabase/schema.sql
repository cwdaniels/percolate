-- ============================================================
-- Percolate — Supabase schema v1
-- ============================================================
-- Run this once in the Supabase SQL editor of a fresh project.
--
-- Security model in one paragraph: every table has Row-Level
-- Security enabled. Membership in a team (team_members) is the
-- root of all access: you can see a team's channels and their
-- contents only if you are a member, and owner-only powers
-- (payroll, channel management, role changes) come from
-- role = 'owner' on YOUR membership row of THAT team — roles are
-- per-team, not global. Helper functions are SECURITY DEFINER so
-- policies never recurse into themselves. Column-freeze triggers
-- stop UPDATE policies from being wider than intended (e.g. staff
-- may toggle a checklist item's done flag but not rewrite its
-- text or author).
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- Tables
-- ------------------------------------------------------------

-- One row per auth user; created automatically by trigger.
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text not null default 'New teammate',
  emoji      text not null default '☕️',
  color      text not null default '#b5562c',
  created_at timestamptz not null default now()
);

create table public.teams (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  emoji          text not null default '☕️',
  created_by     uuid not null references public.profiles (id),
  -- Message retention. NULL = keep everything (the default). Floor of 7 so
  -- a mistyped '1' can't wipe a week of conversation before anyone notices.
  retention_days integer check (retention_days is null or retention_days >= 7),
  created_at     timestamptz not null default now()
);

-- Invite codes live apart from teams so only owners can read them.
create table public.team_invites (
  team_id uuid primary key references public.teams (id) on delete cascade,
  code    text not null unique default encode(gen_random_bytes(6), 'hex')
);

create table public.team_members (
  team_id    uuid not null references public.teams (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       text not null default 'staff' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index team_members_user_idx on public.team_members (user_id);

-- team_id is null exactly for DM threads, which belong to their
-- members (channel_members) instead of a team.
create table public.channels (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid references public.teams (id) on delete cascade,
  type        text not null check
    (type in ('chat', 'schedule', 'board', 'notes', 'catalog', 'orders', 'dm')),
  name        text not null,
  emoji       text not null default '💬',
  description text not null default '',
  lists       jsonb,                          -- board sections: [{id,title,emoji}]
  is_home     boolean not null default false, -- the team feed channel; undeletable
  -- Per-weekday staffing cap for schedule-type channels, e.g.
  -- {"6": {"max": 2, "altMax": 1}} for Saturdays. Keyed by JS day-of-week
  -- (0=Sun..6=Sat) as a string (jsonb object keys are always text). A day
  -- with no entry is unlimited — unchanged from today unless an owner
  -- explicitly sets a cap. Client decides new-signup primary/alternate
  -- placement; promote_alternate_on_signup_delete() below is the only
  -- server-enforced part (auto-promoting on cancellation).
  schedule_capacity jsonb,
  created_at  timestamptz not null default now(),
  check ((type = 'dm') = (team_id is null))
);
create index channels_team_idx on public.channels (team_id);

-- Membership of DM threads (2+ people). Rows are only ever created by
-- the open_dm() function.
create table public.channel_members (
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  primary key (channel_id, user_id)
);
create index channel_members_user_idx on public.channel_members (user_id);

create table public.messages (
  id           uuid primary key default gen_random_uuid(),
  channel_id   uuid not null references public.channels (id) on delete cascade,
  user_id      uuid not null references public.profiles (id),
  text         text not null check (length(text) between 1 and 8000),
  edited       boolean not null default false,
  reply_to_id  uuid references public.messages (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index messages_channel_idx on public.messages (channel_id, created_at);

-- Pins are separate from messages so "anyone in the channel can
-- pin/unpin" never requires UPDATE rights on someone else's message.
create table public.pins (
  message_id uuid primary key references public.messages (id) on delete cascade,
  pinned_by  uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

-- One row per (message, user, emoji): toggling is insert/delete of
-- your own row, so concurrent reactions never clobber each other.
create table public.reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  emoji      text not null check (length(emoji) <= 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create table public.shift_signups (
  id           uuid primary key default gen_random_uuid(),
  channel_id   uuid not null references public.channels (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  date         date not null,
  note         text not null default '',
  is_alternate boolean not null default false,
  created_at   timestamptz not null default now()
);
create index shift_signups_channel_idx on public.shift_signups (channel_id, date);
create index shift_signups_alt_idx on public.shift_signups (channel_id, date, is_alternate, created_at);

create table public.list_items (
  id          uuid primary key default gen_random_uuid(),
  channel_id  uuid not null references public.channels (id) on delete cascade,
  list_id     text not null,
  text        text not null check (length(text) between 1 and 2000),
  added_by    uuid not null references public.profiles (id),
  done        boolean not null default false,
  due_date    date,
  notes       text not null default '',
  assigned_to uuid references public.profiles (id),
  assigned_by uuid references public.profiles (id),
  created_at  timestamptz not null default now()
);
create index list_items_channel_idx on public.list_items (channel_id);
create index list_items_due_idx on public.list_items (due_date) where due_date is not null;
create index list_items_assigned_idx on public.list_items (assigned_to) where assigned_to is not null;

create table public.notes (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  title      text not null check (length(title) between 1 and 200),
  body       text not null default '',
  updated_by uuid not null references public.profiles (id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index notes_channel_idx on public.notes (channel_id);

-- Payroll-sensitive: staff see only their own rows; owners of the
-- team see everyone's. Enforced below — this is the one table where
-- a policy mistake would leak wages, so its policies are the strictest.
-- One row = one shift. Tips live here rather than in a pooling system
-- because Fireweed splits them at the end of the shift — each person just
-- records what they actually took home.
create table public.hours_entries (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  date       date not null,
  hours      numeric(5, 2) not null check (hours > 0 and hours <= 24),
  tips       numeric(10, 2) not null default 0 check (tips >= 0),
  note       text not null default '',
  created_at timestamptz not null default now()
);
create index hours_entries_team_idx on public.hours_entries (team_id, date);
create index hours_entries_user_idx on public.hours_entries (user_id, date);

-- ---------------------------------------------------------------
-- Payroll
-- ---------------------------------------------------------------

-- Wage HISTORY, not a single mutable rate. A raise is a new row with a
-- later effective_from, so a period already worked keeps costing what it
-- actually cost. With one `wage` column per person instead, giving someone
-- a raise would silently restate every past payroll — the exact thing a
-- payroll record exists to prevent.
create table public.wage_rates (
  id             uuid primary key default gen_random_uuid(),
  team_id        uuid not null references public.teams (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  rate           numeric(10,2) not null check (rate >= 0),
  effective_from date not null,
  created_by     uuid not null references public.profiles (id),
  created_at     timestamptz not null default now(),
  unique (user_id, effective_from)
);
create index wage_rates_lookup_idx on public.wage_rates (user_id, effective_from desc);

-- A pay period. Fireweed runs calendar months, paid on the 15th of the
-- following month. Totals are frozen onto pay_period_lines at mark-paid
-- time so a later rate change or entry edit can't rewrite what was paid.
-- Just the date-range container. Paid state lives on the LINES so one
-- person can be settled early without freezing the rest of the team.
create table public.pay_periods (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams (id) on delete cascade,
  period_start date not null,
  period_end   date not null,
  note         text not null default '',
  created_at   timestamptz not null default now(),
  unique (team_id, period_start, period_end),
  check (period_end >= period_start)
);

-- Deliberately no `rate` column: someone can be paid at two different rates
-- within one period, and a single number there would be a lie. Effective
-- rate is gross/hours when a report needs to show one.
create table public.pay_period_lines (
  id            uuid primary key default gen_random_uuid(),
  pay_period_id uuid not null references public.pay_periods (id) on delete cascade,
  user_id       uuid not null references public.profiles (id),
  hours         numeric(7,2) not null default 0,
  gross         numeric(10,2) not null default 0,
  tips          numeric(10,2) not null default 0,
  paid_at       timestamptz,
  paid_by       uuid references public.profiles (id),
  unique (pay_period_id, user_id)
);

-- Owner-only notes about a teammate: hire date, raise history, anything
-- personal. Deliberately NOT a column on team_members, whose select policy
-- exposes rows to every teammate — these must stay private to the owner.
create table public.staff_notes (
  team_id    uuid not null references public.teams (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  note       text not null default '',
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

-- Append-only trail of changes to the numbers that affect pay. changed_by
-- is NULLABLE on purpose: auth.uid() is null for admin/CLI/service-role
-- edits, and making it NOT NULL meant this trigger *rejected* those edits
-- outright rather than recording them. Null = "changed out-of-band".
create table public.hours_audit (
  id         uuid primary key default gen_random_uuid(),
  entry_id   uuid not null,           -- not a FK: the entry may be deleted
  team_id    uuid not null references public.teams (id) on delete cascade,
  entry_user uuid not null references public.profiles (id),
  changed_by uuid references public.profiles (id),
  action     text not null check (action in ('update','delete')),
  old_hours  numeric(5,2),  new_hours numeric(5,2),
  old_tips   numeric(10,2), new_tips  numeric(10,2),
  changed_at timestamptz not null default now()
);
create index hours_audit_team_idx on public.hours_audit (team_id, changed_at desc);

-- Per-user, per-message state for the Mentions inbox (read / archive /
-- delete are personal — archiving a mention hides it for you only).
create table public.mention_meta (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  read       boolean not null default false,
  archived   boolean not null default false,
  deleted    boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, message_id)
);

-- Per-user last-read time of a channel (drives DM unread badges).
create table public.channel_reads (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  channel_id   uuid not null references public.channels (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);

-- The bean library: one row per bean, editable wiki-style by the team.
create table public.catalog_items (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  name       text not null check (length(name) between 1 and 200),
  origin     text not null default '',
  roast      text not null default '',
  flavor     text not null default '',
  certs      text not null default '',
  notes      text not null default '',
  source_url text not null default '',
  cost       numeric(10,2),
  updated_by uuid not null references public.profiles (id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index catalog_items_channel_idx on public.catalog_items (channel_id);

-- Wholesale orders: paste → roast → ready → delivered. The order never
-- disappears on completion; it parks in history for invoicing.
create table public.orders (
  id           uuid primary key default gen_random_uuid(),
  channel_id   uuid not null references public.channels (id) on delete cascade,
  title        text not null check (length(title) between 1 and 300),
  stage        text not null default 'roast'
    check (stage in ('roast', 'ready', 'delivered')),
  created_by   uuid not null references public.profiles (id),
  created_at   timestamptz not null default now(),
  delivered_by uuid references public.profiles (id),
  delivered_at timestamptz,
  -- Distinct from `stage`: an order can be delivered but not yet invoiced.
  -- stamp_order_update() below silently normalizes invoiced back to false
  -- whenever stage isn't 'delivered' (e.g. un-delivering an invoiced order
  -- un-invoices it too) — this constraint documents that invariant and
  -- backstops any future code path that updates the row directly.
  invoiced     boolean not null default false,
  invoiced_by  uuid references public.profiles (id),
  invoiced_at  timestamptz,
  constraint orders_invoiced_requires_delivered check (not invoiced or stage = 'delivered')
);
create index orders_channel_idx on public.orders (channel_id, stage);

create table public.order_items (
  id       uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  text     text not null check (length(text) between 1 and 500),
  done     boolean not null default false,
  position integer not null default 0
);
create index order_items_order_idx on public.order_items (order_id);

-- Web-push subscriptions, one row per device. Used by the push
-- edge function (phase 2); harmless to have now.
create table public.push_subscriptions (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  endpoint   text not null,
  keys       jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, endpoint)
);

-- Focus Mode: on-demand pause (paused_until) and/or a recurring daily
-- quiet-hours window. Window bounds are stored as UTC minutes-since-
-- midnight — the client converts from the user's local time so the
-- notify-push edge function can compare against UTC `now()` with no
-- timezone lookup of its own. schedule_start_min > schedule_end_min
-- means the window wraps past midnight UTC.
create table public.focus_settings (
  user_id            uuid primary key references public.profiles(id) on delete cascade,
  paused_until       timestamptz,
  schedule_enabled   boolean not null default false,
  schedule_start_min smallint,
  schedule_end_min   smallint,
  updated_at         timestamptz not null default now()
);

-- Per-event opt-out for the "extra" push notifications (Focus Mode above
-- is a blanket pause; this is per-event-type instead). Opt-OUT: an absent
-- row means enabled, so a new teammate hears about a roast being ready
-- without having to go find the switch first. Mentions and DMs are not
-- covered here — those always come through.
create table public.notify_prefs (
  user_id uuid not null references public.profiles(id) on delete cascade,
  event   text not null check (event in ('roast_ready','delivered','supply_added','task_assigned')),
  enabled boolean not null default true,
  primary key (user_id, event)
);

-- Gates who may create a brand-new team from scratch (as opposed to
-- joining an existing one via invite code, which is unaffected). No RLS
-- policies are defined here on purpose — with RLS enabled and zero
-- policies, this table is unreadable/unwritable through the client API
-- entirely, and is only ever consulted through can_create_team() below
-- (SECURITY DEFINER), matching the is_team_member()/is_dm_member()
-- pattern used throughout this schema. Add/remove rows via the CLI.
create table public.team_creation_allowlist (
  email      text primary key,
  note       text,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Helper functions (SECURITY DEFINER: they bypass RLS internally,
-- which is what lets policies on team_members/channels reference
-- those same tables without infinite recursion). STABLE so the
-- planner can cache them within a statement.
-- ------------------------------------------------------------

create or replace function public.is_team_member(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_members
    where team_id = t and user_id = auth.uid()
  );
$$;

create or replace function public.is_team_owner(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_members
    where team_id = t and user_id = auth.uid() and role = 'owner'
  );
$$;

create or replace function public.is_dm_member(c uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from channel_members
    where channel_id = c and user_id = auth.uid()
  );
$$;

create or replace function public.can_see_channel(c uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from channels ch
    where ch.id = c
      and (
        (ch.team_id is not null and public.is_team_member(ch.team_id))
        or (ch.type = 'dm' and public.is_dm_member(ch.id))
      )
  );
$$;

-- Visible order = visible channel (for order_items policies).
create or replace function public.can_see_order(o uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from orders ord
    where ord.id = o and public.can_see_channel(ord.channel_id)
  );
$$;

-- Is the caller in any DM thread with `other`? Extends profile
-- visibility to DM partners even if they later leave the shared team.
create or replace function public.shares_dm_with(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from channel_members a
    join channel_members b using (channel_id)
    where a.user_id = auth.uid() and b.user_id = other
  );
$$;

-- Is the caller's own email on the team-creation allowlist? Used only
-- by teams_insert — joining an existing team via invite code (join_team)
-- is a separate, already-scoped path and unaffected by this gate.
create or replace function public.can_create_team()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_creation_allowlist
    where lower(email) = lower(auth.email())
  );
$$;

create or replace function public.is_owner_of_channel(c uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from channels ch
    where ch.id = c and public.is_team_owner(ch.team_id)
  );
$$;

-- Can the caller see this message (via its channel)?
create or replace function public.can_see_message(m uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from messages msg
    where msg.id = m and public.can_see_channel(msg.channel_id)
  );
$$;

-- Do the caller and `other` share at least one team? Gates profile
-- visibility: you can see the people you work with, nobody else.
create or replace function public.shares_team_with(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from team_members a
    join team_members b using (team_id)
    where a.user_id = auth.uid() and b.user_id = other
  );
$$;

-- ------------------------------------------------------------
-- Triggers
-- ------------------------------------------------------------

-- New auth user -> profile row (name from signup metadata or email).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- New team -> creator becomes owner, invite code is minted, and a
-- #general home channel exists from the first moment.
create or replace function public.handle_new_team()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.team_members (team_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  insert into public.team_invites (team_id) values (new.id);
  insert into public.channels (team_id, type, name, emoji, description, is_home)
  values (new.id, 'chat', 'general', '☕️', 'The team feed', true);
  return new;
end;
$$;
create trigger on_team_created
  after insert on public.teams
  for each row execute function public.handle_new_team();

-- A team must always keep at least one owner — except while the team
-- itself is being deleted (its row is already gone when the member
-- rows cascade, so the guard below skips that case).
create or replace function public.protect_last_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from teams where id = old.team_id) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner')
     and not exists (
       select 1 from team_members
       where team_id = old.team_id and role = 'owner'
         and user_id <> old.user_id
     )
  then
    raise exception 'a team must keep at least one owner';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger team_members_protect_last_owner
  before update or delete on public.team_members
  for each row execute function public.protect_last_owner();

-- Column freezes: UPDATE policies say WHO may update; these say WHAT
-- they may change. Anything reassigned from OLD is untouchable.

create or replace function public.freeze_message_columns()
returns trigger language plpgsql as $$
begin
  new.channel_id  := old.channel_id;
  new.user_id     := old.user_id;
  new.created_at  := old.created_at;
  new.reply_to_id := old.reply_to_id;
  if new.text is distinct from old.text then
    new.edited := true;
  end if;
  return new;
end;
$$;
create trigger messages_freeze before update on public.messages
  for each row execute function public.freeze_message_columns();

-- Original text/authorship are locked; done, due_date, notes, and the
-- assignment fields stay open to the whole channel — same wiki-style trust
-- model as notes and the catalog ("anyone can add or check off").
create or replace function public.freeze_list_item_columns()
returns trigger language plpgsql as $$
begin
  new.channel_id := old.channel_id;
  new.list_id    := old.list_id;
  new.text       := old.text;
  new.added_by   := old.added_by;
  new.created_at := old.created_at;
  return new;
end;
$$;
create trigger list_items_freeze before update on public.list_items
  for each row execute function public.freeze_list_item_columns();

-- Assigning a task pings that one person. AFTER trigger (not the freeze
-- trigger above, which is BEFORE and only for locking columns) so it fires
-- once the row is actually committed.
create or replace function public.notify_task_assigned_trigger()
returns trigger language plpgsql security definer
set search_path = public, net
as $$
begin
  if NEW.assigned_to is null then return NEW; end if;
  if TG_OP = 'UPDATE' and NEW.assigned_to is not distinct from OLD.assigned_to then
    return NEW;
  end if;
  if NEW.assigned_to = auth.uid() then return NEW; end if;
  perform net.http_post(
    url := 'https://vwacjfsalvbyokqvhzes.supabase.co/functions/v1/notify-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <VITE_SUPABASE_ANON_KEY>',
      'x-percolate-signature', '<NOTIFY_PUSH_SECRET>'
    ),
    body := jsonb_build_object('type', 'task_assigned', 'record', row_to_json(NEW))
  );
  return NEW;
end;
$$;
create trigger notify_task_assigned
  after insert or update on public.list_items
  for each row execute function public.notify_task_assigned_trigger();

-- When a primary slot opens up (someone removes their own signup), promote
-- whoever has waited longest as an alternate for that same channel+date —
-- otherwise the calendar shows an open slot someone already volunteered to
-- fill, and staff have to notice and re-signup by hand. Verified against
-- real signup data: promotes correctly, and a delete with no alternate
-- queued is a harmless no-op.
create or replace function public.promote_alternate_on_signup_delete()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  cap jsonb;
  max_primary integer;
  primary_count integer;
  next_alt uuid;
begin
  if OLD.is_alternate then return OLD; end if;
  select schedule_capacity -> extract(dow from OLD.date)::text
    into cap from channels where id = OLD.channel_id;
  if cap is null then return OLD; end if;
  max_primary := (cap ->> 'max')::integer;
  select count(*) into primary_count
    from shift_signups
    where channel_id = OLD.channel_id and date = OLD.date and not is_alternate;
  if primary_count >= max_primary then return OLD; end if;
  select id into next_alt
    from shift_signups
    where channel_id = OLD.channel_id and date = OLD.date and is_alternate
    order by created_at asc limit 1;
  if next_alt is not null then
    update shift_signups set is_alternate = false where id = next_alt;
  end if;
  return OLD;
end;
$$;
create trigger shift_signups_promote after delete on public.shift_signups
  for each row execute function public.promote_alternate_on_signup_delete();

-- Being pulled off the bench deserves a heads-up: when the trigger above
-- flips someone's is_alternate to false, tell them. Deliberately NOT
-- gated by notify_prefs — like mentions and DMs it's personally addressed,
-- and missing it could mean not showing up for a shift you're now on.
-- (Focus Mode still applies; the edge function checks it on delivery.)
create or replace function public.notify_shift_promoted_trigger()
returns trigger language plpgsql security definer
set search_path = public, net
as $$
begin
  if OLD.is_alternate and not NEW.is_alternate then
    perform net.http_post(
      url := 'https://vwacjfsalvbyokqvhzes.supabase.co/functions/v1/notify-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer <VITE_SUPABASE_ANON_KEY>',
        'x-percolate-signature', '<NOTIFY_PUSH_SECRET>'
      ),
      body := jsonb_build_object('type', 'shift_promoted', 'record', row_to_json(NEW))
    );
  end if;
  return NEW;
end;
$$;
create trigger notify_shift_promoted
  after update on public.shift_signups
  for each row execute function public.notify_shift_promoted_trigger();

create or replace function public.stamp_note_update()
returns trigger language plpgsql as $$
begin
  new.channel_id := old.channel_id;
  new.created_at := old.created_at;
  new.updated_by := coalesce(auth.uid(), old.updated_by);
  new.updated_at := now();
  return new;
end;
$$;
create trigger notes_stamp before update on public.notes
  for each row execute function public.stamp_note_update();

-- Catalog rows edit like wiki pages: anything can change except where
-- they live; author/time stamps are maintained automatically.
create or replace function public.stamp_catalog_update()
returns trigger language plpgsql as $$
begin
  new.channel_id := old.channel_id;
  new.created_at := old.created_at;
  new.updated_by := coalesce(auth.uid(), old.updated_by);
  new.updated_at := now();
  return new;
end;
$$;
create trigger catalog_items_stamp before update on public.catalog_items
  for each row execute function public.stamp_catalog_update();

-- Orders: only stage and invoiced may change after creation; the by/at
-- pairs for both are stamped by the database, not the client.
create or replace function public.stamp_order_update()
returns trigger language plpgsql as $$
begin
  new.channel_id := old.channel_id;
  new.title      := old.title;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  if new.stage = 'delivered' and old.stage <> 'delivered' then
    new.delivered_by := coalesce(auth.uid(), old.delivered_by);
    new.delivered_at := now();
  elsif new.stage <> 'delivered' then
    new.delivered_by := null;
    new.delivered_at := null;
    -- Un-delivering an invoiced order un-invoices it too — without this
    -- the row would violate orders_invoiced_requires_delivered instead of
    -- just quietly correcting itself.
    new.invoiced    := false;
    new.invoiced_by := null;
    new.invoiced_at := null;
  end if;
  if new.invoiced and not old.invoiced then
    new.invoiced_by := coalesce(auth.uid(), old.invoiced_by);
    new.invoiced_at := now();
  elsif not new.invoiced then
    new.invoiced_by := null;
    new.invoiced_at := null;
  end if;
  return new;
end;
$$;
create trigger orders_stamp before update on public.orders
  for each row execute function public.stamp_order_update();

-- Order items: keep an item bound to its order, but the roast list is an
-- editable working document — text, done, and position may all change.
create or replace function public.freeze_order_item_columns()
returns trigger language plpgsql as $$
begin
  new.order_id := old.order_id;
  return new;
end;
$$;
create trigger order_items_freeze before update on public.order_items
  for each row execute function public.freeze_order_item_columns();

create or replace function public.freeze_channel_columns()
returns trigger language plpgsql as $$
begin
  new.team_id    := old.team_id;
  new.type       := old.type;
  new.is_home    := old.is_home;
  new.created_at := old.created_at;
  return new;
end;
$$;
create trigger channels_freeze before update on public.channels
  for each row execute function public.freeze_channel_columns();

create or replace function public.freeze_hours_columns()
returns trigger language plpgsql as $$
begin
  new.team_id    := old.team_id;
  new.user_id    := old.user_id;
  new.created_at := old.created_at;
  return new;
end;
$$;
create trigger hours_entries_freeze before update on public.hours_entries
  for each row execute function public.freeze_hours_columns();

-- The wage in force on a given day: the most recent rate effective on or
-- before it. Costing an entry with this (rather than the person's current
-- rate) is what keeps a raise from restating past payroll.
create or replace function public.rate_on(p_user uuid, p_date date)
returns numeric language sql stable security definer set search_path = public as $$
  select rate from wage_rates
  where user_id = p_user and effective_from <= p_date
  order by effective_from desc
  limit 1;
$$;

create or replace function public.log_hours_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Mid-cascade of a team delete the teams row is already gone: inserting an
  -- audit row here would violate hours_audit_team_id_fkey and roll back the
  -- whole delete. The audit rows for that team are being cascade-deleted in
  -- the same statement anyway, so skip the insert.
  if not exists (select 1 from teams where id = old.team_id) then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    -- Only record changes to the numbers that actually affect pay.
    if new.hours is distinct from old.hours or new.tips is distinct from old.tips then
      insert into hours_audit (entry_id, team_id, entry_user, changed_by, action,
                               old_hours, new_hours, old_tips, new_tips)
      values (old.id, old.team_id, old.user_id, auth.uid(), 'update',
              old.hours, new.hours, old.tips, new.tips);
    end if;
    return new;
  end if;
  insert into hours_audit (entry_id, team_id, entry_user, changed_by, action,
                           old_hours, old_tips)
  values (old.id, old.team_id, old.user_id, auth.uid(), 'delete', old.hours, old.tips);
  return old;
end;
$$;
create trigger hours_audit_trg after update or delete on public.hours_entries
  for each row execute function public.log_hours_change();

-- Once a period is marked paid its entries freeze. Without this the
-- timesheet drifts away from the payment record computed from it, and the
-- two can never be reconciled again. Reopening the period (clearing
-- paid_at) unlocks them.
-- Covers INSERT too: a new entry dated inside a paid period would be
-- frozen out of the payroll snapshot the moment it lands — logged but
-- never payable. Discovered via a real stranded shift (Aug 2026); the
-- client now explains the reopen path before the user ever hits this.
create or replace function public.block_paid_period_edits()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  d date; t uuid; u uuid;
begin
  if tg_op = 'DELETE' then d := old.date; t := old.team_id; u := old.user_id;
  elsif tg_op = 'INSERT' then d := new.date; t := new.team_id; u := new.user_id;
  else d := coalesce(new.date, old.date); t := old.team_id; u := old.user_id;
  end if;
  if exists (
    select 1
    from pay_period_lines l
    join pay_periods p on p.id = l.pay_period_id
    where p.team_id = t
      and l.user_id = u
      and l.paid_at is not null
      and d between p.period_start and p.period_end
  ) then
    raise exception 'That person has already been paid for this period. Reopen their line first.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists hours_paid_lock on public.hours_entries;
create trigger hours_paid_lock before insert or update or delete on public.hours_entries
  for each row execute function public.block_paid_period_edits();

-- ------------------------------------------------------------
-- Row-Level Security
-- ------------------------------------------------------------

alter table public.profiles           enable row level security;
alter table public.teams              enable row level security;
alter table public.team_invites       enable row level security;
alter table public.team_members       enable row level security;
alter table public.channels           enable row level security;
alter table public.channel_members    enable row level security;
alter table public.mention_meta       enable row level security;
alter table public.channel_reads      enable row level security;
alter table public.catalog_items      enable row level security;
alter table public.orders             enable row level security;
alter table public.order_items        enable row level security;
alter table public.messages           enable row level security;
alter table public.pins               enable row level security;
alter table public.reactions          enable row level security;
alter table public.shift_signups      enable row level security;
alter table public.list_items         enable row level security;
alter table public.notes              enable row level security;
alter table public.hours_entries      enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.focus_settings     enable row level security;
alter table public.notify_prefs       enable row level security;
alter table public.wage_rates         enable row level security;
alter table public.pay_periods        enable row level security;
alter table public.pay_period_lines   enable row level security;
alter table public.hours_audit        enable row level security;
alter table public.staff_notes        enable row level security;
alter table public.team_creation_allowlist enable row level security;

-- The app requires login; the anonymous role gets nothing at all.
revoke all on all tables in schema public from anon;

-- profiles ---------------------------------------------------
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.shares_team_with(id) or public.shares_dm_with(id));
create policy profiles_insert on public.profiles for insert
  with check (id = auth.uid());
create policy profiles_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- teams ------------------------------------------------------
create policy teams_select on public.teams for select
  using (public.is_team_member(id));
create policy teams_insert on public.teams for insert
  with check (created_by = auth.uid() and public.can_create_team());
create policy teams_update on public.teams for update
  using (public.is_team_owner(id));
create policy teams_delete on public.teams for delete
  using (public.is_team_owner(id));

-- team_invites (owner-only: staff never see the join code) ----
create policy team_invites_select on public.team_invites for select
  using (public.is_team_owner(team_id));
create policy team_invites_update on public.team_invites for update
  using (public.is_team_owner(team_id));

-- team_members -----------------------------------------------
create policy team_members_select on public.team_members for select
  using (public.is_team_member(team_id));
create policy team_members_insert on public.team_members for insert
  with check (public.is_team_owner(team_id));  -- self-join happens via join_team()
create policy team_members_update on public.team_members for update
  using (public.is_team_owner(team_id));
create policy team_members_delete on public.team_members for delete
  using (public.is_team_owner(team_id) or user_id = auth.uid());

-- channels ---------------------------------------------------
create policy channels_select on public.channels for select
  using (
    (team_id is not null and public.is_team_member(team_id))
    or (type = 'dm' and public.is_dm_member(id))
  );
create policy channels_insert on public.channels for insert
  with check (team_id is not null and public.is_team_owner(team_id));
  -- DM channels are created only by open_dm(), never directly.
create policy channels_update on public.channels for update
  using (public.is_team_owner(team_id));
create policy channels_delete on public.channels for delete
  using (public.is_team_owner(team_id) and not is_home);

-- messages ---------------------------------------------------
create policy messages_select on public.messages for select
  using (public.can_see_channel(channel_id));
create policy messages_insert on public.messages for insert
  with check (user_id = auth.uid() and public.can_see_channel(channel_id));
create policy messages_update on public.messages for update
  using (user_id = auth.uid());   -- edit your own; freeze trigger guards columns
create policy messages_delete on public.messages for delete
  using (user_id = auth.uid() or public.is_owner_of_channel(channel_id));

-- pins (anyone in the channel may pin or unpin) ----------------
create policy pins_select on public.pins for select
  using (public.can_see_message(message_id));
create policy pins_insert on public.pins for insert
  with check (pinned_by = auth.uid() and public.can_see_message(message_id));
create policy pins_delete on public.pins for delete
  using (public.can_see_message(message_id));

-- reactions (toggle only your own) -----------------------------
create policy reactions_select on public.reactions for select
  using (public.can_see_message(message_id));
create policy reactions_insert on public.reactions for insert
  with check (user_id = auth.uid() and public.can_see_message(message_id));
create policy reactions_delete on public.reactions for delete
  using (user_id = auth.uid());

-- shift_signups ------------------------------------------------
create policy shift_signups_select on public.shift_signups for select
  using (public.can_see_channel(channel_id));
create policy shift_signups_insert on public.shift_signups for insert
  with check (user_id = auth.uid() and public.can_see_channel(channel_id));
create policy shift_signups_delete on public.shift_signups for delete
  using (user_id = auth.uid() or public.is_owner_of_channel(channel_id));
-- Deliberately NO update policy: a signup is insert-or-delete only through
-- the API. promote_alternate_on_signup_delete() flips is_alternate itself,
-- but it's SECURITY DEFINER (owned by postgres, the table owner), so it
-- bypasses RLS and needs no policy — and without one, nobody can edit a
-- row to jump the staffing cap or move a signup to another day.

-- list_items ---------------------------------------------------
create policy list_items_select on public.list_items for select
  using (public.can_see_channel(channel_id));
create policy list_items_insert on public.list_items for insert
  with check (added_by = auth.uid() and public.can_see_channel(channel_id));
create policy list_items_update on public.list_items for update
  using (public.can_see_channel(channel_id));  -- freeze trigger: done-flag only
create policy list_items_delete on public.list_items for delete
  using (added_by = auth.uid() or public.is_owner_of_channel(channel_id));

-- notes (whole channel may read and edit, like the app) --------
create policy notes_select on public.notes for select
  using (public.can_see_channel(channel_id));
create policy notes_insert on public.notes for insert
  with check (updated_by = auth.uid() and public.can_see_channel(channel_id));
create policy notes_update on public.notes for update
  using (public.can_see_channel(channel_id));
create policy notes_delete on public.notes for delete
  using (public.can_see_channel(channel_id));

-- hours_entries (the payroll rule lives here) ------------------
create policy hours_select on public.hours_entries for select
  using (user_id = auth.uid() or public.is_team_owner(team_id));
create policy hours_insert on public.hours_entries for insert
  with check (user_id = auth.uid() and public.is_team_member(team_id));
-- Owners can correct staff entries (a fat-fingered 80 instead of 8 is the
-- owner's problem to fix at payroll time), and every change they make is
-- recorded in hours_audit by the trigger above.
create policy hours_update on public.hours_entries for update
  using (user_id = auth.uid() or public.is_team_owner(team_id));
create policy hours_delete on public.hours_entries for delete
  using (user_id = auth.uid() or public.is_team_owner(team_id));

-- channel_members (DM rosters; writes happen only inside open_dm) ---
create policy channel_members_select on public.channel_members for select
  using (public.is_dm_member(channel_id));

-- mention_meta / channel_reads (strictly own rows) -------------
create policy mention_meta_select on public.mention_meta for select
  using (user_id = auth.uid());
create policy mention_meta_insert on public.mention_meta for insert
  with check (user_id = auth.uid() and public.can_see_message(message_id));
create policy mention_meta_update on public.mention_meta for update
  using (user_id = auth.uid());
create policy mention_meta_delete on public.mention_meta for delete
  using (user_id = auth.uid());

create policy channel_reads_select on public.channel_reads for select
  using (user_id = auth.uid());
create policy channel_reads_insert on public.channel_reads for insert
  with check (user_id = auth.uid() and public.can_see_channel(channel_id));
create policy channel_reads_update on public.channel_reads for update
  using (user_id = auth.uid());
create policy channel_reads_delete on public.channel_reads for delete
  using (user_id = auth.uid());

-- catalog_items (wiki-style: whole channel reads and writes) ----
create policy catalog_select on public.catalog_items for select
  using (public.can_see_channel(channel_id));
create policy catalog_insert on public.catalog_items for insert
  with check (updated_by = auth.uid() and public.can_see_channel(channel_id));
create policy catalog_update on public.catalog_items for update
  using (public.can_see_channel(channel_id));
create policy catalog_delete on public.catalog_items for delete
  using (public.can_see_channel(channel_id));

-- orders (anyone in the channel works them; only creator/owner removes)
create policy orders_select on public.orders for select
  using (public.can_see_channel(channel_id));
create policy orders_insert on public.orders for insert
  with check (created_by = auth.uid() and public.can_see_channel(channel_id));
create policy orders_update on public.orders for update
  using (public.can_see_channel(channel_id));  -- stage only, via freeze trigger
create policy orders_delete on public.orders for delete
  using (created_by = auth.uid() or public.is_owner_of_channel(channel_id));

create policy order_items_select on public.order_items for select
  using (public.can_see_order(order_id));
create policy order_items_insert on public.order_items for insert
  with check (
    exists (
      select 1 from public.orders o
      where o.id = order_id and o.created_by = auth.uid()
    )
  );
create policy order_items_update on public.order_items for update
  using (public.can_see_order(order_id));  -- done-flag only, via freeze trigger
create policy order_items_delete on public.order_items for delete
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (o.created_by = auth.uid() or public.is_owner_of_channel(o.channel_id))
    )
  );

-- payroll ------------------------------------------------------
-- Your own rate is visible to you; only owners see the team's, and only
-- owners set them.
create policy wage_rates_select on public.wage_rates for select
  using (user_id = auth.uid() or public.is_team_owner(team_id));
create policy wage_rates_insert on public.wage_rates for insert
  with check (public.is_team_owner(team_id) and created_by = auth.uid());
create policy wage_rates_update on public.wage_rates for update
  using (public.is_team_owner(team_id));
create policy wage_rates_delete on public.wage_rates for delete
  using (public.is_team_owner(team_id));

create policy pay_periods_select on public.pay_periods for select
  using (public.is_team_member(team_id));
create policy pay_periods_insert on public.pay_periods for insert
  with check (public.is_team_owner(team_id));
create policy pay_periods_update on public.pay_periods for update
  using (public.is_team_owner(team_id));
create policy pay_periods_delete on public.pay_periods for delete
  using (public.is_team_owner(team_id));

-- Staff see their own payslip line and nobody else's.
create policy pay_period_lines_select on public.pay_period_lines for select
  using (
    user_id = auth.uid()
    or exists (select 1 from pay_periods p
               where p.id = pay_period_id and public.is_team_owner(p.team_id))
  );
create policy pay_period_lines_write on public.pay_period_lines for all
  using (exists (select 1 from pay_periods p
                 where p.id = pay_period_id and public.is_team_owner(p.team_id)))
  with check (exists (select 1 from pay_periods p
                      where p.id = pay_period_id and public.is_team_owner(p.team_id)));

-- Read-only through the API — rows are written by the definer trigger, so
-- history can't be forged or edited.
create policy hours_audit_select on public.hours_audit for select
  using (entry_user = auth.uid() or public.is_team_owner(team_id));

-- Owner-only, in both directions: staff can't read notes written about them.
create policy staff_notes_all on public.staff_notes for all
  using (public.is_team_owner(team_id))
  with check (public.is_team_owner(team_id));

-- push_subscriptions (strictly own rows) ------------------------
create policy push_subs_all on public.push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- focus_settings (strictly own row; the notify-push edge function
-- reads across users via its service-role key, bypassing RLS) -----
create policy focus_settings_select on public.focus_settings for select
  using (user_id = auth.uid());
create policy focus_settings_insert on public.focus_settings for insert
  with check (user_id = auth.uid());
create policy focus_settings_update on public.focus_settings for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- notify_prefs (strictly own row; edge function reads via service role) --
create policy notify_prefs_all on public.notify_prefs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ------------------------------------------------------------
-- RPCs
-- ------------------------------------------------------------

-- Join a team with an invite code. SECURITY DEFINER because the
-- caller can't see the team or its invite row until they're a member.
create or replace function public.join_team(invite_code text)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  t uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  select team_id into t from team_invites where code = invite_code;
  if t is null then
    raise exception 'invalid invite code';
  end if;
  insert into team_members (team_id, user_id, role)
  values (t, auth.uid(), 'staff')
  on conflict do nothing;
  return t;
end;
$$;

-- Functions are executable by PUBLIC by default, and `anon` inherits
-- through PUBLIC — so revoke from PUBLIC, then grant back what we mean.
revoke execute on function public.join_team(text) from public, anon;
grant execute on function public.join_team(text) to authenticated;

-- Open (or find) a private thread with a set of people. SECURITY
-- DEFINER because DM channels/membership rows can't be created through
-- the normal policies. Every participant must share a team with the
-- caller — you can't cold-message strangers.
create or replace function public.open_dm(other_ids uuid[])
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  member_ids uuid[];
  m uuid;
  c uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  select array_agg(distinct x order by x)
    into member_ids
    from unnest(other_ids || auth.uid()) as t(x);
  if member_ids is null or array_length(member_ids, 1) < 2 then
    raise exception 'pick at least one other person';
  end if;
  foreach m in array member_ids loop
    if m <> auth.uid() and not public.shares_team_with(m) then
      raise exception 'you can only message people on your teams';
    end if;
  end loop;
  -- Reuse an existing thread with exactly this member set.
  select cm.channel_id into c
  from channel_members cm
  join channels ch on ch.id = cm.channel_id and ch.type = 'dm'
  group by cm.channel_id
  having array_agg(cm.user_id order by cm.user_id) = member_ids
  limit 1;
  if c is not null then
    return c;
  end if;
  insert into channels (team_id, type, name, emoji)
  values (null, 'dm', 'private', '✉️')
  returning id into c;
  insert into channel_members (channel_id, user_id)
  select c, unnest(member_ids);
  return c;
end;
$$;

revoke execute on function public.open_dm(uuid[]) from public, anon;
grant execute on function public.open_dm(uuid[]) to authenticated;

-- ------------------------------------------------------------
-- Realtime
-- ------------------------------------------------------------
-- postgres_changes subscriptions respect RLS, so subscribing to
-- these tables only ever streams rows the user could SELECT.

alter publication supabase_realtime add table
  public.profiles,
  public.teams,
  public.team_members,
  public.channels,
  public.channel_members,
  public.messages,
  public.pins,
  public.reactions,
  public.shift_signups,
  public.list_items,
  public.notes,
  public.catalog_items,
  public.orders,
  public.order_items,
  public.mention_meta,
  public.channel_reads,
  public.hours_entries;

-- ------------------------------------------------------------
-- Push notifications: messages INSERT -> notify-push edge function
--
-- Created out-of-band originally (this section documents it so a
-- rebuild from this file doesn't silently lose push). Uses pg_net
-- directly rather than the supabase_functions.http_request() helper,
-- because that schema only gets provisioned once a Database Webhook
-- has been created through the dashboard UI, which never happened here.
--
-- SECURITY: the Authorization header below carries the *anon* key, which
-- also ships in the browser bundle — so it proves nothing about the
-- caller. The x-percolate-signature header is what actually
-- authenticates the database to the function; the function rejects
-- anything without it (403). Without that check, any client could POST a
-- forged `record` and push arbitrary text to a channel under any
-- sender's name. Keep the two in sync:
--   supabase secrets set NOTIFY_PUSH_SECRET=<value>   (function side)
--   the literal in this function body                 (database side)
-- Never commit the real value — replace the placeholder when applying.
-- ------------------------------------------------------------

create extension if not exists pg_net with schema extensions;

create or replace function public.notify_push_trigger()
returns trigger language plpgsql security definer
set search_path = public, net
as $BODY$
begin
  perform net.http_post(
    url := 'https://vwacjfsalvbyokqvhzes.supabase.co/functions/v1/notify-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <VITE_SUPABASE_ANON_KEY>',
      'x-percolate-signature', '<NOTIFY_PUSH_SECRET>'
    ),
    body := jsonb_build_object('record', row_to_json(NEW))
  );
  return NEW;
end;
$BODY$;

drop trigger if exists notify_push_on_message on public.messages;
create trigger notify_push_on_message
  after insert on public.messages
  for each row execute function public.notify_push_trigger();

-- Someone accepted an invite code -> tell that team's owners. Same edge
-- function, same shared secret; the `type` field is what routes it. (The
-- message trigger above omits `type`, and the function treats a missing
-- one as "message", so the two can deploy independently.)
create or replace function public.notify_member_joined_trigger()
returns trigger language plpgsql security definer
set search_path = public, net
as $BODY$
begin
  -- The owner row written alongside a brand-new team isn't a "join" —
  -- without this, creating a team would notify you about yourself.
  if NEW.role = 'owner' then
    return NEW;
  end if;
  perform net.http_post(
    url := 'https://vwacjfsalvbyokqvhzes.supabase.co/functions/v1/notify-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <VITE_SUPABASE_ANON_KEY>',
      'x-percolate-signature', '<NOTIFY_PUSH_SECRET>'
    ),
    body := jsonb_build_object('type', 'member_joined', 'record', row_to_json(NEW))
  );
  return NEW;
end;
$BODY$;

drop trigger if exists notify_member_joined on public.team_members;
create trigger notify_member_joined
  after insert on public.team_members
  for each row execute function public.notify_member_joined_trigger();


-- ------------------------------------------------------------
-- Data retention
-- ------------------------------------------------------------
-- Deliberately scoped to MESSAGES only. Hours entries are payroll/tax
-- records, notes are reference material, catalog and orders are business
-- records — none of those should evaporate on a timer. Pinned messages are
-- also exempt: pinning is an explicit "keep this".
--
-- Requires pg_cron. The nightly job is registered with:
--   select cron.schedule('percolate-purge-messages', '17 4 * * *',
--                        'select public.purge_old_messages();');

create extension if not exists pg_cron;

create or replace function public.retention_cutoffs()
returns table (channel_id uuid, cutoff timestamptz)
language sql stable security definer set search_path = public as $$
  -- Team channels follow their own team's policy.
  select c.id, now() - make_interval(days => t.retention_days)
  from channels c
  join teams t on t.id = c.team_id
  where t.retention_days is not null
  union all
  -- DMs have no team_id, so they inherit the SHORTEST policy among the
  -- teams their participants belong to — privacy-protective if the two
  -- sides ever disagree.
  select cm.channel_id, now() - make_interval(days => min(t.retention_days))
  from channel_members cm
  join team_members tm on tm.user_id = cm.user_id
  join teams t on t.id = tm.team_id
  where t.retention_days is not null
  group by cm.channel_id;
$$;

create or replace function public.purge_old_messages()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with doomed as (
    delete from messages m
    using public.retention_cutoffs() cu
    where m.channel_id = cu.channel_id
      and m.created_at < cu.cutoff
      and not exists (select 1 from pins p where p.message_id = m.id)
    returning 1
  )
  select count(*) into n from doomed;
  return coalesce(n, 0);
end;
$$;

-- Dry run for the settings screen, so an owner sees the scope of a
-- deletion BEFORE committing to it rather than discovering it after.
create or replace function public.count_purgeable_messages()
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::integer
  from messages m
  join public.retention_cutoffs() cu on cu.channel_id = m.channel_id
  join channels c on c.id = m.channel_id
  where m.created_at < cu.cutoff
    and not exists (select 1 from pins p where p.message_id = m.id)
    and c.team_id is not null
    and public.is_team_owner(c.team_id);
$$;

-- Only the cron job (running as the table owner) may actually delete.
revoke execute on function public.purge_old_messages() from public, anon, authenticated;
revoke execute on function public.count_purgeable_messages() from public, anon;
grant execute on function public.count_purgeable_messages() to authenticated;
