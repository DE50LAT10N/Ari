import { useState } from "react";

import type { AppSettings } from "../settings/appSettings";

import { enqueueProactiveRequest } from "../character/proactiveBridge";

import {

  runProactiveLabPreview,

  runProactiveReplyQualityCheck,

  type ProactiveLabPreview,

} from "../character/proactiveLab";

import type { ProactiveReplyQualityResult } from "../character/proactiveLlmEngine";

import type { ProactiveReplyTone } from "../character/proactiveTone";

import { checkOllamaStatus } from "../llm/localLlmClient";



type ProactiveLabSectionProps = {

  settings: AppSettings;

};



export function ProactiveLabSection({ settings }: ProactiveLabSectionProps) {

  const [tone, setTone] = useState<ProactiveReplyTone>("advice");

  const [recentUserMessage, setRecentUserMessage] = useState(

    "почему падает сборка?",

  );

  const [mockRagSnippet, setMockRagSnippet] = useState(

    "Amdahl's law: speedup is limited by the serial portion of the workload.",

  );

  const [draftReply, setDraftReply] = useState("");

  const [preview, setPreview] = useState<ProactiveLabPreview | null>(null);

  const [quality, setQuality] = useState<ProactiveReplyQualityResult | null>(

    null,

  );

  const [busy, setBusy] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const [fireNote, setFireNote] = useState<string | null>(null);



  async function resolveOllamaOnline(): Promise<boolean | null> {

    if (settings.llmProvider === "gigachat") {

      return null;

    }

    try {

      const status = await checkOllamaStatus(settings.ollamaBaseUrl);

      return status.online;

    } catch {

      return false;

    }

  }



  async function handlePreview() {

    setBusy(true);

    setError(null);

    setQuality(null);

    setFireNote(null);

    try {

      const ollamaOnline = await resolveOllamaOnline();

      const rag = mockRagSnippet.trim();

      const result = await runProactiveLabPreview(

        settings,

        {

          tone,

          recentUserMessage: recentUserMessage.trim() || undefined,

          mockRagSnippets: rag ? [rag] : undefined,

        },

        ollamaOnline,

      );

      setPreview(result);

    } catch (previewError) {

      setError(

        previewError instanceof Error

          ? previewError.message

          : "Не удалось собрать preview",

      );

    } finally {

      setBusy(false);

    }

  }



  async function handleQualityCheck() {

    if (!preview?.llmBundle) {

      setError("Сначала собери preview synthesis.");

      return;

    }

    if (!draftReply.trim()) {

      setError("Введи черновик реплики для проверки.");

      return;

    }

    setBusy(true);

    setError(null);

    try {

      const result = await runProactiveReplyQualityCheck(

        settings,

        preview.llmBundle,

        draftReply,

        preview.facts,

      );

      setQuality(result);

    } catch (qualityError) {

      setError(

        qualityError instanceof Error

          ? qualityError.message

          : "Проверка качества не удалась",

      );

    } finally {

      setBusy(false);

    }

  }



  function handleFireTest() {

    if (!preview?.package) {

      setError("Сначала собери preview package.");

      return;

    }

    enqueueProactiveRequest({

      kind: preview.package.initiativeKind,

      eventHint: preview.package.eventDescription.slice(0, 200),

      options: {

        llmBundle: preview.llmBundle,

        recentUserMessage: recentUserMessage.trim() || undefined,

        conversationTopics: preview.llmBundle.linkedThemes,

      },

      lab: true,

    });

    setFireNote("Тестовая инициатива поставлена в очередь (lab).");

    setError(null);

  }



  return (

    <div className="ari-diagnostics-section">

      <div className="settings-note">

        Preview и тестовый fire проактивности без regex-эвристик. Использует

        текущие сигналы активности и LLM synthesis.

      </div>



      <label className="settings-field">

        <span>Режим</span>

        <select

            value={tone}

            onChange={(event) =>

              setTone(event.target.value as ProactiveReplyTone)

            }

          >

            <option value="advice">advice</option>

            <option value="smalltalk">smalltalk</option>

          </select>

      </label>



      <label className="settings-field">

        <span>Mock: последний вопрос пользователя</span>

        <input

            type="text"

            value={recentUserMessage}

            onChange={(event) => setRecentUserMessage(event.target.value)}

            placeholder="почему падает сборка?"

        />

      </label>



      <label className="settings-field">

        <span>Mock: RAG snippet (optional, для context_fact)</span>

        <input

            type="text"

            value={mockRagSnippet}

            onChange={(event) => setMockRagSnippet(event.target.value)}

            placeholder="Amdahl's law: …"

        />

      </label>



      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>

        <button

          type="button"

          className="settings-action-button"

          disabled={busy}

          onClick={() => void handlePreview()}

        >

          Preview synthesis + package

        </button>

        <button

          type="button"

          className="settings-action-button"

          disabled={busy || !preview}

          onClick={handleFireTest}

        >

          Отправить тест

        </button>

      </div>



      {error && <p className="settings-note">{error}</p>}

      {fireNote && <p className="settings-note">{fireNote}</p>}



      {preview && (

        <>

          <p className="settings-note">

            score {preview.usefulnessScore.toFixed(2)} · tone {preview.llmBundle.tone} · shouldSend{" "}

            {preview.shouldSend ? "да" : "нет"}

            {preview.rejectReason ? ` · ${preview.rejectReason}` : ""}

            {preview.llmBundle.initiativeMove

              ? ` · move ${preview.llmBundle.initiativeMove}`

              : ""}

          </p>

          <pre className="ari-lab-json">

            {JSON.stringify(

              {

                initiativeMove: preview.llmBundle.initiativeMove,

                groundFactIds: preview.llmBundle.groundFactIds,

                primaryChainSummary: preview.llmBundle.primaryChainSummary,

                topicLinks: preview.topicLinks,

                linkedThemes: preview.llmBundle.linkedThemes,

                adviceSteps: preview.llmBundle.adviceSteps,

                practicalHook: preview.llmBundle.practicalHook,

                narrativeBrief: preview.llmBundle.narrativeBrief,

              },

              null,

              2,

            )}

          </pre>

          <details>

            <summary>Move hints (playbook)</summary>

            <pre className="ari-lab-json">

              {JSON.stringify(preview.moveHints, null, 2)}

            </pre>

          </details>

          <details>

            <summary>Link graph (fact → fact)</summary>

            <pre className="ari-lab-json">

              {JSON.stringify(preview.topicLinks, null, 2)}

            </pre>

          </details>

          <details>

            <summary>Facts JSON</summary>

            <pre className="ari-lab-json">

              {JSON.stringify(preview.facts, null, 2)}

            </pre>

          </details>

          <details>

            <summary>Event description (package)</summary>

            <pre className="ari-lab-json">{preview.package.eventDescription}</pre>

          </details>

          <details>

            <summary>Gate context</summary>

            <pre className="ari-lab-json">{preview.gateContext}</pre>

          </details>

        </>

      )}



      <label className="settings-field">

        <span>Черновик реплики (quality check)</span>

        <textarea

            rows={4}

            value={draftReply}

            onChange={(event) => setDraftReply(event.target.value)}

            placeholder="Реплика Ari для проверки…"

        />

      </label>

      <button

        type="button"

        className="settings-action-button"

        disabled={busy || !preview}

        onClick={() => void handleQualityCheck()}

      >

        Check reply quality

      </button>

      {quality && (

        <pre className="ari-lab-json">

          {JSON.stringify(quality, null, 2)}

        </pre>

      )}

    </div>

  );

}

