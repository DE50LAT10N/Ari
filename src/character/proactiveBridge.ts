import type { InitiativeKind } from "./initiativeKinds";
import type { ProactivePackageOptions } from "./initiativeContext";
import type { Scenario } from "./scenarioEngine";

export type ProactiveBridgeRequest = {
  id: number;
  kind: InitiativeKind;
  eventHint: string;
  options?: ProactivePackageOptions;
  scenario?: Scenario;
  lab?: boolean;
};

let queue: ProactiveBridgeRequest[] = [];
const listeners = new Set<() => void>();
const MAX_QUEUE_SIZE = 32;
let lastRequestId = 0;

function nextRequestId(): number {
  lastRequestId = Math.max(Date.now(), lastRequestId + 1);
  return lastRequestId;
}

function isDuplicateRequest(
  request: ProactiveBridgeRequest,
  input: {
    kind: InitiativeKind;
    eventHint: string;
    options?: ProactivePackageOptions;
    scenario?: Scenario;
    lab?: boolean;
  },
): boolean {
  return (
    request.kind === input.kind &&
    request.eventHint.trim() === input.eventHint.trim() &&
    request.scenario === input.scenario &&
    JSON.stringify(request.options ?? null) ===
      JSON.stringify(input.options ?? null) &&
    Boolean(request.lab) === Boolean(input.lab)
  );
}

export function enqueueProactiveRequest(input: {
  kind: InitiativeKind;
  eventHint: string;
  options?: ProactivePackageOptions;
  scenario?: Scenario;
  lab?: boolean;
}): number {
  const duplicate = queue.find((request) => isDuplicateRequest(request, input));
  if (duplicate) {
    return duplicate.id;
  }

  const id = nextRequestId();
  queue.push({
    id,
    kind: input.kind,
    eventHint: input.eventHint,
    options: input.options,
    scenario: input.scenario,
    lab: input.lab,
  });
  if (queue.length > MAX_QUEUE_SIZE) {
    queue.splice(0, queue.length - MAX_QUEUE_SIZE);
  }
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      console.warn("Proactive bridge listener failed", error);
    }
  }
  return id;
}

export function drainProactiveRequests(): ProactiveBridgeRequest[] {
  const items = [...queue];
  queue = [];
  return items;
}

export function subscribeProactiveRequests(handler: () => void): () => void {
  listeners.add(handler);
  return () => {
    listeners.delete(handler);
  };
}

export function resetProactiveBridgeForTests(): void {
  queue = [];
  listeners.clear();
  lastRequestId = 0;
}
