import { useEffect, useRef, useState } from "react";
import {
  addUserMemoryFacts,
  clearUserMemory,
  loadUserMemory,
  loadUserMemorySummaries,
  removeUserMemoryFact,
  updateUserMemoryFact,
  type UserMemoryFact,
  type UserMemoryStats,
  type UserMemorySummary,
} from "../memory/userMemory";
import {
  clearEpisodicMemory,
  deleteEpisode,
  loadEpisodes,
  type MemoryEpisode,
} from "../memory/episodicMemory";
import {
  loadAriInbox,
  resolveAriInboxItem,
  type AriInboxItem,
} from "../memory/ariInbox";

type MemoryPanelProps = {
  onBack: () => void;
};

const emptyStats: UserMemoryStats = {
  facts: 0,
  activeFacts: 0,
  summaries: 0,
};

export function MemoryPanel({ onBack }: MemoryPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [facts, setFacts] = useState<UserMemoryFact[]>([]);
  const [summaries, setSummaries] = useState<UserMemorySummary[]>([]);
  const [stats, setStats] = useState<UserMemoryStats>(emptyStats);
  const [newFact, setNewFact] = useState("");
  const [episodes, setEpisodes] = useState<MemoryEpisode[]>([]);
  const [inbox, setInbox] = useState<AriInboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function refresh() {
    setLoadError(null);
    try {
      const [nextFacts, nextSummaries, nextEpisodes] = await Promise.all([
        loadUserMemory(),
        loadUserMemorySummaries(),
        loadEpisodes(),
      ]);
      setFacts(nextFacts);
      setSummaries(nextSummaries);
      setStats({
        facts: nextFacts.length,
        activeFacts: nextFacts.filter(
          ({ consolidatedAt, supersededAt }) => !consolidatedAt && !supersededAt,
        ).length,
        summaries: nextSummaries.length,
      });
      setEpisodes(nextEpisodes);
      setInbox(
        loadAriInbox().filter(
          (item) => item.kind === "memory" || item.kind === "memory_conflict",
        ),
      );
    } catch (error) {
      console.error("Failed to load Ari memory", error);
      setLoadError(
        error instanceof Error
          ? error.message
          : "Не удалось загрузить память Ari.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const handleChange = () => void refresh();
    window.addEventListener("ari-memory-changed", handleChange);
    window.addEventListener("ari-episodic-memory-changed", handleChange);
    window.addEventListener("ari-memory-inbox-changed", handleChange);
    return () => {
      window.removeEventListener("ari-memory-changed", handleChange);
      window.removeEventListener("ari-episodic-memory-changed", handleChange);
      window.removeEventListener("ari-memory-inbox-changed", handleChange);
    };
  }, []);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onBack();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onBack]);

  async function addFact() {
    if (!newFact.trim()) return;
    await addUserMemoryFacts([newFact], "manual");
    setNewFact("");
  }

  async function resolveInboxItem(
    item: AriInboxItem,
    action: "keep" | "edit" | "dismiss" | "later",
  ): Promise<void> {
    if (action === "edit") {
      const edited = window.prompt("Изменить кандидат памяти:", item.body);
      if (edited === null) {
        return;
      }
      await resolveAriInboxItem(item.id, "edit", edited);
    } else {
      await resolveAriInboxItem(item.id, action);
    }
    await refresh();
  }

  if (loading) {
    return (
      <div
        className="memory-panel loading"
        role="dialog"
        aria-modal="true"
        aria-label="Память Ari"
      >
        Загрузка памяти…
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        className="memory-panel loading"
        role="dialog"
        aria-modal="true"
        aria-label="Память Ari"
      >
        <p>{loadError}</p>
        <button type="button" onClick={() => void refresh()}>
          Повторить
        </button>
        <button type="button" onClick={onBack}>
          Назад
        </button>
      </div>
    );
  }

  const memoryIsEmpty =
    facts.length === 0 &&
    summaries.length === 0 &&
    episodes.length === 0 &&
    inbox.length === 0;

  return (
    <div
      ref={panelRef}
      className="memory-panel"
      role="dialog"
      aria-modal="true"
      aria-label="Память Ari"
    >
      <div className="memory-title-row">
        <button type="button" onClick={onBack} aria-label="Назад">
          ←
        </button>
        <strong>Память Ari</strong>
      </div>

      <p className="memory-explanation">
        IndexedDB хранит оригинальные факты без автоматического удаления.
        Старые записи периодически объединяются в тематические сводки, но
        остаются в архиве. Задачи и напоминания — на панели рядом с Ari.
      </p>

      <div className="memory-stats">
        <span><strong>{stats.facts}</strong> фактов</span>
        <span><strong>{stats.activeFacts}</strong> ожидают сводки</span>
        <span><strong>{stats.summaries}</strong> сводок</span>
      </div>

      <section className="memory-subsection">
        <strong>Входящие</strong>
        {inbox.length === 0 && (
          <span className="memory-empty">
            Кандидатов памяти нет. Когда Ari не будет уверена, факт появится
            здесь перед сохранением.
          </span>
        )}
        {inbox.map((item) => (
          <div className="memory-inbox-item" key={item.id}>
            <span className="inbox-kind-badge">
              {item.kind === "memory_conflict" ? "конфликт" : "кандидат"}
            </span>
            <strong>{item.title}</strong>
            <p>{item.body}</p>
            <small>
              {Math.round(item.confidence * 100)}% · {item.reason}
              {item.status === "later" ? " · отложено" : ""}
            </small>
            {item.sourceMessage && (
              <blockquote>{item.sourceMessage}</blockquote>
            )}
            <div className="memory-inbox-actions">
              <button
                type="button"
                onClick={() => void resolveInboxItem(item, "keep")}
              >
                Запомнить
              </button>
              <button
                type="button"
                onClick={() => void resolveInboxItem(item, "edit")}
              >
                Изменить
              </button>
              <button
                type="button"
                onClick={() => void resolveInboxItem(item, "later")}
              >
                Позже
              </button>
              <button
                type="button"
                onClick={() => void resolveInboxItem(item, "dismiss")}
              >
                Отклонить
              </button>
            </div>
          </div>
        ))}
      </section>

      {memoryIsEmpty && (
        <p className="memory-empty memory-empty-hero">
          Пока тут пусто — я ещё ничего не запомнила о тебе. Напиши факт ниже
          или расскажи что-нибудь в чате, и я сохраню это сама.
        </p>
      )}

      <section className="memory-subsection">
        <strong>Факты</strong>
        <div className="memory-fact-add">
          <input
            value={newFact}
            placeholder="Добавить факт вручную"
            onChange={(event) => setNewFact(event.currentTarget.value)}
          />
          <button type="button" onClick={() => void addFact()}>
            Добавить
          </button>
        </div>
        {facts.length === 0 && (
          <span className="memory-empty">
            Фактов пока нет — добавь вручную или расскажи в чате.
          </span>
        )}
        {facts.map((fact) => (
          <div
            className={`memory-fact-item${
              fact.supersededAt || fact.consolidatedAt ? " memory-archived" : ""
            }`}
            key={fact.id}
          >
            <p>{fact.text}</p>
            <small>
              {fact.importance} · {fact.source} ·{" "}
              {Math.round(fact.confidence * 100)}%
              {fact.consolidatedAt && " · в сводке"}
              {fact.supersededAt && " · заменён"}
              {fact.lastSeenAt
                ? ` · вспоминала ${new Date(fact.lastSeenAt).toLocaleString("ru-RU")}`
                : ""}
            </small>
            <div className="memory-fact-actions">
              <button
                type="button"
                onClick={() => {
                  const edited = window.prompt("Изменить факт:", fact.text);
                  if (edited) {
                    void updateUserMemoryFact(fact.id, edited).then(refresh);
                  }
                }}
              >
                Изменить
              </button>
              <button
                type="button"
                onClick={() => void removeUserMemoryFact(fact.id).then(refresh)}
              >
                Удалить
              </button>
            </div>
          </div>
        ))}
      </section>

      <section className="memory-subsection">
        <strong>Сводки</strong>
        {summaries.length === 0 && (
          <span className="memory-empty">
            Сводок пока нет — появятся, когда накопится несколько фактов.
          </span>
        )}
        {summaries.map((summary) => (
          <div className="memory-summary-item" key={summary.id}>
            <strong>{summary.title}</strong>
            <p>{summary.text}</p>
          </div>
        ))}
      </section>

      <section className="memory-subsection">
        <strong>Эпизоды</strong>
        {episodes.length === 0 && (
          <span className="memory-empty">
            Эпизодов пока нет — я запишу важные моменты из разговоров.
          </span>
        )}
        {episodes.map((episode) => (
          <div className="memory-episode-item" key={episode.id}>
            <strong>{episode.title}</strong>
            <p>{episode.text}</p>
            <button
              type="button"
              onClick={() => void deleteEpisode(episode.id).then(refresh)}
            >
              Удалить
            </button>
          </div>
        ))}
      </section>

      <div className="memory-danger-zone">
        <button type="button" onClick={() => void clearUserMemory().then(refresh)}>
          Очистить факты и сводки
        </button>
        <button type="button" onClick={() => void clearEpisodicMemory().then(refresh)}>
          Очистить эпизоды
        </button>
      </div>
    </div>
  );
}
