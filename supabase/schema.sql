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
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  emoji      text not null default '☕️',
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
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
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id    uuid not null references public.profiles (id),
  text       text not null check (length(text) between 1 and 8000),
  edited     boolean not null default false,
  created_at timestamptz not null default now()
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
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  date       date not null,
  note       text not null default '',
  created_at timestamptz not null default now()
);
create index shift_signups_channel_idx on public.shift_signups (channel_id, date);

create table public.list_items (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  list_id    text not null,
  text       text not null check (length(text) between 1 and 2000),
  added_by   uuid not null references public.profiles (id),
  done       boolean not null default false,
  created_at timestamptz not null default now()
);
create index list_items_channel_idx on public.list_items (channel_id);

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
create table public.hours_entries (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  date       date not null,
  hours      numeric(5, 2) not null check (hours > 0 and hours <= 24),
  note       text not null default '',
  created_at timestamptz not null default now()
);
create index hours_entries_team_idx on public.hours_entries (team_id, date);
create index hours_entries_user_idx on public.hours_entries (user_id, date);

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
  delivered_at timestamptz
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
  new.channel_id := old.channel_id;
  new.user_id    := old.user_id;
  new.created_at := old.created_at;
  if new.text is distinct from old.text then
    new.edited := true;
  end if;
  return new;
end;
$$;
create trigger messages_freeze before update on public.messages
  for each row execute function public.freeze_message_columns();

-- Staff may only flip `done` on list items — text and authorship stay.
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

-- Orders: only the stage may change after creation; delivered_by/at are
-- stamped by the database, not the client.
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
  with check (created_by = auth.uid());
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
  using (public.is_team_member(team_id));
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
create policy hours_update on public.hours_entries for update
  using (user_id = auth.uid());
create policy hours_delete on public.hours_entries for delete
  using (user_id = auth.uid());

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

-- push_subscriptions (strictly own rows) ------------------------
create policy push_subs_all on public.push_subscriptions for all
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
