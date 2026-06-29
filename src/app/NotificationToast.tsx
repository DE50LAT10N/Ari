import { useEffect, useState } from "react";
import {
  ARI_NOTIFY_EVENT,
  describeNotifyKind,
  type NotifyDetail,
} from "../character/notifications";

type ToastEntry = NotifyDetail & { id: string };

const MAX_TOASTS = 3;
const TOAST_TTL_MS = 5000;

export function NotificationToast() {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  useEffect(() => {
    const timers = new Map<string, number>();

    const dismiss = (id: string) => {
      const timer = timers.get(id);
      if (timer) {
        window.clearTimeout(timer);
        timers.delete(id);
      }
      setToasts((current) => current.filter((entry) => entry.id !== id));
    };

    const onNotify = (event: Event) => {
      const detail = (event as CustomEvent<NotifyDetail>).detail;
      if (!detail?.title) return;

      const id = crypto.randomUUID();
      setToasts((current) =>
        [{ ...detail, id }, ...current].slice(0, MAX_TOASTS),
      );
      const timer = window.setTimeout(() => dismiss(id), TOAST_TTL_MS);
      timers.set(id, timer);
    };

    window.addEventListener(ARI_NOTIFY_EVENT, onNotify);
    return () => {
      window.removeEventListener(ARI_NOTIFY_EVENT, onNotify);
      for (const timer of timers.values()) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  if (!toasts.length) {
    return null;
  }

  return (
    <div className="ari-toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          className="ari-toast"
          onClick={() =>
            setToasts((current) => current.filter((entry) => entry.id !== toast.id))
          }
        >
          <span className="ari-toast-kind">{describeNotifyKind(toast.kind)}</span>
          <span className="ari-toast-title">{toast.title}</span>
        </button>
      ))}
    </div>
  );
}
