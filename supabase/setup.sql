-- Waymore Jobs: Supabase setup.
-- Paste all of this into Supabase -> SQL Editor -> New query -> Run.
-- Safe to run again; it only adds what is missing.

-- =========================================================
-- 1. Worker logins and roles
--    pending  = signed up, waiting for the owner to approve
--    mechanic = Mechanic side only, no prices, cannot invoice
--    desk     = everything except managing workers
--    admin    = everything (the first account becomes admin)
-- =========================================================
create table if not exists public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  name       text,
  role       text not null default 'pending'
             check (role in ('pending','mechanic','desk','admin')),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where user_id = auth.uid()
$$;
create or replace function public.is_worker() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('mechanic','desk','admin'), false)
$$;
create or replace function public.is_office() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('desk','admin'), false)
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false)
$$;

-- Every new login gets a profile. The very first one becomes admin.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, email, name, role)
  values (
    new.id, new.email,
    coalesce(nullif(new.raw_user_meta_data->>'name', ''), split_part(new.email, '@', 1)),
    case when exists (select 1 from public.profiles where role = 'admin') then 'pending' else 'admin' end
  )
  on conflict (user_id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Accounts created before this setup ran also get a profile; the earliest becomes admin if there is none.
insert into public.profiles (user_id, email, name, role)
select u.id, u.email, coalesce(nullif(u.raw_user_meta_data->>'name', ''), split_part(u.email, '@', 1)), 'pending'
from auth.users u
where not exists (select 1 from public.profiles p where p.user_id = u.id);
update public.profiles set role = 'admin'
where user_id = (select user_id from public.profiles order by created_at, user_id limit 1)
  and not exists (select 1 from public.profiles where role = 'admin');

-- Only an admin can change someone's role.
create or replace function public.protect_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null and not public.is_admin() then
    raise exception 'Only an admin can change roles';
  end if;
  return new;
end $$;
drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role before update on public.profiles
  for each row execute function public.protect_role();

drop policy if exists "see profiles" on public.profiles;
create policy "see profiles" on public.profiles for select to authenticated
  using (user_id = auth.uid() or public.is_worker());
drop policy if exists "edit own profile" on public.profiles;
create policy "edit own profile" on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "admin edits profiles" on public.profiles;
create policy "admin edits profiles" on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin removes profiles" on public.profiles;
create policy "admin removes profiles" on public.profiles for delete to authenticated
  using (public.is_admin());

-- =========================================================
-- 2. Shop data: service orders, customers, parts, time clock, settings
-- =========================================================
create table if not exists public.docs (
  col        text not null,
  id         text not null,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (col, id)
);
alter table public.docs enable row level security;

drop policy if exists "workers read" on public.docs;
create policy "workers read" on public.docs for select to authenticated
  using (
    public.is_worker()
    -- live locations: only the shop desk / admins, and each worker their own
    and (col not in ('locations','loctrail') or public.is_office() or data->>'uid' = auth.uid()::text)
  );

drop policy if exists "workers add" on public.docs;
create policy "workers add" on public.docs for insert to authenticated
  with check (
    public.is_worker()
    and (col <> 'settings' or public.is_office())
    and (col not in ('timeclock','locations','loctrail') or public.is_office() or data->>'uid' = auth.uid()::text)
  );

drop policy if exists "workers edit" on public.docs;
create policy "workers edit" on public.docs for update to authenticated
  using (
    public.is_worker()
    and (col <> 'settings' or public.is_office())
    and (col not in ('timeclock','locations','loctrail') or public.is_office() or data->>'uid' = auth.uid()::text)
  )
  with check (
    public.is_worker()
    and (col <> 'settings' or public.is_office())
    and (col not in ('timeclock','locations','loctrail') or public.is_office() or data->>'uid' = auth.uid()::text)
  );

drop policy if exists "office deletes" on public.docs;
create policy "office deletes" on public.docs for delete to authenticated
  using (public.is_office());

-- Mechanics cannot invoice or mark an SO paid.
create or replace function public.docs_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if auth.uid() is not null and new.col = 'serviceOrders' and not public.is_office() then
    if tg_op = 'INSERT' and (coalesce(new.data->>'billed','false') = 'true' or coalesce(new.data->>'paid','false') = 'true') then
      raise exception 'Only the shop desk can invoice or mark paid';
    end if;
    if tg_op = 'UPDATE' and ((new.data->'billed') is distinct from (old.data->'billed')
                          or (new.data->'paid')   is distinct from (old.data->'paid')) then
      raise exception 'Only the shop desk can invoice or mark paid';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists docs_guard on public.docs;
create trigger docs_guard before insert or update on public.docs
  for each row execute function public.docs_guard();

-- =========================================================
-- 3. Backup: every change is also kept forever in shop_backup
-- =========================================================
create table if not exists public.shop_backup (
  id         bigint generated always as identity primary key,
  collection text not null,
  doc_id     text not null,
  data       jsonb,
  deleted    boolean not null default false,
  saved_at   timestamptz not null default now()
);
alter table public.shop_backup add column if not exists changed_by uuid;
alter table public.shop_backup enable row level security;
drop policy if exists "app can add backups" on public.shop_backup;
drop policy if exists "admin reads backups" on public.shop_backup;
create policy "admin reads backups" on public.shop_backup for select to authenticated
  using (public.is_admin());
delete from public.shop_backup where collection = '_test';

create or replace function public.docs_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- live location pings are not kept in the history (they change every minute)
  if coalesce(new.col, old.col) in ('locations','loctrail') then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    insert into public.shop_backup (collection, doc_id, data, deleted, changed_by)
    values (old.col, old.id, old.data, true, auth.uid());
    return old;
  end if;
  insert into public.shop_backup (collection, doc_id, data, deleted, changed_by)
  values (new.col, new.id, new.data, false, auth.uid());
  return new;
end $$;
drop trigger if exists docs_history on public.docs;
create trigger docs_history after insert or update or delete on public.docs
  for each row execute function public.docs_history();

create or replace view public.shop_latest with (security_invoker = on) as
  select distinct on (collection, doc_id) collection, doc_id, data, deleted, saved_at
  from public.shop_backup
  order by collection, doc_id, saved_at desc;

-- =========================================================
-- 4. Job photos
-- =========================================================
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;
drop policy if exists "workers upload photos" on storage.objects;
create policy "workers upload photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.is_worker());

-- =========================================================
-- 5. Live updates between phones
-- =========================================================
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null;
end $$;

-- =========================================================
-- 6. iPhone push notifications: each phone saves its own subscription here.
--    The "notify" Edge Function reads the owner's/admins' subscriptions
--    (with the service role) and sends the push.
-- =========================================================
create table if not exists public.push_subs (
  endpoint   text primary key,
  user_id    uuid references auth.users(id) on delete cascade,
  sub        jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.push_subs enable row level security;
drop policy if exists "own push subs" on public.push_subs;
create policy "own push subs" on public.push_subs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
