import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  Channel: class<T> {
    onmessage?: (message: T) => void;
  },
}));

import {
  gigaChatFetch,
  gigaChatStream,
} from "../src/platform/gigaChatHttp";

describe("gigaChatHttp", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("propagates AbortSignal to the native cancellation command", async () => {
    let finishRequest: (value: { status: number; body: string }) => void =
      () => undefined;
    invokeMock.mockImplementation((command: string) => {
      if (command === "gigachat_cancel_request") {
        return Promise.resolve(true);
      }
      return new Promise((resolve) => {
        finishRequest = resolve;
      });
    });
    const controller = new AbortController();
    const result = gigaChatFetch("https://gigachat.devices.sberbank.ru/api/v1/models", {
      signal: controller.signal,
    });

    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "gigachat_http_request",
        expect.objectContaining({
          request: expect.objectContaining({ requestId: expect.any(String) }),
        }),
      );
    });
    const requestId = invokeMock.mock.calls[0]?.[1]?.request?.requestId;
    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(invokeMock).toHaveBeenCalledWith("gigachat_cancel_request", {
      requestId,
    });
    finishRequest({ status: 200, body: "{}" });
  });

  it("does not allocate a cancellation id without a signal", async () => {
    invokeMock.mockResolvedValue({ status: 200, body: "{}" });

    const response = await gigaChatFetch(
      "https://gigachat.devices.sberbank.ru/api/v1/models",
    );

    expect(response.status).toBe(200);
    expect(invokeMock).toHaveBeenCalledWith("gigachat_http_request", {
      request: expect.objectContaining({ requestId: undefined }),
    });
  });

  it("delivers native channel chunks incrementally", async () => {
    invokeMock.mockImplementation((command: string, args: Record<string, any>) => {
      if (command !== "gigachat_stream_request") {
        return Promise.reject(new Error(`Unexpected command: ${command}`));
      }
      args.onEvent.onmessage?.({ kind: "head", status: 200 });
      args.onEvent.onmessage?.({ kind: "chunk", dataBase64: btoa("data: ping\n\n") });
      args.onEvent.onmessage?.({ kind: "done", status: 200 });
      return Promise.resolve(200);
    });
    const chunks: string[] = [];

    const status = await gigaChatStream(
      "https://gigachat.devices.sberbank.ru/api/v1/chat/completions",
      { method: "POST", body: "{}", signal: new AbortController().signal },
      (chunk) => chunks.push(new TextDecoder().decode(chunk)),
    );

    expect(status).toBe(200);
    expect(chunks).toEqual(["data: ping\n\n"]);
    expect(invokeMock).toHaveBeenCalledWith(
      "gigachat_stream_request",
      expect.objectContaining({ onEvent: expect.anything() }),
    );
  });
});
