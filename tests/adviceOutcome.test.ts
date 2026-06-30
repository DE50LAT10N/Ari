import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRecentAdviceOutcomes,
  reconcilePendingAdviceOutcomes,
  recordAdviceFeedbackOutcome,
  resetAdviceOutcomesForTests,
  startAdviceOutcomeObservation,
  type AdviceObservedState,
} from "../src/character/adviceOutcome";
import type { AdviceLedgerEntry } from "../src/character/adviceLedger";

function setupStorage(): void {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
  });
}

function observedState(
  input: Partial<AdviceObservedState> = {},
): AdviceObservedState {
  return {
    at: 1_000,
    topicKey: "chatpanel::cursor",
    editorFile: "ChatPanel.tsx",
    factIds: ["file:ChatPanel.tsx", "clip:stacktrace"],
    factSummary: "ChatPanel.tsx | ReferenceError",
    hasErrorSignal: true,
    stuckScore: 0.5,
    openTaskCount: 2,
    breakDue: false,
    ...input,
  };
}

describe("adviceOutcome", () => {
  beforeEach(() => {
    setupStorage();
    resetAdviceOutcomesForTests();
  });

  it("turns explicit useful feedback into a helped outcome", () => {
    const entry: AdviceLedgerEntry = {
      id: "advice-1",
      at: 1_000,
      updatedAt: 1_000,
      expiresAt: 100_000,
      topicKey: "chatpanel::cursor",
      adviceCandidateKind: "debug_next_step",
      practicalHook: "Проверь импорт в ChatPanel.tsx.",
    };

    const outcome = recordAdviceFeedbackOutcome(entry, "useful", 2_000);

    expect(outcome.outcome).toBe("helped");
    expect(outcome.confidence).toBeGreaterThan(0.9);
    expect(getRecentAdviceOutcomes("chatpanel::cursor", 3_000)[0]?.outcome)
      .toBe("helped");
  });

  it("infers resolved when an error signal disappears after advice", () => {
    startAdviceOutcomeObservation({
      adviceId: "advice-2",
      topicKey: "chatpanel::cursor",
      candidateKind: "debug_next_step",
      beforeState: observedState(),
      now: 1_000,
    });

    const { records: outcomes } = reconcilePendingAdviceOutcomes({
      afterState: observedState({
        at: 7 * 60_000,
        factIds: ["file:ChatPanel.tsx"],
        factSummary: "ChatPanel.tsx",
        hasErrorSignal: false,
        stuckScore: 0.15,
      }),
      now: 7 * 60_000,
    });

    expect(outcomes[0]?.outcome).toBe("resolved");
    expect(outcomes[0]?.reason).toMatch(/исчез/i);
  });

  it("does not infer an outcome before the observation window matures", () => {
    startAdviceOutcomeObservation({
      adviceId: "advice-3",
      topicKey: "chatpanel::cursor",
      candidateKind: "task_bridge",
      beforeState: observedState({ hasErrorSignal: false, stuckScore: 0.1 }),
      now: 1_000,
    });

    const { records: outcomes } = reconcilePendingAdviceOutcomes({
      afterState: observedState({
        at: 2 * 60_000,
        hasErrorSignal: false,
        stuckScore: 0.1,
      }),
      now: 2 * 60_000,
    });

    expect(outcomes).toEqual([]);
  });

  it("dispatches ignored event when passive advice expires without follow-up", () => {
    const dispatch = vi.fn();
    vi.stubGlobal("window", {
      dispatchEvent: dispatch,
      addEventListener: vi.fn(),
    });

    startAdviceOutcomeObservation({
      adviceId: "advice-4",
      topicKey: "chatpanel::cursor",
      candidateKind: "debug_next_step",
      beforeState: observedState(),
      now: 1_000,
    });

    const { newlyIgnored } = reconcilePendingAdviceOutcomes({
      afterState: observedState({
        at: 50 * 60_000,
        topicKey: "other::topic",
        editorFile: "Other.tsx",
        factIds: ["file:Other.tsx"],
        factSummary: "Other.tsx",
        hasErrorSignal: true,
        stuckScore: 0.5,
      }),
      now: 50 * 60_000,
    });

    expect(newlyIgnored).toBe(1);
    expect(dispatch).toHaveBeenCalled();
  });
});
