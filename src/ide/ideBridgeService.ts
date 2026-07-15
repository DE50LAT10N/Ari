import type { IdeServerMessage } from "./protocol";
import { IdeBridgeStore } from "./ideBridgeStore";

export type IdeBridgeMessageHandler = (message: unknown) => void;

export interface IdeBridgeTransport {
  start(handler: IdeBridgeMessageHandler): void;
  send(message: IdeServerMessage): void;
  stop(): void;
}

export class IdeBridgeService {
  private processing = Promise.resolve();
  private started = false;

  constructor(
    private readonly store: IdeBridgeStore,
    private readonly transport: IdeBridgeTransport,
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.transport.start((message) => {
      this.processing = this.processing
        .then(async () => {
          const response = await this.store.accept(message);
          this.transport.send(response);
        })
        .catch(() => {
          // Store errors are converted to protocol errors. This catch keeps the
          // transport alive if a host adapter itself throws unexpectedly.
        });
    });
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.transport.stop();
  }

  async idle(): Promise<void> {
    await this.processing;
  }
}

export class InMemoryIdeBridgeTransport implements IdeBridgeTransport {
  readonly sent: IdeServerMessage[] = [];
  private handler?: IdeBridgeMessageHandler;

  start(handler: IdeBridgeMessageHandler): void {
    this.handler = handler;
  }

  send(message: IdeServerMessage): void {
    this.sent.push(structuredClone(message));
  }

  stop(): void {
    this.handler = undefined;
  }

  deliver(message: unknown): void {
    if (!this.handler) throw new Error("IDE bridge transport is not started");
    this.handler(structuredClone(message));
  }
}

