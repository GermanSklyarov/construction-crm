begin;
-- Existing rows receive a token, and existing column grants exclude this column.
alter table public.tasks add column row_version uuid not null default gen_random_uuid();
alter table public.construction_objects add column row_version uuid not null default gen_random_uuid();

create function private.rotate_row_version() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.row_version := pg_catalog.gen_random_uuid();
  return new;
end;
$$;
revoke all on function private.rotate_row_version() from public, anon, authenticated;
create trigger rotate_row_version before update on public.tasks
for each row execute function private.rotate_row_version();
create trigger rotate_row_version before update on public.construction_objects
for each row execute function private.rotate_row_version();

-- Preserve the transition contract: return the version written under the row lock.
create or replace function public.transition_task(
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
  update public.tasks set status = p_new_status where id = v_task.id returning row_version into v_task.row_version;
  insert into public.task_status_history(task_id, from_status, to_status, actor_id, comment)
    values (v_task.id, v_task.status, p_new_status, v_uid, p_comment);
  v_task.status := p_new_status;
  return v_task;
end;
$$;
commit;
