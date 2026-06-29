export type NotifyKind =
  | "task"
  | "task_proposed"
  | "focus_task"
  | "open_thread"
  | "backlog_task"
  | "inbox";

export type NotifyDetail = {
  kind: NotifyKind;
  title: string;
};

export const ARI_NOTIFY_EVENT = "ari-notify";

export function notifyNew(kind: NotifyKind, title: string): void {
  const trimmed = title.trim().slice(0, 160);
  if (!trimmed) return;
  window.dispatchEvent(
    new CustomEvent<NotifyDetail>(ARI_NOTIFY_EVENT, {
      detail: { kind, title: trimmed },
    }),
  );
}

export function describeNotifyKind(kind: NotifyKind): string {
  return {
    task: "Задача",
    task_proposed: "Ari предлагает",
    focus_task: "Задача фокуса",
    open_thread: "Новая нить",
    backlog_task: "Новая задача",
    inbox: "Ari предлагает",
  }[kind];
}
