-- Run manually in the NEW project's SQL Editor only after migrations and approval.
-- Replace these three placeholders with Auth user UUIDs created in Dashboard.
-- No passwords, Auth mutations, deletes, upserts, or schema changes.
begin;
do $$
declare
  manager_id uuid := 'REPLACE_MANAGER_UUID';
  executor1_id uuid := 'REPLACE_EXECUTOR1_UUID';
  executor2_id uuid := 'REPLACE_EXECUTOR2_UUID';
  object1 uuid := 'c7000000-0000-0000-0000-000000000001';
  object2 uuid := 'c7000000-0000-0000-0000-000000000002';
  object3 uuid := 'c7000000-0000-0000-0000-000000000003';
  task1 uuid := 'c8000000-0000-0000-0000-000000000001';
  task2 uuid := 'c8000000-0000-0000-0000-000000000002';
  task3 uuid := 'c8000000-0000-0000-0000-000000000003';
begin
  if manager_id = executor1_id or manager_id = executor2_id or executor1_id = executor2_id then
    raise exception 'Three distinct Auth users required';
  end if;
  if (select count(*) from auth.users where id in (manager_id, executor1_id, executor2_id)
      and email_confirmed_at is not null) <> 3 then
    raise exception 'Create and confirm all three Auth users in Dashboard first';
  end if;
  -- Plain INSERT deliberately rejects existing profiles/fixtures, preserving them.
  insert into public.profiles(id, display_name, role) values
    (manager_id, 'Демо постановщик', 'manager'),
    (executor1_id, 'Демо исполнитель 1', 'executor'),
    (executor2_id, 'Демо исполнитель 2', 'executor');
  insert into public.construction_objects(id, name, address) values
    (object1, 'Северный квартал', 'Улица Строителей, 1'),
    (object2, 'Южный квартал', 'Улица Строителей, 2'),
    (object3, 'Новый участок', 'Улица Строителей, 3');
  -- Trusted bootstrap supplies the actor; trigger/RPC still enforce business rules.
  perform set_config('request.jwt.claim.sub', manager_id::text, true);
  insert into public.tasks(id, title, description, object_id, assignee_id) values
    (task1, 'Проверить опалубку', 'Проверка перед заливкой', object1, executor1_id),
    (task2, 'Подготовить фасад', 'Подготовка поверхности', object2, executor2_id),
    (task3, 'Принять армирование', 'Проверить стыки и крепления', object1, executor1_id);
  perform set_config('request.jwt.claim.sub', executor2_id::text, true);
  perform public.transition_task(task2, 'new', 'in_progress');
  perform set_config('request.jwt.claim.sub', executor1_id::text, true);
  perform public.transition_task(task3, 'new', 'in_progress');
  perform public.transition_task(task3, 'in_progress', 'in_review');
end $$;
commit;
-- Expected: 3 profiles, 3 objects, 3 tasks (new/in_progress/in_review), 6 history events.
-- Repeat intentionally fails without resetting data. After any error issue ROLLBACK.
