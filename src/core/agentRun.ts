export type AgentRunKind = "reply" | "proactive" | "mentor";

export type AgentRunPhase =
  | "created"
  | "context"
  | "generating"
  | "validating"
  | "postprocess"
  | "completed"
  | "cancelled"
  | "failed";

const TERMINAL_PHASES = new Set<AgentRunPhase>([
  "completed",
  "cancelled",
  "failed",
]);

export class AgentRunCancelledError extends DOMException {
  readonly runId: string;

  constructor(runId: string, reason = "Agent run cancelled") {
    super(reason, "AbortError");
    this.runId = runId;
  }
}

export class AgentRunScope {
  readonly id: string;
  readonly kind: AgentRunKind;
  readonly createdAt: number;
  readonly controller: AbortController;
  private currentPhase: AgentRunPhase = "created";
  private cancelReason?: string;

  constructor(kind: AgentRunKind, id = crypto.randomUUID()) {
    this.id = id;
    this.kind = kind;
    this.createdAt = Date.now();
    this.controller = new AbortController();
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get phase(): AgentRunPhase {
    return this.currentPhase;
  }

  get active(): boolean {
    return !this.signal.aborted && !TERMINAL_PHASES.has(this.currentPhase);
  }

  transition(phase: AgentRunPhase): void {
    if (TERMINAL_PHASES.has(this.currentPhase)) {
      return;
    }
    this.currentPhase = phase;
  }

  cancel(reason = "Cancelled"): void {
    if (!this.active) {
      return;
    }
    this.cancelReason = reason;
    this.currentPhase = "cancelled";
    this.controller.abort(reason);
  }

  throwIfInactive(): void {
    if (!this.active) {
      throw new AgentRunCancelledError(
        this.id,
        this.cancelReason ?? "Agent run is no longer active",
      );
    }
  }
}

/** Owns at most one active run and rejects stale async continuations. */
export class AgentRunCoordinator {
  private currentRun: AgentRunScope | null = null;

  start(kind: AgentRunKind): AgentRunScope {
    this.currentRun?.cancel("Superseded by a newer run");
    const run = new AgentRunScope(kind);
    this.currentRun = run;
    return run;
  }

  get current(): AgentRunScope | null {
    return this.currentRun;
  }

  isCurrent(runId: string): boolean {
    return this.currentRun?.id === runId;
  }

  assertCurrent(runId: string): AgentRunScope {
    const run = this.currentRun;
    if (!run || run.id !== runId || !run.active) {
      throw new AgentRunCancelledError(runId, "Stale agent run");
    }
    return run;
  }

  cancelCurrent(reason = "Cancelled by user"): void {
    this.currentRun?.cancel(reason);
  }

  finish(runId: string, phase: "completed" | "failed" | "cancelled"): void {
    if (!this.isCurrent(runId)) {
      return;
    }
    this.currentRun?.transition(phase);
    this.currentRun = null;
  }
}
