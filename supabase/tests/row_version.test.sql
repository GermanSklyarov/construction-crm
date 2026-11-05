begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(6);

insert into auth.users(id) values
  ('10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002');
insert into profiles(id, display_name, role) values
  ('10000000-0000-0000-0000-000000000001', 'Manager', 'manager'),
  ('10000000-0000-0000-0000-000000000002', 'Executor', 'executor');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;

insert into construction_objects(name,address) values ('Version fixture','Test');
create temporary table original_site as select id,row_version from construction_objects where name='Version fixture';
insert into tasks(title,description,object_id,assignee_id)
select 'Version fixture',repeat('Б',2000),id,'10000000-0000-0000-0000-000000000002' from original_site;
create temporary table original_task as select id,row_version from tasks where object_id in (select id from original_site);

update construction_objects set address='Updated' where id in (select id from original_site);
select ok(s.row_version <> o.row_version,'Object update rotates token') from construction_objects s join original_site o using(id);
select throws_ok('update tasks set row_version=gen_random_uuid()', '42501', null, 'Client cannot set task token');
select throws_ok('update construction_objects set row_version=gen_random_uuid()', '42501', null, 'Client cannot set object token');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
create temporary table transitioned as select r.id,r.row_version from original_task o,
 lateral transition_task(o.id,'new','in_progress') r;
select ok(r.row_version=t.row_version and r.row_version<>o.row_version,'RPC returns newly persisted version')
from transitioned r join tasks t using(id) join original_task o using(id);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
with deleted as (delete from tasks t using original_task o where t.id=o.id and t.row_version=o.row_version returning t.id)
select is(count(*),0::bigint,'Stale confirmation leaves task intact') from deleted;
with updated as (update tasks t set title='New title' from transitioned r where t.id=r.id and t.row_version=r.row_version returning t.row_version)
select ok(u.row_version<>r.row_version,'Metadata update rotates token for long description') from updated u cross join transitioned r;
select * from finish();
rollback;
