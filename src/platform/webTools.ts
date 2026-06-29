import { invoke } from "@tauri-apps/api/core";

export type HttpFetchResponse = {
  status: number;
  body: string;
};

export async function httpFetch(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<HttpFetchResponse> {
  return invoke<HttpFetchResponse>("http_fetch", {
    request: {
      url,
      method: init.method ?? "GET",
      headers: init.headers ?? {},
      body: init.body,
    },
  });
}
