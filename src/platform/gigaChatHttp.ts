import { Channel, invoke } from "@tauri-apps/api/core";

type GigaChatHttpResponse = {
  status: number;
  body: string;
};

type GigaChatStreamEvent = {
  kind: "head" | "chunk" | "done";
  status?: number;
  dataBase64?: string;
};

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Запрос GigaChat отменён.", "AbortError");
}

function throwIfAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) {
    throw abortError(signal);
  }
}

async function invokeWithCancellation<T>(
  command: string,
  args: Record<string, unknown>,
  signal?: AbortSignal | null,
  requestId?: string,
): Promise<T> {
  if (!signal || !requestId) {
    return invoke<T>(command, args);
  }
  throwIfAborted(signal);

  let removeAbortListener: () => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => {
    const onAbort = () => {
      void invoke("gigachat_cancel_request", { requestId }).catch(
        () => undefined,
      );
      reject(abortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", onAbort);
  });
  try {
    return await Promise.race([invoke<T>(command, args), aborted]);
  } catch (error) {
    if (signal.aborted) {
      throw abortError(signal);
    }
    throw error;
  } finally {
    removeAbortListener();
  }
}

export async function gigaChatFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const requestId = init.signal ? crypto.randomUUID() : undefined;
  throwIfAborted(init.signal);
  if (init.body instanceof FormData) {
    const file = init.body.get("file");
    const purpose =
      typeof init.body.get("purpose") === "string"
        ? String(init.body.get("purpose"))
        : "general";
    if (!(file instanceof Blob)) {
      throw new Error("GigaChat upload: отсутствует файл в FormData.");
    }

    const authorization = extractAuthorization(init.headers);
    const buffer = await file.arrayBuffer();
    throwIfAborted(init.signal);
    const fileBase64 = bytesToBase64(new Uint8Array(buffer));
    const fileName =
      file instanceof File && file.name ? file.name : "ari-capture.png";

    const result = await invokeWithCancellation<GigaChatHttpResponse>(
      "gigachat_upload_file",
      {
        request: {
          url,
          authorization,
          fileName,
          fileBase64,
          purpose,
          requestId,
        },
      },
      init.signal,
      requestId,
    );

    return new Response(result.body, {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  const headers: Record<string, string> = {};
  const source = init.headers;
  if (source instanceof Headers) {
    source.forEach((value, key) => {
      headers[key] = value;
    });
  } else if (Array.isArray(source)) {
    for (const [key, value] of source) {
      headers[key] = value;
    }
  } else if (source) {
    Object.assign(headers, source);
  }

  const result = await invokeWithCancellation<GigaChatHttpResponse>(
    "gigachat_http_request",
    {
      request: {
        url,
        method: init.method ?? "GET",
        headers,
        body:
          typeof init.body === "string"
            ? init.body
            : init.body
              ? String(init.body)
              : undefined,
        requestId,
      },
    },
    init.signal,
    requestId,
  );

  return new Response(result.body, {
    status: result.status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function gigaChatStream(
  url: string,
  init: RequestInit,
  onChunk: (chunk: Uint8Array) => void,
): Promise<number> {
  const requestId = crypto.randomUUID();
  throwIfAborted(init.signal);
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((value, key) => {
    headers[key] = value;
  });
  const events = new Channel<GigaChatStreamEvent>();
  let streamedStatus = 0;
  events.onmessage = (event) => {
    if (event.kind === "head" && typeof event.status === "number") {
      streamedStatus = event.status;
      return;
    }
    if (event.kind === "chunk" && event.dataBase64) {
      onChunk(base64ToBytes(event.dataBase64));
    }
  };

  const status = await invokeWithCancellation<number>(
    "gigachat_stream_request",
    {
      request: {
        url,
        method: init.method ?? "POST",
        headers,
        body:
          typeof init.body === "string"
            ? init.body
            : init.body
              ? String(init.body)
              : undefined,
        requestId,
      },
      onEvent: events,
    },
    init.signal,
    requestId,
  );
  return streamedStatus || status;
}

function extractAuthorization(headers?: HeadersInit): string {
  if (!headers) {
    throw new Error("GigaChat upload: отсутствует Authorization.");
  }
  if (headers instanceof Headers) {
    const value = headers.get("Authorization");
    if (!value) {
      throw new Error("GigaChat upload: отсутствует Authorization.");
    }
    return value;
  }
  if (Array.isArray(headers)) {
    const match = headers.find(([key]) => key.toLowerCase() === "authorization");
    if (!match?.[1]) {
      throw new Error("GigaChat upload: отсутствует Authorization.");
    }
    return match[1];
  }
  const value = headers.Authorization ?? headers.authorization;
  if (!value) {
    throw new Error("GigaChat upload: отсутствует Authorization.");
  }
  return value;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
