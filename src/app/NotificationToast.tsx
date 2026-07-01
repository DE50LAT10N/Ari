import { useCallback, useEffect, useRef, useState } from "react";
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
  const timersRef = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((current) => current.filter((entry) => entry.id !== id));
  }, []);

  useEffect(() => {
    const onNotify = (event: Event) => {
      const detail = (event as CustomEvent<NotifyDetail>).detail;
      if (!detail?.title) return;

      const id = crypto.randomUUID();
      setToasts((current) => {
        const next = [{ ...detail, id }, ...current].slice(0, MAX_TOASTS);
        const nextIds = new Set(next.map((entry) => entry.id));
        for (const entry of current) {
          if (!nextIds.has(entry.id)) {
            const timer = timersRef.current.get(entry.id);
            if (timer) {
              window.clearTimeout(timer);
              timersRef.current.delete(entry.id);
            }
          }
        }
        return next;
      });
      const timer = window.setTimeout(() => dismiss(id), TOAST_TTL_MS);
      timersRef.current.set(id, timer);
    };

    window.addEventListener(ARI_NOTIFY_EVENT, onNotify);
    return () => {
      window.removeEventListener(ARI_NOTIFY_EVENT, onNotify);
      for (const timer of timersRef.current.values()) {
        window.clearTimeout(timer);
      }
      timersRef.current.clear();
    };
  }, [dismiss]);

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
          onClick={() => dismiss(toast.id)}
        >
          <span className="ari-toast-kind">{describeNotifyKind(toast.kind)}</span>
          <span className="ari-toast-title">{toast.title}</span>
        </button>
      ))}
    </div>
  );
}
