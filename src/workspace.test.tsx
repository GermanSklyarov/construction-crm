import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { Workspace } from "./workspace";
import type { Profile, Site, Task } from "./db";

const manager: Profile = { id: "m", role: "manager", display_name: "Анна" };
const executor: Profile = { id: "e", role: "executor", display_name: "Иван" };
const site: Site = {
  row_version: "s1",
  id: "s",
  name: "Корпус Б",
  address: "Полевая, 3",
};
const task: Task = {
  row_version: "v1",
  id: "t",
  title: "Проверить опалубку",
  description: "",
  object_id: site.id,
  assignee_id: executor.id,
  assignee_role: "executor",
  author_id: manager.id,
  status: "in_review",
  created_at: "2026-01-01T12:00:00Z",
};

function screen(path: string, me: Profile, tasks: Task[] = [task]) {
  const client = new QueryClient();
  client.setQueryData(["workspace", me.id], {
    me,
    people: [manager, executor],
    sites: [site],
    tasks,
  });
  client.setQueryData(["history", task.id], []);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Workspace uid={me.id} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("закрывает прямую ссылку на редактор для исполнителя", () => {
  const html = screen("/tasks/t/edit", executor);
  expect(html).toContain("Страница недоступна");
  expect(html).not.toContain("Сохранить задачу");
});
it("ждёт новую проверку доступа перед отображением кэшированной карточки", () => {
  const html = screen("/tasks/t", manager);
  expect(html).toContain("Загрузка задачи");
  expect(html).not.toContain(task.title);
});
it("отображает пустой список назначений", () => {
  expect(screen("/my-tasks", executor, [])).toContain("Задач пока нет");
});
