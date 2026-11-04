begin;

create extension if not exists pgtap with schema extensions;

set local search_path = public, extensions;

select no_plan();

-- Fixtures are rolled back; these are not demo accounts or credentials.

insert into auth.users(id) values ('10000000-0000-0000-0000-000000000001');

insert into auth.users(id) values ('10000000-0000-0000-0000-000000000002');

insert into auth.users(id) values ('10000000-0000-0000-0000-000000000003');

insert into auth.users(id) values ('10000000-0000-0000-0000-000000000004');

insert into auth.users(id) values ('10000000-0000-0000-0000-000000000005');

insert into profiles values ('10000000-0000-0000-0000-000000000001', 'manager', 'manager');

insert into profiles values ('10000000-0000-0000-0000-000000000002', 'executor', 'executor');

insert into profiles values ('10000000-0000-0000-0000-000000000003', 'executor', 'executor');

insert into profiles values ('10000000-0000-0000-0000-000000000004', 'manager', 'manager');

insert into construction_objects(id,name,address) values ('20000000-0000-0000-0000-000000000001','A','Address A'), ('20000000-0000-0000-0000-000000000002','B','Address B');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

insert into tasks(id,title,object_id,assignee_id) values ('30000000-0000-0000-0000-000000000001', 'Task', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002');

insert into tasks(id,title,object_id,assignee_id) values ('30000000-0000-0000-0000-000000000002', 'Task', '20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003');

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select is((select count(*) from tasks)::bigint, 1::bigint, 'A sees only own task');

select is((select count(*) from tasks where id = '30000000-0000-0000-0000-000000000002')::bigint, 0::bigint, 'A cannot read B task');

select is((select count(*) from construction_objects)::bigint, 1::bigint, 'A sees only related object');

select is((select count(*) from construction_objects where id = '20000000-0000-0000-0000-000000000002')::bigint, 0::bigint, 'A cannot read B object');

select is((select count(*) from task_status_history)::bigint, 1::bigint, 'A sees only own history');

select is((select count(*) from profiles)::bigint, 2::bigint, 'A sees self and visible history author only');

with affected as (update tasks set title='hacked' where id='30000000-0000-0000-0000-000000000002' returning id)
select is((select count(*) from affected), 0::bigint, 'A cannot edit B');

with affected as (update tasks set assignee_id='10000000-0000-0000-0000-000000000002' where id='30000000-0000-0000-0000-000000000002' returning id)
select is((select count(*) from affected), 0::bigint, 'A cannot steal B task');

with affected as (update tasks set title='hacked' where id='30000000-0000-0000-0000-000000000001' returning id)
select is((select count(*) from affected), 0::bigint, 'A cannot edit own metadata');

with affected as (delete from tasks where id='30000000-0000-0000-0000-000000000001' returning id)
select is((select count(*) from affected), 0::bigint, 'A cannot delete own task');

with affected as (delete from tasks where id='30000000-0000-0000-0000-000000000002' returning id)
select is((select count(*) from affected), 0::bigint, 'A cannot delete B task');

with affected as (update construction_objects set name='hacked' where id='20000000-0000-0000-0000-000000000001' returning id)
select is((select count(*) from affected), 0::bigint, 'A cannot edit object');

with affected as (delete from construction_objects where id='20000000-0000-0000-0000-000000000002' returning id)
select is((select count(*) from affected), 0::bigint, 'A cannot delete object');

select throws_ok($q$insert into tasks(title,object_id,assignee_id) values ('hack','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002')$q$, '42501', null, 'Executor cannot create task');

select throws_ok($q$insert into construction_objects(name,address) values ('hack','hack')$q$, '42501', null, 'Executor cannot create object');

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000002', 'new', 'in_progress', null)$q$, '42501', null, 'RPC rejects another executor task');

select throws_ok($q$update profiles set role='manager' where id='10000000-0000-0000-0000-000000000002'$q$, '42501', null, 'Role escalation denied');

select throws_ok($q$insert into profiles values ('10000000-0000-0000-0000-000000000005','hack','manager')$q$, '42501', null, 'Profile creation denied');

select throws_ok($q$delete from profiles where id='10000000-0000-0000-0000-000000000002'$q$, '42501', null, 'Profile deletion denied');

select set_config('request.jwt.claims', '{"user_metadata":{"role":"manager"}}', true);

select is((select count(*) from tasks)::bigint, 1::bigint, 'User metadata cannot elevate role');

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;

select is((select count(*) from tasks where id = '30000000-0000-0000-0000-000000000002')::bigint, 1::bigint, 'B sees B task');

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
set local role authenticated;

select is((select count(*) from tasks)::bigint, 2::bigint, 'Second manager sees all tasks');

select is((select count(*) from construction_objects)::bigint, 2::bigint, 'Manager sees all objects');

select is((select count(*) from profiles)::bigint, 4::bigint, 'Manager can list assignees');

select lives_ok($q$update tasks set title='Edited', description='Details', object_id='20000000-0000-0000-0000-000000000002', assignee_id='10000000-0000-0000-0000-000000000003' where id='30000000-0000-0000-0000-000000000001'$q$, 'Manager edits mutable task fields');

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select is((select count(*) from tasks)::bigint, 0::bigint, 'Reassignment immediately removes access');

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'new', 'in_progress', null)$q$, '42501', null, 'Former assignee cannot transition');

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;

select is((select count(*) from tasks)::bigint, 2::bigint, 'New assignee gains access');

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok($q$update tasks set object_id='20000000-0000-0000-0000-000000000001',assignee_id='10000000-0000-0000-0000-000000000002' where id='30000000-0000-0000-0000-000000000001'$q$, 'Manager restores assignment');

select lives_ok($q$update construction_objects set name='Edited',address='New address' where id='20000000-0000-0000-0000-000000000001'$q$, 'Manager edits object');

select throws_ok($q$delete from construction_objects where id='20000000-0000-0000-0000-000000000001'$q$, '23503', null, 'Nonempty object deletion restricted');

select throws_ok($q$update tasks set assignee_id='10000000-0000-0000-0000-000000000001' where id='30000000-0000-0000-0000-000000000001'$q$, '23503', null, 'Only executor can be assigned');

select throws_ok($q$update tasks set title='  ' where id='30000000-0000-0000-0000-000000000001'$q$, '23514', null, 'Blank title rejected');

select throws_ok($q$update tasks set object_id='99999999-0000-0000-0000-000000000000' where id='30000000-0000-0000-0000-000000000001'$q$, '23503', null, 'Missing object rejected');

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok($q$update tasks set status='accepted' where id='30000000-0000-0000-0000-000000000001'$q$, '42501', null, 'Manager cannot directly update status');

select throws_ok($q$update tasks set author_id='10000000-0000-0000-0000-000000000003' where id='30000000-0000-0000-0000-000000000001'$q$, '42501', null, 'Manager cannot directly update author_id');

select throws_ok($q$update tasks set created_at=now() where id='30000000-0000-0000-0000-000000000001'$q$, '42501', null, 'Manager cannot directly update created_at');

select throws_ok($q$update tasks set id='30000000-0000-0000-0000-000000000002' where id='30000000-0000-0000-0000-000000000001'$q$, '42501', null, 'Manager cannot directly update id');

select throws_ok($q$update tasks set assignee_role='manager' where id='30000000-0000-0000-0000-000000000001'$q$, '42501', null, 'Manager cannot directly update assignee_role');

select throws_ok($q$insert into task_status_history(task_id,to_status,actor_id) values ('30000000-0000-0000-0000-000000000001','new','10000000-0000-0000-0000-000000000001')$q$, '42501', null, 'Manager cannot insert history');

select throws_ok($q$update task_status_history set comment='forged' where task_id='30000000-0000-0000-0000-000000000001'$q$, '42501', null, 'Manager cannot update history');

select throws_ok($q$delete from task_status_history where task_id='30000000-0000-0000-0000-000000000001'$q$, '42501', null, 'Manager cannot delete history');

select throws_ok($q$truncate task_status_history$q$, '42501', null, 'Manager cannot truncate history');

select throws_ok($q$insert into tasks(title,object_id,assignee_id,status) values ('Forged','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','accepted')$q$, '42501', null, 'Manager cannot create task with supplied status');

select throws_ok($q$select private.record_task_creation()$q$, '42501', null, 'Manager cannot invoke trigger function');

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select throws_ok($q$update tasks set status='accepted' where id='30000000-0000-0000-0000-000000000001'$q$, '42501', null, 'Executor cannot directly update status');

select throws_ok($q$update tasks set author_id='10000000-0000-0000-0000-000000000003' where id='30000000-0000-0000-0000-000000000001'$q$, '42501', null, 'Executor cannot directly update author_id');

select throws_ok($q$update tasks set created_at=now() where id='30000000-0000-0000-0000-000000000001'$q$, '42501', null, 'Executor cannot directly update created_at');

select throws_ok($q$update tasks set id='30000000-0000-0000-0000-000000000002' where id='30000000-0000-0000-0000-000000000001'$q$, '42501', null, 'Executor cannot directly update id');

select throws_ok($q$update tasks set assignee_role='manager' where id='30000000-0000-0000-0000-000000000001'$q$, '42501', null, 'Executor cannot directly update assignee_role');

select throws_ok($q$insert into task_status_history(task_id,to_status,actor_id) values ('30000000-0000-0000-0000-000000000001','new','10000000-0000-0000-0000-000000000002')$q$, '42501', null, 'Executor cannot insert history');

select throws_ok($q$update task_status_history set comment='forged' where task_id='30000000-0000-0000-0000-000000000001'$q$, '42501', null, 'Executor cannot update history');

select throws_ok($q$delete from task_status_history where task_id='30000000-0000-0000-0000-000000000001'$q$, '42501', null, 'Executor cannot delete history');

select throws_ok($q$truncate task_status_history$q$, '42501', null, 'Executor cannot truncate history');

select throws_ok($q$insert into tasks(title,object_id,assignee_id,status) values ('Forged','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','accepted')$q$, '42501', null, 'Executor cannot create task with supplied status');

select throws_ok($q$select private.record_task_creation()$q$, '42501', null, 'Executor cannot invoke trigger function');

reset role;
update tasks set status='new' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'new', 'new', 'Test comment')$q$, '42501', null, 'executor: new -> new');

reset role;
update tasks set status='new' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select lives_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'new', 'in_progress', 'Test comment')$q$, 'executor: new -> in_progress');

reset role;
update tasks set status='new' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'new', 'in_review', 'Test comment')$q$, '42501', null, 'executor: new -> in_review');

reset role;
update tasks set status='new' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'new', 'accepted', 'Test comment')$q$, '42501', null, 'executor: new -> accepted');

reset role;
update tasks set status='new' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'new', 'needs_revision', 'Test comment')$q$, '42501', null, 'executor: new -> needs_revision');

reset role;
update tasks set status='in_progress' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'in_progress', 'new', 'Test comment')$q$, '42501', null, 'executor: in_progress -> new');

reset role;
update tasks set status='in_progress' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'in_progress', 'in_progress', 'Test comment')$q$, '42501', null, 'executor: in_progress -> in_progress');

reset role;
update tasks set status='in_progress' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select lives_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'in_progress', 'in_review', 'Test comment')$q$, 'executor: in_progress -> in_review');

reset role;
update tasks set status='in_progress' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'in_progress', 'accepted', 'Test comment')$q$, '42501', null, 'executor: in_progress -> accepted');

reset role;
update tasks set status='in_progress' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'in_progress', 'needs_revision', 'Test comment')$q$, '42501', null, 'executor: in_progress -> needs_revision');

reset role;
update tasks set status='in_review' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'in_review', 'new', 'Test comment')$q$, '42501', null, 'executor: in_review -> new');

reset role;
update tasks set status='in_review' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'in_review', 'in_progress', 'Test comment')$q$, '42501', null, 'executor: in_review -> in_progress');

reset role;
update tasks set status='in_review' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'in_review', 'in_review', 'Test comment')$q$, '42501', null, 'executor: in_review -> in_review');

reset role;
update tasks set status='in_review' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'in_review', 'accepted', 'Test comment')$q$, '42501', null, 'executor: in_review -> accepted');

reset role;
update tasks set status='in_review' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'in_review', 'needs_revision', 'Test comment')$q$, '42501', null, 'executor: in_review -> needs_revision');

reset role;
update tasks set status='accepted' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'accepted', 'new', 'Test comment')$q$, '42501', null, 'executor: accepted -> new');

reset role;
update tasks set status='accepted' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'accepted', 'in_progress', 'Test comment')$q$, '42501', null, 'executor: accepted -> in_progress');

reset role;
update tasks set status='accepted' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'accepted', 'in_review', 'Test comment')$q$, '42501', null, 'executor: accepted -> in_review');

reset role;
update tasks set status='accepted' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'accepted', 'accepted', 'Test comment')$q$, '42501', null, 'executor: accepted -> accepted');

reset role;
update tasks set status='accepted' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'accepted', 'needs_revision', 'Test comment')$q$, '42501', null, 'executor: accepted -> needs_revision');

reset role;
update tasks set status='needs_revision' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'needs_revision', 'new', 'Test comment')$q$, '42501', null, 'executor: needs_revision -> new');

reset role;
update tasks set status='needs_revision' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select lives_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'needs_revision', 'in_progress', 'Test comment')$q$, 'executor: needs_revision -> in_progress');

reset role;
update tasks set status='needs_revision' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'needs_revision', 'in_review', 'Test comment')$q$, '42501', null, 'executor: needs_revision -> in_review');

reset role;
update tasks set status='needs_revision' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'needs_revision', 'accepted', 'Test comment')$q$, '42501', null, 'executor: needs_revision -> accepted');

reset role;
update tasks set status='needs_revision' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'needs_revision', 'needs_revision', 'Test comment')$q$, '42501', null, 'executor: needs_revision -> needs_revision');

reset role;
update tasks set status='new' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'new', 'new', 'Test comment')$q$, '42501', null, 'manager: new -> new');

reset role;
update tasks set status='new' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'new', 'in_progress', 'Test comment')$q$, '42501', null, 'manager: new -> in_progress');

reset role;
update tasks set status='new' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'new', 'in_review', 'Test comment')$q$, '42501', null, 'manager: new -> in_review');

reset role;
update tasks set status='new' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'new', 'accepted', 'Test comment')$q$, '42501', null, 'manager: new -> accepted');

reset role;
update tasks set status='new' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'new', 'needs_revision', 'Test comment')$q$, '42501', null, 'manager: new -> needs_revision');

reset role;
update tasks set status='in_progress' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'in_progress', 'new', 'Test comment')$q$, '42501', null, 'manager: in_progress -> new');

reset role;
update tasks set status='in_progress' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'in_progress', 'in_progress', 'Test comment')$q$, '42501', null, 'manager: in_progress -> in_progress');

reset role;
update tasks set status='in_progress' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'in_progress', 'in_review', 'Test comment')$q$, '42501', null, 'manager: in_progress -> in_review');

reset role;
update tasks set status='in_progress' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'in_progress', 'accepted', 'Test comment')$q$, '42501', null, 'manager: in_progress -> accepted');

reset role;
update tasks set status='in_progress' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'in_progress', 'needs_revision', 'Test comment')$q$, '42501', null, 'manager: in_progress -> needs_revision');

reset role;
update tasks set status='in_review' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'in_review', 'new', 'Test comment')$q$, '42501', null, 'manager: in_review -> new');

reset role;
update tasks set status='in_review' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'in_review', 'in_progress', 'Test comment')$q$, '42501', null, 'manager: in_review -> in_progress');

reset role;
update tasks set status='in_review' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'in_review', 'in_review', 'Test comment')$q$, '42501', null, 'manager: in_review -> in_review');

reset role;
update tasks set status='in_review' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'in_review', 'accepted', 'Test comment')$q$, 'manager: in_review -> accepted');

reset role;
update tasks set status='in_review' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'in_review', 'needs_revision', 'Test comment')$q$, 'manager: in_review -> needs_revision');

reset role;
update tasks set status='accepted' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'accepted', 'new', 'Test comment')$q$, '42501', null, 'manager: accepted -> new');

reset role;
update tasks set status='accepted' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'accepted', 'in_progress', 'Test comment')$q$, '42501', null, 'manager: accepted -> in_progress');

reset role;
update tasks set status='accepted' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'accepted', 'in_review', 'Test comment')$q$, '42501', null, 'manager: accepted -> in_review');

reset role;
update tasks set status='accepted' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'accepted', 'accepted', 'Test comment')$q$, '42501', null, 'manager: accepted -> accepted');

reset role;
update tasks set status='accepted' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'accepted', 'needs_revision', 'Test comment')$q$, '42501', null, 'manager: accepted -> needs_revision');

reset role;
update tasks set status='needs_revision' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'needs_revision', 'new', 'Test comment')$q$, '42501', null, 'manager: needs_revision -> new');

reset role;
update tasks set status='needs_revision' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'needs_revision', 'in_progress', 'Test comment')$q$, '42501', null, 'manager: needs_revision -> in_progress');

reset role;
update tasks set status='needs_revision' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'needs_revision', 'in_review', 'Test comment')$q$, '42501', null, 'manager: needs_revision -> in_review');

reset role;
update tasks set status='needs_revision' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'needs_revision', 'accepted', 'Test comment')$q$, '42501', null, 'manager: needs_revision -> accepted');

reset role;
update tasks set status='needs_revision' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'needs_revision', 'needs_revision', 'Test comment')$q$, '42501', null, 'manager: needs_revision -> needs_revision');

reset role;
update tasks set status='in_review' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'in_review', 'needs_revision', null)$q$, '23514', null, 'Revision requires nonblank comment');

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'in_review', 'needs_revision', '')$q$, '23514', null, 'Revision requires nonblank comment');

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'in_review', 'needs_revision', E' \t\n ')$q$, '23514', null, 'Revision requires nonblank comment');

select is((select count(*) from tasks where id='30000000-0000-0000-0000-000000000001' and status='in_review')::bigint, 1::bigint, 'Rejected transitions preserve status');

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'new', 'accepted', null)$q$, '40001', null, 'Stale expected status rejected');

select throws_ok($q$select transition_task('30000000-0000-0000-0000-000000000001',null,'accepted')$q$, '40001', null, 'Null expected status rejected');

select throws_ok($q$select transition_task('30000000-0000-0000-0000-000000000001','in_review',null)$q$, '42501', null, 'Null destination rejected');

reset role;
delete from task_status_history where task_id='30000000-0000-0000-0000-000000000001';
update tasks set status='new' where id='30000000-0000-0000-0000-000000000001';

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select lives_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'new', 'in_progress', null)$q$, 'Lifecycle starts');

select lives_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'in_progress', 'in_review', null)$q$, 'Lifecycle submits');

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'in_review', 'needs_revision', 'Fix the wall')$q$, 'Manager requests revision');

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select lives_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'needs_revision', 'in_progress', null)$q$, 'Executor resumes');

select lives_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'in_progress', 'in_review', null)$q$, 'Executor resubmits');

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
set local role authenticated;

select lives_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'in_review', 'accepted', null)$q$, 'Second manager accepts');

select is((select count(*) from task_status_history where task_id='30000000-0000-0000-0000-000000000001')::bigint, 6::bigint, 'Exactly one history row per transition');

select ok((select actor_id='10000000-0000-0000-0000-000000000001' and comment='Fix the wall' and changed_at is not null from task_status_history where task_id='30000000-0000-0000-0000-000000000001' and to_status='needs_revision'), 'History stores actual actor comment time');

select ok((select bool_and(from_status=previous_status) from (select from_status,lag(to_status) over(order by id) previous_status from task_status_history where task_id='30000000-0000-0000-0000-000000000001') h where previous_status is not null), 'History forms contiguous status chain');

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000005', true);
set local role authenticated;

select is((select count(*) from tasks)::bigint, 0::bigint, 'Unprovisioned account sees no tasks');

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'accepted', 'new', null)$q$, '42501', null, 'Unprovisioned account denied RPC');

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role authenticated;

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'accepted', 'new', null)$q$, '42501', null, 'Missing auth uid denied RPC');

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;

select throws_ok($q$select * from tasks$q$, '42501', null, 'Anonymous reads denied');

select throws_ok($q$select public.transition_task('30000000-0000-0000-0000-000000000001', 'accepted', 'new', null)$q$, '42501', null, 'Anonymous RPC denied');

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok($q$delete from tasks where id='30000000-0000-0000-0000-000000000001'$q$, 'Manager hard deletes task');

select is((select count(*) from tasks where id='30000000-0000-0000-0000-000000000001')::bigint, 0::bigint, 'Deleted task absent');

reset role;

select is((select count(*) from task_status_history where task_id='30000000-0000-0000-0000-000000000001')::bigint, 0::bigint, 'History physically cascades (verified as owner)');

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok($q$delete from construction_objects where id='20000000-0000-0000-0000-000000000001'$q$, 'Empty object deletion allowed');

select lives_ok($q$insert into construction_objects(name,address) values ('New object','New address')$q$, 'Manager creates object');

select lives_ok($q$insert into tasks(title,object_id,assignee_id) values ('New task','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002')$q$, 'Manager creates task');

select ok((select author_id=auth.uid() and status='new' and created_at is not null from tasks where title='New task'), 'Task author status date generated by DB');

select is((select count(*) from task_status_history h join tasks t on t.id=h.task_id where t.title='New task' and h.from_status is null and h.to_status='new' and h.actor_id=auth.uid())::bigint, 1::bigint, 'Creation automatically records initial status');

reset role;

select is((select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('profiles','tasks','construction_objects','task_status_history') and c.relrowsecurity)::bigint, 4::bigint, 'All API tables have RLS');

-- Force a history-write failure as the trusted test owner, then call the real RPC
-- as the executor. A status update must not survive a failed audit insert.
create function pg_temp.reject_history() returns trigger language plpgsql as $$
begin
  raise exception 'Injected audit failure' using errcode = '23514';
end;
$$;

create trigger test_reject_history before insert on public.task_status_history
  for each row execute function pg_temp.reject_history();

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select throws_ok($q$
  select public.transition_task(
    (select id from public.tasks where title = 'New task'), 'new', 'in_progress'
  )
$q$, '23514', 'Injected audit failure', 'Audit write failure aborts RPC');

select is((select status::text from public.tasks where title = 'New task'),
  'new', 'Failed audit insertion rolls back task status');
select is((select count(*) from public.task_status_history h
  join public.tasks t on t.id = h.task_id where t.title = 'New task'),
  1::bigint, 'Failed RPC leaves history unchanged');

reset role;
drop trigger test_reject_history on public.task_status_history;

select * from finish();
rollback;
