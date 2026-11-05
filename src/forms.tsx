import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Profile, Site, Task, TaskFields } from "./db";
import { Button } from "./ui/button";
const required = z.string().trim().min(1, "Заполните поле");
const siteSchema = z.object({ name: required, address: required });
const taskSchema = z.object({
  title: required,
  description: z.string(),
  object_id: required,
  assignee_id: required,
});
export function SiteForm({
  site,
  save,
}: {
  site?: Site;
  save: (v: Omit<Site, "id" | "row_version">) => Promise<void>;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(siteSchema),
    defaultValues: { name: site?.name ?? "", address: site?.address ?? "" },
  });
  return (
    <form onSubmit={handleSubmit(save)}>
      <label>
        Название
        <input {...register("name")} />
        {errors.name?.message}
      </label>
      <label>
        Адрес
        <input {...register("address")} />
        {errors.address?.message}
      </label>
      <Button disabled={isSubmitting}>Сохранить объект</Button>
    </form>
  );
}
export function TaskForm({
  task,
  siteId,
  sites,
  people,
  save,
}: {
  task?: Task;
  siteId: string;
  sites: Site[];
  people: Profile[];
  save: (v: TaskFields) => Promise<void>;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(taskSchema),
    defaultValues: {
      title: task?.title ?? "",
      description: task?.description ?? "",
      object_id: task?.object_id ?? siteId,
      assignee_id: task?.assignee_id ?? "",
    },
  });
  return (
    <form onSubmit={handleSubmit(save)}>
      <label>
        Название
        <input {...register("title")} />
        {errors.title?.message}
      </label>
      <label>
        Описание
        <textarea {...register("description")} />
      </label>
      <label>
        Объект
        <select {...register("object_id")}>
          <option value="">Выберите объект</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {errors.object_id?.message}
      </label>
      <label>
        Исполнитель
        <select {...register("assignee_id")}>
          <option value="">Выберите исполнителя</option>
          {people
            .filter((p) => p.role === "executor")
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name}
              </option>
            ))}
        </select>
        {errors.assignee_id?.message}
      </label>
      <Button disabled={isSubmitting}>Сохранить задачу</Button>
    </form>
  );
}
