import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Layers3, ArrowRight } from "lucide-react";
import { db } from "./db";
import { Button } from "./ui/button";
import { Notice, Workspace } from "./workspace";
import "./style.css";
const schema = z.object({
  email: z.email("Введите корректный email").trim(),
  password: z.string().min(1, "Введите пароль"),
});
function Login() {
  const [error, setError] = useState<unknown>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema) });
  return (
    <div className="login">
      <section className="blueprint">
        <div className="brand">
          <Layers3 />
          Стройбюро
        </div>
        <h1>
          Объекты
          <br />и задачи<span>.</span>
        </h1>
        <svg
          aria-hidden="true"
          viewBox="0 0 480 260"
          fill="none"
          stroke="currentColor"
        >
          <g strokeWidth="1.5">
            <path d="M50 172 218 88 416 166 247 250Z M50 172V88L218 5 416 83v83 M50 88l197 79 169-84 M247 167v83 M218 5v83 M94 66v83l193 80 M137 45v84l193 80 M178 25v83l194 80 M100 108l166-83 M150 128l166-83 M199 148l166-83 M50 132l197 78 169-83" />
          </g>
        </svg>
      </section>
      <section className="loginform">
        <h1>Вход</h1>
        <p>Рабочее пространство строительной компании</p>
        <form
          onSubmit={handleSubmit(async (v) => {
            setError(null);
            try {
              const { error } = await db.auth.signInWithPassword(v);
              if (error) throw error;
            } catch (e) {
              setError(e);
            }
          })}
        >
          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              placeholder="name@company.ru"
              {...register("email")}
            />
            {errors.email?.message}
          </label>
          <label>
            Пароль
            <input
              type="password"
              autoComplete="current-password"
              {...register("password")}
            />
            {errors.password?.message}
          </label>
          {!!error && <Notice error={error} />}
          <Button disabled={isSubmitting}>
            {isSubmitting ? "Входим…" : "Войти"}
            <ArrowRight size={17} />
          </Button>
        </form>
      </section>
    </div>
  );
}
function SessionWorkspace({ uid }: { uid: string }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }),
  );
  useEffect(() => () => client.clear(), [client]);
  return (
    <QueryClientProvider client={client}>
      <Workspace uid={uid} />
    </QueryClientProvider>
  );
}
function App() {
  const [uid, setUid] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!db) return;
    const { data } = db.auth.onAuthStateChange((_event, session) =>
      setUid(session?.user.id ?? null),
    );
    return () => data.subscription.unsubscribe();
  }, []);
  if (!db)
    return (
      <main>
        <h1>Подключение к Supabase</h1>
        <p>
          Укажите URL и публичный ключ в .env.local и перезапустите приложение.
        </p>
      </main>
    );
  if (uid === undefined) return <main>Загрузка сессии…</main>;
  return uid ? <SessionWorkspace key={uid} uid={uid} /> : <Login />;
}
createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
