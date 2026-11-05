// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { Profile, Site, Task } from "./db";
import { Workspace } from "./workspace";

const { transport } = vi.hoisted(() => ({ transport: vi.fn<typeof fetch>() }));
vi.mock("./db", async (load) => {
  const original = await load<typeof import("./db")>();
  const { createClient } = await import("@supabase/supabase-js");
  return {
    ...original,
    db: createClient("https://crm.invalid", "public-test-key", {
      global: { fetch: transport },
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
});
afterEach(() => {
  cleanup();
  transport.mockReset();
});

const manager: Profile = { id: "m", role: "manager", display_name: "Анна" };
const executor: Profile = { id: "e", role: "executor", display_name: "Иван" };
const site: Site = {
  id: "s",
  row_version: "s1",
  name: "Корпус",
  address: "Полевая",
};
const initial: Task = {
  id: "t",
  row_version: "v1",
  title: "Опалубка",
  description: "Б".repeat(2000),
  status: "in_review",
  author_id: "m",
  assignee_id: "e",
  assignee_role: "executor",
  object_id: "s",
  created_at: "2026-01-01",
};

function setup(path: string, me = manager) {
  const state = {
    task: { ...initial },
    visible: true,
    siteVisible: true,
    offline: false,
    requests: [] as { url: URL; method: string }[],
  };
  transport.mockImplementation(async (input, init) => {
    const url = new URL(String(input)),
      method = init?.method ?? "GET";
    state.requests.push({ url, method });
    const table = url.pathname.split("/").pop();
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (state.offline)
      return json(
        { code: "proxy_error", message: "Temporary gateway failure" },
        500,
      );
    if (table === "tasks" && method !== "GET") {
      if (
        url.searchParams.get("row_version") !==
        "eq." + state.task.row_version
      )
        return json({ code: "PGRST116", message: "zero rows" }, 406);
      return json({ id: "t" });
    }
    if (
      table === "tasks" &&
      url.searchParams.has("id") &&
      new Headers(init?.headers).get("Accept")?.includes("vnd.pgrst.object")
    )
      return json(state.task);
    if (table === "tasks" && url.searchParams.has("id"))
      return json(state.visible ? [state.task] : []);
    if (table === "tasks") return json(state.visible ? [state.task] : []);
    if (table === "profiles") return json([manager, executor]);
    if (table === "construction_objects")
      return json(state.siteVisible ? [site] : []);
    return json([]);
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(["workspace", me.id], {
    me,
    people: [manager, executor],
    sites: [site],
    tasks: [initial],
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Workspace uid={me.id} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { state, client };
}

it("после переназначения скрывает ранее просмотренную карточку при повторном входе", async () => {
  const { state } = setup("/tasks/t", executor);
  await screen.findByRole("heading", { name: initial.title });
  fireEvent.click(screen.getByRole("link", { name: "Корпус" }));
  const link = await screen.findByRole("link", { name: /Опалубка/ });
  state.visible = false;
  fireEvent.click(link);
  expect(screen.queryByRole("heading", { name: initial.title })).toBeNull();
  await screen.findByText("Страница недоступна");
});
it("после конфликта удаления требует нового подтверждения", async () => {
  const { state } = setup("/tasks/t");
  fireEvent.click(
    await screen.findByRole("button", { name: "Удалить задачу" }),
  );
  state.task = { ...state.task, row_version: "v2", status: "accepted" };
  fireEvent.click(screen.getByRole("button", { name: "Да, удалить" }));
  await screen.findByText(/Запись изменилась/);
  expect(screen.queryByRole("button", { name: "Да, удалить" })).toBeNull();
  expect(
    state.requests
      .find((r) => r.method === "DELETE")
      ?.url.searchParams.get("row_version"),
  ).toBe("eq.v1");
  await screen.findByText("Принята");
  fireEvent.click(screen.getByRole("button", { name: "Удалить задачу" }));
  fireEvent.click(screen.getByRole("button", { name: "Да, удалить" }));
  await screen.findByRole("heading", { name: "Объекты" });
  expect(
    state.requests
      .filter((r) => r.method === "DELETE")
      .at(-1)
      ?.url.searchParams.get("row_version"),
  ).toBe("eq.v2");
});
it("редактирует длинное описание с коротким URL и исходной версией", async () => {
  const { state } = setup("/tasks/t/edit");
  fireEvent.change(await screen.findByLabelText("Название"), {
    target: { value: "Изменено" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Сохранить задачу" }));
  await waitFor(() =>
    expect(state.requests.some((r) => r.method === "PATCH")).toBe(true),
  );
  const url = state.requests.find((r) => r.method === "PATCH")!.url;
  expect(url.searchParams.get("row_version")).toBe("eq.v1");
  expect(url.href.length).toBeLessThan(200);
});
it("сохраняет черновик при временном сбое и восстановлении связи", async () => {
  const { client, state } = setup("/tasks/t/edit");
  fireEvent.change(await screen.findByLabelText("Название"), {
    target: { value: "Черновик" },
  });
  state.offline = true;
  await act(() => client.invalidateQueries({ queryKey: ["workspace"] }));
  await screen.findByRole("alert");
  expect(screen.getByDisplayValue("Черновик")).toBeTruthy();
  state.offline = false;
  fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(screen.getByDisplayValue("Черновик")).toBeTruthy();
});
it("объясняет ограничение удаления непустого объекта", async () => {
  setup("/objects/s");
  expect(await screen.findByText(/Чтобы удалить объект/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Удалить объект" })).toBeNull();
});
it("разрешает возврат на доработку только после комментария", async () => {
  setup("/tasks/t");
  const revise = await screen.findByRole("button", {
    name: "Вернуть на доработку",
  });
  expect(revise.hasAttribute("disabled")).toBe(true);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Исправить стык" },
  });
  expect(revise.hasAttribute("disabled")).toBe(false);
});

it.each([true, false])(
  "при входе заново проверяет объект и состав задач (доступ: %s)",
  async (siteVisible) => {
    const { state } = setup("/objects", executor);
    state.siteVisible = siteVisible;
    state.visible = false;
    fireEvent.click(screen.getByRole("link", { name: /Корпус/ }));
    await screen.findByText(
      siteVisible ? "Задач пока нет" : "Страница недоступна",
    );
    expect(screen.queryByText(initial.title)).toBeNull();
    if (!siteVisible) expect(screen.queryByText(site.address)).toBeNull();
  },
);

it("открывает редактор с актуальным текстом и версией из карточки", async () => {
  const { state } = setup("/tasks/t");
  state.task = { ...state.task, title: "Новая версия", row_version: "v2" };
  await screen.findByRole("heading", { name: "Новая версия" });
  fireEvent.click(screen.getByRole("link", { name: "Редактировать" }));
  await screen.findByDisplayValue("Новая версия");
  fireEvent.click(screen.getByRole("button", { name: "Сохранить задачу" }));
  await waitFor(() =>
    expect(
      state.requests
        .find((r) => r.method === "PATCH")
        ?.url.searchParams.get("row_version"),
    ).toBe("eq.v2"),
  );
});
