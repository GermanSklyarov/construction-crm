import { test, expect, type Page, type Browser } from "@playwright/test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { randomUUID } from "node:crypto";
const demo: {users:Record<string,{id:string;email:string;password:string}>;sites:string[];tasks:string[]} = JSON.parse(readFileSync(".local/demo.json", "utf8"));
const local: {API_URL:string;DB_URL:string;ANON_KEY:string} = JSON.parse(
  execFileSync("node_modules/.bin/supabase", ["status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
);
if (new URL(local.API_URL).hostname !== "127.0.0.1") throw Error("Local only");
test.describe.configure({ mode: "serial" });
async function login(page: Page, name: string) {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill(demo.users[name].email);
  await page
    .getByLabel("Пароль", { exact: true })
    .fill(demo.users[name].password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByRole("button", { name: "Выйти" })).toBeVisible();
}
async function session(browser: Browser, name: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, name);
  return { page, context };
}
async function task(page: Page, id = demo.tasks[0]) {
  await page.goto("/tasks/" + id);
  await expect(
    page.getByRole("heading", { name: /Демо/ }).first(),
  ).toBeVisible();
}
async function client(name: string) {
  const c = createClient(local.API_URL, local.ANON_KEY, {
    auth: { persistSession: false },
  });
  const { error } = await c.auth.signInWithPassword({
    email: demo.users[name].email,
    password: demo.users[name].password,
  });
  if (error) throw error;
  return c;
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

// Each invocation owns an unguessable name, including if creation succeeds but UI fails.
async function withTemporaryObject(run: (name: string) => Promise<void>) {
  const name = "E2E временный объект " + randomUUID();
  try {
    await run(name);
  } finally {
    const sql = new pg.Client({ connectionString: local.DB_URL });
    await sql.connect();
    try {
      await sql.query("begin");
      await sql.query("delete from tasks where object_id in (select id from construction_objects where name=$1)", [name]);
      await sql.query("delete from construction_objects where name=$1", [name]);
      await sql.query("commit");
    } finally {
      await sql.end();
    }
  }
}

test("Регрессия — подготовка после переноса демозадачи", async () => {
  const sql = new pg.Client({ connectionString: local.DB_URL });
  await sql.connect();
  const outside = randomUUID(), unrelated = randomUUID();
  try {
    await sql.query("select set_config('request.jwt.claim.sub',$1,false)", [demo.users.manager1.id]);
    await sql.query("insert into construction_objects(id,name,address) values($1,'Seed regression','Regression')", [outside]);
    await sql.query("update tasks set object_id=$1 where id=$2", [outside, demo.tasks[0]]);
    await sql.query("insert into tasks(id,title,object_id,assignee_id) values($1,'Unrelated task',$2,$3)", [unrelated, demo.sites[0], demo.users.executor1.id]);
    for (let attempt = 0; attempt < 2; attempt++) {
      execFileSync(process.execPath, ["scripts/prepare-demo.mjs"], { stdio: "pipe" });
      expect((await sql.query("select object_id from tasks where id=$1", [demo.tasks[0]])).rows[0].object_id).toBe(demo.sites[0]);
      expect((await sql.query("select id from tasks where id=$1", [unrelated])).rowCount).toBe(1);
      const saved = JSON.parse(readFileSync(".local/demo.json", "utf8"));
      for (const name of Object.keys(demo.users)) {
        expect(saved.users[name].password === demo.users[name].password).toBe(true);
        await client(name);
      }
    }
  } finally {
    await sql.query("delete from tasks where id=$1", [unrelated]);
    await sql.query("update tasks set object_id=$1 where id=$2", [demo.sites[0], demo.tasks[0]]);
    await sql.query("delete from construction_objects where id=$1", [outside]);
    await sql.end();
  }
});

test("A — создание, редактирование и каскадное удаление через UI", async ({
  page,
}) => {
  await withTemporaryObject(async (objectName) => {
    await login(page, "manager1");
    for (const name of ["Демо Северный", "Демо Южный", "Демо Пустой"])
      await expect(
        page.getByRole("link", { name: new RegExp(name) }),
      ).toBeVisible();
    await page.getByRole("link", { name: "Создать объект" }).click();
    await page
      .getByLabel("Название", { exact: true })
      .fill(objectName);
    await page.getByLabel("Адрес").fill("Проверочная улица");
    await page.getByRole("button", { name: "Сохранить объект" }).click();
    await page.getByRole("link", {name:"Редактировать",exact:true}).click();
    await page.getByLabel("Адрес").fill("Проверочная улица, 2");
    await page.getByRole("button",{name:"Сохранить объект"}).click();
    await expect(page.getByText("Проверочная улица, 2")).toBeVisible();
    await page.getByRole("link", { name: "Создать задачу" }).click();
    await page
      .getByLabel("Название", { exact: true })
      .fill("E2E временная задача");
    await page.getByLabel("Исполнитель").selectOption(demo.users.executor1.id);
    await page.getByRole("button", { name: "Сохранить задачу" }).click();
    await expect(
      page.getByRole("heading", { name: "E2E временная задача" }),
    ).toBeVisible();
    const id = page.url().split("/").pop()!;
    await expect(page.locator("article")).toHaveCount(1);
    await expect(page.locator("article")).toContainText("Новая");
    await page.getByRole("link", { name: "Редактировать", exact: true }).click();
    const long = "Очень длинное описание ".repeat(200);
    await page.getByLabel("Описание").fill(long);
    await page.getByRole("button", { name: "Сохранить задачу" }).click();
    await expect(page.locator(".description")).toContainText(long.trim());
    await page.getByRole("link", { name: "Редактировать", exact: true }).click();
    await page
      .getByLabel("Название", { exact: true })
      .fill("ДлинноеНазвание".repeat(15));
    await page.getByRole("button", { name: "Сохранить задачу" }).click();
    for (const [width, height] of [
      [1440, 900],
      [768, 1024],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await noOverflow(page);
      await page.screenshot({
        path: "test-results/task-" + width + ".png",
        fullPage: true,
      });
    }
    await page
      .getByRole("button", { name: "Удалить задачу", exact: true })
      .click();
    await page.getByRole("button", { name: "Да, удалить" }).click();
    await page.getByRole("link", { name: new RegExp(objectName) }).click();
    await page
      .getByRole("button", { name: "Удалить объект", exact: true })
      .click();
    await page.getByRole("button", { name: "Да, удалить" }).click();
    const sql = new pg.Client({ connectionString: local.DB_URL });
    await sql.connect();
    try {
      expect(
        (
          await sql.query(
            "select count(*)::int n from task_status_history where task_id=$1",
            [id],
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await sql.end();
    }
  });
});

test("Регрессия — очистка после сбоя и повторный запуск", async () => {
  const c = await client("manager1");
  for (let attempt = 0; attempt < 2; attempt++) {
    let objectId = "", taskId = "";
    const failure = new Error("Intentional failure after creation");
    await expect(withTemporaryObject(async (name) => {
      const object = await c.from("construction_objects").insert({ name, address: "Regression" }).select().single();
      if (object.error) throw object.error;
      objectId = object.data.id;
      const created = await c.from("tasks").insert({ title: "Cleanup regression", object_id: objectId, assignee_id: demo.users.executor1.id }).select().single();
      if (created.error) throw created.error;
      taskId = created.data.id;
      throw failure;
    })).rejects.toBe(failure);
    const sql = new pg.Client({ connectionString: local.DB_URL });
    await sql.connect();
    try {
      for (const [table, column, id] of [["construction_objects", "id", objectId], ["tasks", "id", taskId], ["task_status_history", "task_id", taskId]]) {
        expect((await sql.query(`select count(*)::int n from ${table} where ${column}=$1`, [id])).rows[0].n).toBe(0);
      }
    } finally { await sql.end(); }
  }
});

test("B,C — исполнитель, доработка с комментарием, принятие и полная история", async ({
  browser,
}) => {
  const e = await session(browser, "executor1"),
    m = await session(browser, "manager1");
  try {
    await task(e.page);
    await expect(
      e.page.getByRole("link", { name: "Редактировать" }),
    ).toHaveCount(0);
    await expect(
      e.page.getByRole("button", { name: "Удалить задачу", exact: true }),
    ).toHaveCount(0);
    await e.page.getByRole("button", { name: "Взять в работу" }).click();
    await e.page.getByRole("button", { name: "Отправить на проверку" }).click();
    await expect(e.page.locator("article")).toHaveCount(3);
    await task(m.page);
    await expect(
      m.page.getByRole("button", { name: "Вернуть на доработку" }),
    ).toBeDisabled();
    await m.page.getByRole("textbox").fill("Исправить стык");
    await m.page.getByRole("button", { name: "Вернуть на доработку" }).click();
    await expect(m.page.locator(".badge")).toHaveText("На доработке");
    await e.page.reload();
    await expect(e.page.locator("article")).toContainText(["Исправить стык"]);
    await e.page.getByRole("button", { name: "Взять в работу" }).click();
    await e.page.getByRole("button", { name: "Отправить на проверку" }).click();
    await expect(e.page.locator(".badge")).toHaveText("На проверке");
    await m.page.reload();
    await m.page.getByRole("button", { name: "Принять", exact: true }).click();
    await expect(m.page.locator(".badge")).toHaveText("Принята");
    await expect(m.page.locator("article")).toHaveCount(7);
  } finally {
    await e.context.close();
    await m.context.close();
  }
});

test("D — изоляция и второй постановщик", async ({ page, browser }) => {
  await login(page, "executor2");
  await expect(page.getByRole("link", { name: /Демо Фасад/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Демо Опалубка/ })).toHaveCount(
    0,
  );
  await page.goto("/tasks/" + demo.tasks[0]);
  await expect(page.getByText("Страница недоступна")).toBeVisible();
  await page.goto("/objects/" + demo.sites[0]);
  await expect(page.getByText("Страница недоступна")).toBeVisible();
  const m = await session(browser, "manager2");
  try {
    await task(m.page);
    await expect(
      m.page.getByRole("link", { name: "Редактировать" }),
    ).toBeVisible();
  } finally {
    await m.context.close();
  }
});

test("E — конфликты правки, удаления и переназначение", async ({ browser }) => {
  const a = await session(browser, "manager1"),
    b = await session(browser, "manager2"),
    old = await session(browser, "executor1"),
    next = await session(browser, "executor2");
  try {
    await task(old.page, demo.tasks[2]);
    for (const p of [a.page, b.page]) {
      await task(p, demo.tasks[2]);
      await p.getByRole("link", { name: "Редактировать" }).click();
      await expect(p.getByLabel("Описание")).toBeVisible();
    }
    await a.page.getByLabel("Описание").fill("Первая правка");
    await a.page.getByRole("button", { name: "Сохранить задачу" }).click();
    await expect(
      a.page.getByRole("heading", { name: "Демо Приёмка" }),
    ).toBeVisible();
    await b.page.getByLabel("Описание").fill("Устаревшая правка");
    await b.page.getByRole("button", { name: "Сохранить задачу" }).click();
    await expect(b.page.getByRole("alert")).toContainText("Запись изменилась");
    await task(b.page, demo.tasks[2]);
    await b.page
      .getByRole("button", { name: "Удалить задачу", exact: true })
      .click();
    await a.page.getByRole("link", { name: "Редактировать" }).click();
    await a.page.getByLabel("Описание").fill("Вторая правка");
    await a.page.getByRole("button", { name: "Сохранить задачу" }).click();
    await expect(
      a.page.getByRole("heading", { name: "Демо Приёмка" }),
    ).toBeVisible();
    await b.page.getByRole("button", { name: "Да, удалить" }).click();
    await expect(b.page.getByRole("alert")).toContainText("Запись изменилась");
    await a.page.getByRole("link", { name: "Редактировать" }).click();
    await a.page
      .getByLabel("Исполнитель")
      .selectOption(demo.users.executor2.id);
    await a.page.getByRole("button", { name: "Сохранить задачу" }).click();
    await expect(
      a.page.getByRole("heading", { name: "Демо Приёмка" }),
    ).toBeVisible();
    await old.page.reload();
    await expect(old.page.getByText("Страница недоступна")).toBeVisible();
    await expect(old.page.getByRole("heading", { name: "Демо Приёмка" })).toHaveCount(0);
    await expect(old.page.locator("article")).toHaveCount(0);
    await task(next.page, demo.tasks[2]);
  } finally {
    await old.context.close();
    await next.context.close();
    await a.context.close();
    await b.context.close();
  }
});

test("JWT — прямые запросы безопасности", async () => {
  const a = await client("executor1"),
    m = await client("manager1");
  expect(
    (await a.from("tasks").select("*").eq("id", demo.tasks[1])).data,
  ).toEqual([]);
  expect(
    (
      await a
        .from("tasks")
        .update({ title: "hack" })
        .eq("id", demo.tasks[1])
        .select()
    ).data,
  ).toEqual([]);
  expect(
    (await a.from("tasks").delete().eq("id", demo.tasks[0]).select()).data,
  ).toEqual([]);
  for (const patch of [
    { status: "new" },
    { author_id: demo.users.executor2.id },
  ])
    expect(
      (await a.from("tasks").update(patch).eq("id", demo.tasks[0])).error?.code,
    ).toBe("42501");
  expect(
    (
      await a
        .from("profiles")
        .update({ role: "manager" })
        .eq("id", demo.users.executor1.id)
    ).error?.code,
  ).toBe("42501");
  for (const c of [a, m]) {
    expect(
      (
        await c
          .from("task_status_history")
          .insert({
            task_id: demo.tasks[0],
            to_status: "new",
            actor_id: demo.users.manager1.id,
          })
      ).error?.code,
    ).toBe("42501");
    expect(
      (
        await c
          .from("task_status_history")
          .update({ comment: "hack" })
          .eq("task_id", demo.tasks[0])
      ).error?.code,
    ).toBe("42501");
    expect(
      (
        await c
          .from("task_status_history")
          .delete()
          .eq("task_id", demo.tasks[0])
      ).error?.code,
    ).toBe("42501");
  }
  expect(
    (
      await a.rpc("transition_task", {
        p_task_id: demo.tasks[0],
        p_expected_status: "accepted",
        p_new_status: "new",
      })
    ).error?.code,
  ).toBe("42501");
  expect(
    (
      await m.rpc("transition_task", {
        p_task_id: demo.tasks[2],
        p_expected_status: "in_review",
        p_new_status: "needs_revision",
      })
    ).error?.code,
  ).toBe("23514");
});

for (const [width, height] of [
  [1440, 900],
  [768, 1024],
  [390, 844],
]) {
  test("UI — навигация, формы, пустые состояния " + width, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await login(page, "manager1");
    await noOverflow(page);
    await page.screenshot({
      path: "test-results/objects-" + width + ".png",
      fullPage: true,
    });
    await page.getByRole("link", { name: /Демо Пустой/ }).click();
    await expect(page.getByText("Задач пока нет")).toBeVisible();
    await page.getByRole("link", { name: "Создать задачу" }).click();
    await page
      .getByLabel("Название", { exact: true })
      .fill("ДлинноеНазвание".repeat(40));
    await page.getByLabel("Описание").fill("Описание ".repeat(1000));
    await page.getByLabel("Исполнитель").selectOption(demo.users.executor1.id);
    await noOverflow(page);
    await expect(
      page.getByRole("button", { name: "Сохранить задачу" }),
    ).toBeEnabled();
    await page.screenshot({
      path: "test-results/form-" + width + ".png",
      fullPage: true,
    });
    await task(page, demo.tasks[2]);
    await page
      .getByRole("button", { name: "Удалить задачу", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Да, удалить" }),
    ).toBeVisible();
    await noOverflow(page);
    await page.getByRole("button", { name: "Отмена", exact: true }).click();
  });
}
test("UI — ошибка входа, загрузка и сетевой сбой", async ({ page }) => {
  await page.goto("/");
  await page
    .getByLabel("Email", { exact: true })
    .fill(demo.users.manager1.email);
  await page.getByLabel("Пароль", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Неверный email или пароль",
  );
  await login(page, "manager1");
  await page.route("**/rest/v1/tasks?*", async (route) => {
    if (new URL(route.request().url()).searchParams.has("id"))
      await new Promise((resolve) => setTimeout(resolve, 800));
    await route.continue();
  });
  await page.goto("/tasks/" + demo.tasks[2]);
  await expect(page.getByText("Загрузка задачи…")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Демо Приёмка" }),
  ).toBeVisible();
  await page.unrouteAll();
  await page.route("**/rest/v1/profiles*", (route) => route.abort());
  await page.reload();
  await expect(page.getByRole("alert")).toContainText(
    "Не удалось выполнить запрос",
    { timeout: 30000 },
  );
  await page.unrouteAll();
  await page.getByRole("button", { name: "Повторить" }).click();
  await expect(
    page.getByRole("heading", { name: "Демо Приёмка" }),
  ).toBeVisible();
});
