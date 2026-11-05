import { randomUUID } from "node:crypto";

export async function prepareDemo({ admin, db, saved, saveCredentials }) {
  const users = saved.users;
  for (const name of ["manager1", "manager2", "executor1", "executor2"]) {
    const email = name + "@construction-demo.test",
      password = users[name]?.password ?? randomUUID() + "Aa1!";
    let existing;
    for (let page = 1; ; page++) {
      const { data, error } = await admin.auth.admin.listUsers({
        page,
        perPage: 100,
      });
      if (error) throw error;
      existing = data.users.find((u) => u.email === email);
      if (existing || data.users.length < 100) break;
    }
    // Persist the intended password before Auth changes. Reuse it after partial failures.
    users[name] = { id: existing?.id ?? "", email, password };
    saveCredentials({ ...saved, users });
    const { data, error } = existing
      ? await admin.auth.admin.updateUserById(existing.id, { password })
      : await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
    if (error) throw error;
    users[name] = { id: data.user.id, email, password };
    saveCredentials({ ...saved, users });
  }
  const sites = [
    "70000000-0000-0000-0000-000000000001",
    "70000000-0000-0000-0000-000000000002",
    "70000000-0000-0000-0000-000000000003",
  ];
  const tasks = [
    "80000000-0000-0000-0000-000000000001",
    "80000000-0000-0000-0000-000000000002",
    "80000000-0000-0000-0000-000000000003",
  ];
  await db.connect();
  try {
    await db.query("begin");
    for (const [name, u] of Object.entries(users))
      await db.query(
        "insert into profiles(id,display_name,role) values($1,$2,$3) on conflict(id) do update set display_name=excluded.display_name,role=excluded.role",
        [u.id, name, name.startsWith("manager") ? "manager" : "executor"],
      );
    await db.query("delete from tasks where id=any($1::uuid[])", [tasks]);
    for (let i = 0; i < sites.length; i++)
      await db.query(
        "insert into construction_objects(id,name,address) values($1,$2,$3) on conflict(id) do update set name=excluded.name,address=excluded.address",
        [
          sites[i],
          ["Демо Северный", "Демо Южный", "Демо Пустой"][i],
          "Улица Строителей, " + (i + 1),
        ],
      );
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      users.manager1.id,
    ]);
    for (let i = 0; i < tasks.length; i++)
      await db.query(
        "insert into tasks(id,title,description,object_id,assignee_id) values($1,$2,$3,$4,$5)",
        [
          tasks[i],
          ["Демо Опалубка", "Демо Фасад", "Демо Приёмка"][i],
          "Описание демонстрационной задачи",
          sites[i === 1 ? 1 : 0],
          users[i === 1 ? "executor2" : "executor1"].id,
        ],
      );
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      users.executor1.id,
    ]);
    await db.query("select transition_task($1,'new','in_progress')", [tasks[2]]);
    await db.query("select transition_task($1,'in_progress','in_review')", [
      tasks[2],
    ]);
    await db.query("commit");
  } finally {
    await db.end();
  }
  Object.assign(saved, { sites, tasks });
  saveCredentials({ ...saved, users });
}
