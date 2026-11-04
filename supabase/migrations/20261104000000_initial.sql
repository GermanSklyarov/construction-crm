begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
revoke create on schema public from public, anon, authenticated;

create type public.app_role as enum ('manager', 'executor');
create type public.task_status as enum
  ('new', 'in_progress', 'in_review', 'accepted', 'needs_revision');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (display_name ~ '[^[:space:]]'),
  role public.app_role not null,
  unique (id, role)
);

create table public.construction_objects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name ~ '[^[:space:]]'),
  address text not null check (address ~ '[^[:space:]]')
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (title ~ '[^[:space:]]'),
  description text not null default '',
  object_id uuid not null references public.construction_objects(id) on delete restrict,
  assignee_id uuid not null,
  assignee_role public.app_role not null default 'executor' check (assignee_role = 'executor'),
  foreign key (assignee_id, assignee_role) references public.profiles(id, role) on delete restrict,
  status public.task_status not null default 'new',
  author_id uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.task_status_history (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks(id) on delete cascade,
  from_status public.task_status,
  to_status public.task_status not null,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  changed_at timestamptz not null default clock_timestamp(),
  comment text,
  constraint valid_history_transition check (
    (from_status is null and to_status = 'new') or
    (from_status is not null and (
      (from_status = 'new' and to_status = 'in_progress') or
      (from_status = 'in_progress' and to_status = 'in_review') or
      (from_status = 'in_review' and to_status in ('accepted', 'needs_revision')) or
      (from_status = 'needs_revision' and to_status = 'in_progress')
    ))
  ),
  constraint revision_comment_required check (
    to_status <> 'needs_revision' or (comment is not null and comment ~ '[^[:space:]]')
  )
);

create index tasks_object_id_idx on public.tasks(object_id);
create index tasks_assignee_id_idx on public.tasks(assignee_id);
create index tasks_author_id_idx on public.tasks(author_id);
create index history_task_id_id_idx on public.task_status_history(task_id, id);
create index history_actor_id_idx on public.task_status_history(actor_id);

-- Read only the database role, never user_metadata or a client-supplied role.
create function private.current_app_role() returns public.app_role
language sql stable security definer set search_path = ''
as $$ select role from public.profiles where id = auth.uid() and auth.uid() is not null $$;
revoke all on function private.current_app_role() from public, anon, authenticated;
grant execute on function private.current_app_role() to authenticated;

alter table public.profiles enable row level security;
alter table public.construction_objects enable row level security;
alter table public.tasks enable row level security;
alter table public.task_status_history enable row level security;

create policy profiles_read on public.profiles for select to authenticated using (
  id = (select auth.uid()) or (select private.current_app_role()) = 'manager'
  or exists (select 1 from public.task_status_history h where h.actor_id = profiles.id)
);
create policy objects_read on public.construction_objects for select to authenticated using (
  (select private.current_app_role()) = 'manager'
  or exists (select 1 from public.tasks t where t.object_id = construction_objects.id)
);
create policy objects_insert on public.construction_objects for insert to authenticated
  with check ((select private.current_app_role()) = 'manager');
create policy objects_update on public.construction_objects for update to authenticated
  using ((select private.current_app_role()) = 'manager')
  with check ((select private.current_app_role()) = 'manager');
create policy objects_delete on public.construction_objects for delete to authenticated
  using ((select private.current_app_role()) = 'manager');
create policy tasks_read on public.tasks for select to authenticated using (
  (select private.current_app_role()) = 'manager'
  or ((select private.current_app_role()) = 'executor' and assignee_id = (select auth.uid()))
);
create policy tasks_insert on public.tasks for insert to authenticated with check (
  (select private.current_app_role()) = 'manager' and author_id = (select auth.uid()) and status = 'new'
);
create policy tasks_update on public.tasks for update to authenticated
  using ((select private.current_app_role()) = 'manager')
  with check ((select private.current_app_role()) = 'manager');
create policy tasks_delete on public.tasks for delete to authenticated
  using ((select private.current_app_role()) = 'manager');
create policy history_read on public.task_status_history for select to authenticated using (
  exists (select 1 from public.tasks t where t.id = task_status_history.task_id)
);

-- Supabase may have permissive default grants; explicitly replace them.
revoke all on public.profiles, public.construction_objects, public.tasks,
  public.task_status_history from public, anon, authenticated;
revoke all on sequence public.task_status_history_id_seq from public, anon, authenticated;
grant select on public.profiles, public.construction_objects, public.tasks,
  public.task_status_history to authenticated;
grant insert (name, address), update (name, address), delete
  on public.construction_objects to authenticated;
grant insert (title, description, object_id, assignee_id),
  update (title, description, object_id, assignee_id), delete on public.tasks to authenticated;

create function private.record_task_creation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.current_app_role() is distinct from 'manager'
    or new.author_id is distinct from auth.uid() or new.status <> 'new' then
    raise exception 'Task creation requires an authenticated manager' using errcode = '42501';
  end if;
  insert into public.task_status_history(task_id, from_status, to_status, actor_id)
    values (new.id, null, 'new', auth.uid());
  return new;
end;
$$;
revoke all on function private.record_task_creation() from public, anon, authenticated;
create trigger record_task_creation after insert on public.tasks
  for each row execute function private.record_task_creation();

-- The sole API writer of status. Column grants prevent REST UPDATE / UPSERT bypasses.
create function public.transition_task(
  p_task_id uuid,
  p_expected_status public.task_status,
  p_new_status public.task_status,
  p_comment text default null
) returns public.tasks
language plpgsql security definer set search_path = '' as $$
declare
  v_task public.tasks;
  v_uid uuid := auth.uid();
  v_role public.app_role := private.current_app_role();
begin
  if v_uid is null or v_role is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  -- Lock only an accessible row; inaccessible and missing IDs have the same error.
  select * into v_task from public.tasks
    where id = p_task_id and (v_role = 'manager' or assignee_id = v_uid)
    for update;
  if not found then
    raise exception 'Task unavailable' using errcode = '42501';
  end if;
  if p_expected_status is null or v_task.status <> p_expected_status then
    raise exception 'Task status has changed; reload the task' using errcode = '40001';
  end if;
  if p_new_status is null or not (
    (v_role = 'executor' and v_task.assignee_id = v_uid and (
      (v_task.status in ('new', 'needs_revision') and p_new_status = 'in_progress') or
      (v_task.status = 'in_progress' and p_new_status = 'in_review')
    )) or
    (v_role = 'manager' and v_task.status = 'in_review'
      and p_new_status in ('accepted', 'needs_revision'))
  ) then
    raise exception 'Forbidden status transition' using errcode = '42501';
  end if;
  if p_new_status = 'needs_revision'
    and (p_comment is null or p_comment !~ '[^[:space:]]') then
    raise exception 'Revision comment required' using errcode = '23514';
  end if;
  update public.tasks set status = p_new_status where id = v_task.id;
  insert into public.task_status_history(task_id, from_status, to_status, actor_id, comment)
    values (v_task.id, v_task.status, p_new_status, v_uid, p_comment);
  v_task.status := p_new_status;
  return v_task;
end;
$$;
revoke all on function public.transition_task(uuid, public.task_status, public.task_status, text)
  from public, anon, authenticated;
grant execute on function public.transition_task(uuid, public.task_status, public.task_status, text)
  to authenticated;

commit;
