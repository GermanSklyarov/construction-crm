import { createClient } from "@supabase/supabase-js";
import type { Role, Status } from "./domain";
export type Profile = { id: string; display_name: string; role: Role };
export type Site = {
  row_version: string;
  id: string;
  name: string;
  address: string;
};
export type Task = {
  row_version: string;
  id: string;
  title: string;
  description: string;
  object_id: string;
  assignee_id: string;
  assignee_role: "executor";
  author_id: string;
  status: Status;
  created_at: string;
};
type History = {
  id: number;
  task_id: string;
  from_status: Status | null;
  to_status: Status;
  actor_id: string;
  changed_at: string;
  comment: string | null;
};
export type TaskFields = Pick<
  Task,
  "title" | "description" | "object_id" | "assignee_id"
>;
type Table<R, I> = { Row: R; Insert: I; Update: Partial<I>; Relationships: [] };
type Database = {
  public: {
    Tables: {
      profiles: Table<Profile, never>;
      construction_objects: Table<Site, Omit<Site, "id" | "row_version">>;
      tasks: Table<Task, TaskFields>;
      task_status_history: Table<History, never>;
    };
    Views: Record<never, never>;
    Enums: { app_role: Role; task_status: Status };
    CompositeTypes: Record<never, never>;
    Functions: {
      transition_task: {
        Args: {
          p_task_id: string;
          p_expected_status: Status;
          p_new_status: Status;
          p_comment?: string;
        };
        Returns: Task;
      };
    };
  };
};
const url = import.meta.env.VITE_SUPABASE_URL,
  key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const db = url && key ? createClient<Database>(url, key) : null!;
export async function rows<T>(
  query: PromiseLike<{ data: T | null; error: unknown }>,
) {
  const { data, error } = await query;
  if (error) throw error;
  if (data === null) throw Error("Missing result");
  return data;
}
export async function pages<T>(
  fetchPage: (
    start: number,
    end: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
) {
  const result: T[] = [];
  for (let start = 0; ; start += 500) {
    const page = await rows(fetchPage(start, start + 499));
    result.push(...page);
    if (page.length < 500) return result;
  }
}
