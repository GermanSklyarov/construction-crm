export type Role = "manager" | "executor";
export type Status =
  "new" | "in_progress" | "in_review" | "needs_revision" | "accepted";
export const labels: Record<Status, string> = {
  new: "Новая",
  in_progress: "В работе",
  in_review: "На проверке",
  needs_revision: "На доработке",
  accepted: "Принята",
};
export function actions(
  role: Role,
  status: Status,
  assigned: boolean,
): Status[] {
  if (role === "manager")
    return status === "in_review" ? ["accepted", "needs_revision"] : [];
  if (!assigned) return [];
  if (status === "new" || status === "needs_revision") return ["in_progress"];
  return status === "in_progress" ? ["in_review"] : [];
}
export function isAccessError(error: unknown) {
  const code =
    typeof error === "object" && error && "code" in error ? error.code : "";
  return [
    "42501",
    "PGRST301",
    "PGRST302",
    "PGRST303",
    "refresh_token_not_found",
  ].includes(String(code));
}
export function message(error: unknown) {
  const code =
    typeof error === "object" && error && "code" in error ? error.code : "";
  switch (code) {
    case "40001":
      return "Статус уже изменился. Проверьте обновлённую карточку.";
    case "23503":
      return "Операция невозможна из-за связанных записей. Проверьте объект и исполнителя.";
    case "42501":
    case "PGRST116":
      return "Запись изменилась, удалена или больше вам недоступна.";
    case "23514":
      return "Проверьте поля и комментарий к доработке.";
    case "invalid_credentials":
      return "Неверный email или пароль.";
    case "PGRST301":
    case "refresh_token_not_found":
      return "Сессия истекла. Войдите повторно.";
    default:
      return "Не удалось выполнить запрос. Проверьте соединение и повторите попытку.";
  }
}
