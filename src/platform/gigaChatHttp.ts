import { invoke } from "@tauri-apps/api/core";

type GigaChatHttpResponse = {
  status: number;
  body: string;
};

export async function gigaChatFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
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
    const fileBase64 = bytesToBase64(new Uint8Array(buffer));
    const fileName =
      file instanceof File && file.name ? file.name : "ari-capture.png";

    const result = await invoke<GigaChatHttpResponse>("gigachat_upload_file", {
      request: {
        url,
        authorization,
        fileName,
        fileBase64,
        purpose,
      },
    });

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

  const result = await invoke<GigaChatHttpResponse>("gigachat_http_request", {
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
    },
  });

  return new Response(result.body, {
    status: result.status,
    headers: { "Content-Type": "application/json" },
  });
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
