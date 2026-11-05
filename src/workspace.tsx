import { useId, useState, type ReactNode } from "react";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
  useLocation,
} from "react-router-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  Building2,
  ClipboardList,
  LogOut,
  MapPin,
  ChevronRight,
  Plus,
  Layers3,
  ArrowLeft,
} from "lucide-react";
import {
  db,
  rows,
  pages,
  type Profile,
  type Site,
  type Task,
  type TaskFields,
} from "./db";
import { actions, labels, message, isAccessError, type Status } from "./domain";
import { Button } from "./ui/button";
import { SiteForm, TaskForm } from "./forms";
const date = (value: string) =>
  new Date(value).toLocaleString("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  });
function Badge({ s }: { s: Status }) {
  return <span className={"badge " + s}>{labels[s]}</span>;
}
export function Notice({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  return (
    <div role="alert" className="notice">
      {message(error)} {retry && <button onClick={retry}>Повторить</button>}
    </div>
  );
}
function Heading({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <header>
      <h1>{title}</h1>
      {action}
    </header>
  );
}
function Add({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Button asChild>
      <Link to={to}>
        <Plus size={17} />
        {children}
      </Link>
    </Button>
  );
}
type Data = { sites: Site[]; tasks: Task[]; people: Profile[]; me: Profile };
function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
function Tasks({ list, data }: { list: Task[]; data: Data }) {
  return list.length ? (
    <div className="panel">
      {list.map((t) => (
        <Link className="row" to={"/tasks/" + t.id} key={t.id}>
          <ClipboardList size={21} />
          <span className="grow">
            <strong>{t.title}</strong>
            <small>{data.sites.find((s) => s.id === t.object_id)?.name}</small>
          </span>
          <Badge s={t.status} />
          <ChevronRight size={16} />
        </Link>
      ))}
    </div>
  ) : (
    <Empty>Задач пока нет</Empty>
  );
}
function Sites({ data }: { data: Data }) {
  return (
    <>
      <Heading
        title="Объекты"
        action={
          data.me.role === "manager" && (
            <Add to="/objects/new">Создать объект</Add>
          )
        }
      />
      {data.sites.length ? (
        <section className="gridcards">
          {data.sites.map((s) => (
            <Link className="card" to={"/objects/" + s.id} key={s.id}>
              <Building2 className="symbol" />
              <h2>{s.name}</h2>
              <p>
                <MapPin size={15} />
                {s.address}
              </p>
              <footer>
                Задачи · {data.tasks.filter((t) => t.object_id === s.id).length}
                <ChevronRight size={17} />
              </footer>
            </Link>
          ))}
        </section>
      ) : (
        <Empty>Доступных объектов пока нет</Empty>
      )}
    </>
  );
}
function Back({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link className="back" to={to}>
      <ArrowLeft size={15} />
      {children}
    </Link>
  );
}
function Editor({
  data,
  kind,
  create = false,
}: {
  data: Data;
  kind: "site" | "task";
  create?: boolean;
}) {
  const { id, siteId } = useParams();
  const entry = useId();
  const query = useQuery({
    queryKey: ["editor", kind, id, entry],
    gcTime: 0,
    enabled: !create && data.me.role === "manager",
    queryFn: async () =>
      kind === "site"
        ? {
            site: await rows(
              db
                .from("construction_objects")
                .select("*")
                .eq("id", id!)
                .single(),
            ),
          }
        : {
            task: await rows(
              db.from("tasks").select("*").eq("id", id!).single(),
            ),
          },
  });
  if (
    data.me.role !== "manager" ||
    (siteId && !data.sites.some((s) => s.id === siteId))
  )
    return <Unavailable />;
  if (
    !create &&
    query.error &&
    (!query.data ||
      isAccessError(query.error) ||
      ("code" in query.error && query.error.code === "PGRST116"))
  )
    return <Notice error={query.error} retry={() => query.refetch()} />;
  if (!create && !query.data) return <Empty>Загрузка формы…</Empty>;
  return (
    <>
      {query.error && (
        <Notice error={query.error} retry={() => query.refetch()} />
      )}
      <EditorForm
        data={data}
        kind={kind}
        create={create}
        record={query.data ?? {}}
      />
    </>
  );
}
function EditorForm({
  data,
  kind,
  create,
  record,
}: {
  data: Data;
  kind: "site" | "task";
  create: boolean;
  record: { site?: Site; task?: Task };
}) {
  const { id, siteId } = useParams();
  const nav = useNavigate();
  const cache = useQueryClient();
  const [original] = useState(record);
  const m = useMutation({
    mutationFn: async (op: () => Promise<string>) => op(),
    onSuccess: async (path) => {
      await cache.invalidateQueries();
      nav(path, { replace: true });
    },
    onError: () => cache.invalidateQueries(),
  });
  const base = kind === "site" ? "/objects" : "/tasks";
  const saveSite = async (v: Omit<Site, "id" | "row_version">) => {
    await m
      .mutateAsync(async () => {
        const old = original.site;
        const q = create
          ? db.from("construction_objects").insert(v).select("id").single()
          : db
              .from("construction_objects")
              .update(v)
              .eq("id", id!)
              .eq("row_version", old!.row_version)
              .select("id")
              .single();
        return base + "/" + (await rows(q)).id;
      })
      .catch(() => {});
  };
  const saveTask = async (v: TaskFields) => {
    await m
      .mutateAsync(async () => {
        const old = original.task;
        const q = create
          ? db.from("tasks").insert(v).select("id").single()
          : db
              .from("tasks")
              .update(v)
              .eq("id", id!)
              .eq("row_version", old!.row_version)
              .select("id")
              .single();
        return base + "/" + (await rows(q)).id;
      })
      .catch(() => {});
  };
  return (
    <>
      <Back
        to={
          create
            ? siteId
              ? "/objects/" + siteId
              : "/objects"
            : base + "/" + id
        }
      >
        Отмена
      </Back>
      <Heading
        title={
          kind === "site"
            ? create
              ? "Новый объект"
              : "Редактирование объекта"
            : create
              ? "Новая задача"
              : "Редактирование задачи"
        }
      />
      <section className="panel pad">
        {m.error && (
          <Notice error={m.error} retry={() => window.location.reload()} />
        )}{" "}
        {kind === "site" ? (
          <SiteForm site={original.site} save={saveSite} />
        ) : (
          <TaskForm
            task={original.task}
            siteId={siteId ?? ""}
            sites={data.sites}
            people={data.people}
            save={saveTask}
          />
        )}
      </section>
    </>
  );
}
function Unavailable() {
  return (
    <>
      <Heading title="Страница недоступна" />
      <Empty>Проверьте адрес страницы и права доступа.</Empty>
      <Back to="/objects">К объектам</Back>
    </>
  );
}
function Remove({
  kind,
  id,
  version,
}: {
  kind: "tasks" | "construction_objects";
  id: string;
  version: string;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const nav = useNavigate();
  const cache = useQueryClient();
  const mutation = useMutation({
    mutationFn: (expected: string) =>
      rows(
        db
          .from(kind)
          .delete()
          .eq("id", id)
          .eq("row_version", expected)
          .select("id")
          .single(),
      ),
    onSuccess: async () => {
      await cache.invalidateQueries();
      nav("/objects", { replace: true });
    },
    onError: async () => {
      setConfirm(null);
      await cache.invalidateQueries();
    },
  });
  return (
    <section className="delete">
      {confirm ? (
        <>
          <strong>
            {kind === "tasks"
              ? "Удалить задачу вместе с историей?"
              : "Удалить объект?"}
          </strong>
          <Button
            disabled={mutation.isPending}
            variant="destructive"
            onClick={() => mutation.mutate(confirm)}
          >
            Да, удалить
          </Button>
          <Button
            disabled={mutation.isPending}
            variant="outline"
            onClick={() => setConfirm(null)}
          >
            Отмена
          </Button>
        </>
      ) : (
        <button onClick={() => setConfirm(version)}>
          Удалить {kind === "tasks" ? "задачу" : "объект"}
        </button>
      )}
      {mutation.error && <Notice error={mutation.error} />}
    </section>
  );
}
function SitePage({ data }: { data: Data }) {
  const { id } = useParams();
  const entry = useId();
  const detail = useQuery({
    queryKey: ["object", id, entry],
    gcTime: 0,
    queryFn: async () => {
      const { data: site, error } = await db
        .from("construction_objects")
        .select("*")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      if (!site) return null;
      const tasks = await pages((start, end) =>
        db
          .from("tasks")
          .select("*")
          .eq("object_id", id!)
          .order("created_at", { ascending: false })
          .order("id")
          .range(start, end),
      );
      return { site, tasks };
    },
  });
  if (detail.isPending) return <Empty>Загрузка объекта…</Empty>;
  if (detail.error)
    return <Notice error={detail.error} retry={() => detail.refetch()} />;
  const s = detail.data?.site;
  if (!s || !detail.data) return <Unavailable />;
  const manager = data.me.role === "manager";
  return (
    <>
      <Back to="/objects">Объекты</Back>
      <Heading
        title={s.name}
        action={manager && <Link to="edit">Редактировать</Link>}
      />
      <p className="address">
        <MapPin size={18} />
        {s.address}
      </p>
      <header>
        <h2>Задачи объекта</h2>
        {manager && (
          <Add to={"/objects/" + id + "/tasks/new"}>Создать задачу</Add>
        )}
      </header>
      <Tasks list={detail.data.tasks} data={data} />
      {manager &&
        (detail.data.tasks.length > 0 ? (
          <p>Чтобы удалить объект, перенесите или удалите его задачи.</p>
        ) : (
          <Remove
            kind="construction_objects"
            id={s.id}
            version={s.row_version}
          />
        ))}
    </>
  );
}
function Workflow({ task, me }: { task: Task; me: Profile }) {
  const [comment, setComment] = useState("");
  const cache = useQueryClient();
  const next = actions(me.role, task.status, task.assignee_id === me.id);
  const m = useMutation({
    mutationFn: (s: Status) =>
      rows(
        db.rpc("transition_task", {
          p_task_id: task.id,
          p_expected_status: task.status,
          p_new_status: s,
          p_comment: comment.trim() || undefined,
        }),
      ),
    onSuccess: async () => {
      setComment("");
      await cache.invalidateQueries();
    },
    onError: () => cache.invalidateQueries(),
  });
  const names: Partial<Record<Status, string>> = {
    in_progress: "Взять в работу",
    in_review: "Отправить на проверку",
    accepted: "Принять",
    needs_revision: "Вернуть на доработку",
  };
  return (
    <>
      {m.error && <Notice error={m.error} />}{" "}
      {next.length > 0 && (
        <section className="panel pad">
          <h2>Изменить статус</h2>
          <label>
            Комментарий{" "}
            {next.includes("needs_revision")
              ? "(обязателен для доработки)"
              : "(необязательно)"}
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </label>
          <div className="buttons">
            {next.map((s) => (
              <Button
                key={s}
                variant={s === "needs_revision" ? "outline" : "default"}
                disabled={
                  m.isPending || (s === "needs_revision" && !comment.trim())
                }
                onClick={() => m.mutate(s)}
              >
                {names[s]}
              </Button>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
function TaskPage({ data }: { data: Data }) {
  const { id } = useParams();
  // Require a fresh RLS-checked response on each entry, including back navigation.
  const entry = useId();
  const detail = useQuery({
    queryKey: ["task", id, entry],
    gcTime: 0,
    queryFn: async () => {
      const { data, error } = await db
        .from("tasks")
        .select("*")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const t = detail.data;
  const history = useQuery({
    queryKey: ["history", id],
    enabled: !!t,
    queryFn: () =>
      pages((a, b) =>
        db
          .from("task_status_history")
          .select("*")
          .eq("task_id", id!)
          .order("id", { ascending: false })
          .range(a, b),
      ),
  });
  if (detail.isPending) return <Empty>Загрузка задачи…</Empty>;
  if (detail.error)
    return <Notice error={detail.error} retry={() => detail.refetch()} />;
  if (!t) return <Unavailable />;
  const person = (uid: string) =>
    data.people.find((p) => p.id === uid)?.display_name ?? "Пользователь";
  const manager = data.me.role === "manager";
  return (
    <>
      <Back to={"/objects/" + t.object_id}>
        {data.sites.find((s) => s.id === t.object_id)?.name ?? "Объект"}
      </Back>
      <Heading
        title={t.title}
        action={manager && <Link to="edit">Редактировать</Link>}
      />
      <section className="panel pad">
        <Badge s={t.status} />
        <p className="description">{t.description || "Описание не указано"}</p>
        <dl>
          {[
            ["Исполнитель", person(t.assignee_id)],
            ["Автор", person(t.author_id)],
            ["Создана", date(t.created_at)],
          ].map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </section>
      <Workflow task={t} me={data.me} />
      <h2>История статусов</h2>
      <section className="panel">
        {history.isPending ? (
          <Empty>Загрузка истории…</Empty>
        ) : history.error ? (
          <Notice error={history.error} retry={() => history.refetch()} />
        ) : history.data.length ? (
          history.data.map((h) => (
            <article key={h.id}>
              <strong>
                {h.from_status ? labels[h.from_status] + " → " : ""}
                {labels[h.to_status]}
              </strong>
              <small>
                {person(h.actor_id)} · {date(h.changed_at)}
              </small>
              {h.comment && <p className="description">{h.comment}</p>}
            </article>
          ))
        ) : (
          <Empty>История пуста</Empty>
        )}
      </section>
      {manager && <Remove kind="tasks" id={t.id} version={t.row_version} />}
    </>
  );
}
export function Workspace({ uid }: { uid: string }) {
  const location = useLocation();
  const q = useQuery({
    queryKey: ["workspace", uid],
    queryFn: async () => {
      const [people, sites, tasks] = await Promise.all([
        pages((a, b) =>
          db.from("profiles").select("*").order("id").range(a, b),
        ),
        pages((a, b) =>
          db
            .from("construction_objects")
            .select("*")
            .order("name")
            .order("id")
            .range(a, b),
        ),
        pages((a, b) =>
          db
            .from("tasks")
            .select("*")
            .order("created_at", { ascending: false })
            .order("id")
            .range(a, b),
        ),
      ]);
      return { people, sites, tasks, me: people.find((p) => p.id === uid) };
    },
  });
  const logout = useMutation({
    mutationFn: async () => {
      const { error } = await db.auth.signOut({ scope: "local" });
      if (error) throw error;
    },
  });
  const me = q.data?.me;
  const content = () => {
    if (q.isPending) return <Empty>Загрузка рабочего пространства…</Empty>;
    if (q.error && (!q.data || isAccessError(q.error)))
      return <Notice error={q.error} retry={() => q.refetch()} />;
    if (!me || !q.data)
      return <Empty>Профиль не настроен. Обратитесь к администратору.</Empty>;
    const data = { ...q.data, me };
    return (
      <Routes>
        <Route
          path="/"
          element={
            <Navigate
              replace
              to={me.role === "executor" ? "/my-tasks" : "/objects"}
            />
          }
        />
        <Route path="/objects" element={<Sites data={data} />} />
        <Route
          path="/objects/:id"
          element={<SitePage key={location.pathname} data={data} />}
        />
        <Route
          path="/tasks/:id"
          element={<TaskPage key={location.pathname} data={data} />}
        />
        <Route
          path="/my-tasks"
          element={
            me.role === "executor" ? (
              <>
                <Heading title="Мои задачи" />
                <Tasks
                  list={data.tasks.filter((t) => t.assignee_id === uid)}
                  data={data}
                />
              </>
            ) : (
              <Unavailable />
            )
          }
        />
        {(
          [
            ["/objects/new", "site", true],
            ["/objects/:id/edit", "site", false],
            ["/objects/:siteId/tasks/new", "task", true],
            ["/tasks/:id/edit", "task", false],
          ] as const
        ).map(([path, kind, create]) => (
          <Route
            key={path}
            path={path}
            element={
              <Editor
                key={location.pathname}
                data={data}
                kind={kind}
                create={create}
              />
            }
          />
        ))}
        <Route path="*" element={<Unavailable />} />
      </Routes>
    );
  };
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <Layers3 />
          Стройбюро
        </div>
        <nav>
          <NavLink to="/objects">
            <Building2 />
            Объекты
          </NavLink>
          {me?.role === "executor" && (
            <NavLink to="/my-tasks">
              <ClipboardList />
              Мои задачи
            </NavLink>
          )}
        </nav>
        <div className="account">
          <strong>{me?.display_name}</strong>
          <small>
            {me && (me.role === "manager" ? "Постановщик" : "Исполнитель")}
          </small>
          <button onClick={() => logout.mutate()}>
            <LogOut size={16} />
            Выйти
          </button>
        </div>
      </aside>
      <main>
        {q.error && q.data && !isAccessError(q.error) && (
          <Notice error={q.error} retry={() => q.refetch()} />
        )}
        {logout.error && <Notice error={logout.error} />} {content()}
      </main>
    </div>
  );
}
