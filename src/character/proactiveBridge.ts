import type { InitiativeKind } from "./initiativeKinds";
import type { ProactivePackageOptions } from "./initiativeContext";
import type { Scenario } from "./scenarioEngine";

export type ProactiveBridgeRequest = {
  id: number;
  kind: InitiativeKind;
  eventHint: string;
  options?: ProactivePackageOptions;
  scenario?: Scenario;
};

let queue: ProactiveBridgeRequest[] = [];
const listeners = new Set<() => void>();

export function enqueueProactiveRequest(input: {
  kind: InitiativeKind;
  eventHint: string;
  options?: ProactivePackageOptions;
  scenario?: Scenario;
}): number {
  const id = Date.now();
  queue.push({
    id,
    kind: input.kind,
    eventHint: input.eventHint,
    options: input.options,
    scenario: input.scenario,
  });
  for (const listener of listeners) {
    listener();
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
}
