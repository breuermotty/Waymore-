-- Waymore Jobs update: live location while clocked in.
-- Paste into Supabase -> SQL Editor -> New query -> Run. Safe to run again.

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
