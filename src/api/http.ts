/**
 * The request layer for both of Settle Up's services: Google Identity Toolkit
 * (auth) and the Firebase Realtime Database (data).
 *
 * Two things are worth knowing. Firebase RTDB returns HTTP 200 with a JSON
 * `null` body for "no data" — an empty group is indistinguishable from a
 * missing one at the transport level, so callers treat `null` as empty. And
 * both services answer errors as `{ "error": … }` with a non-2xx status, which
 * `request` turns into a thrown `SettleUpError` carrying the status.
 */

import { type SettleUpEnv, SettleUpError } from "../core/types.js";

/** The Firebase web config for each project, as embedded in the Settle Up web app. */
export const FIREBASE: Record<SettleUpEnv, { apiKey: string; databaseURL: string }> = {
  live: {
    apiKey: "AIzaSyDbf9JS-Mrtbcd25Hff4Pj0yTsg844JovE",
    databaseURL: "https://settle-up-live.firebaseio.com",
  },
  sandbox: {
    apiKey: "AIzaSyCBsW4lveImpcB92c-cnNg2VQgx9JdijU8",
    databaseURL: "https://settle-up-sandbox.firebaseio.com",
  },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const NETWORK_CODES = ["ECONNRESET", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN"];

function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const code = String((err as { code?: string })?.code ?? "");
  const causeCode = String((err as { cause?: { code?: string } })?.cause?.code ?? "");
  return NETWORK_CODES.includes(code) || NETWORK_CODES.includes(causeCode);
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  form?: Record<string, string>;
  attempts?: number;
  timeoutMs?: number;
}

/**
 * Send a request and decode the JSON body.
 *
 * Retries 429 and 5xx and thrown network errors with a backoff. A Firebase
 * error body is `{ "error": "message" }`; Identity Toolkit nests it under
 * `error.message`. Either way the status is non-2xx, so a thrown `SettleUpError`
 * carries the status and the parsed body for the caller to inspect.
 */
export async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const {
    method = "GET",
    body,
    form,
    attempts = method === "GET" ? 4 : 1,
    timeoutMs = 30_000,
  } = options;
  const hasBody = body !== undefined || form !== undefined;
  const payload = form ? new URLSearchParams(form).toString() : JSON.stringify(body ?? {});
  const contentType = form
    ? "application/x-www-form-urlencoded"
    : "application/json; charset=utf-8";

  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: hasBody ? { "content-type": contentType } : {},
        body: hasBody ? payload : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      const parsed = text ? safeJson(text) : null;
      if (res.ok) return parsed as T;

      if ((res.status === 429 || res.status >= 500) && attempt < attempts) {
        await sleep(2 ** attempt * 500);
        continue;
      }
      throw new SettleUpError(errorMessage(parsed, res.status, text), res.status, parsed);
    } catch (err) {
      if (err instanceof SettleUpError || !isNetworkError(err) || attempt === attempts) throw err;
      await sleep(2 ** attempt * 500);
    }
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Pull a human message out of whichever error shape came back. */
function errorMessage(parsed: unknown, status: number, raw: string): string {
  const p = parsed as { error?: unknown };
  const e = p?.error;
  if (typeof e === "string") return `Settle Up: ${e}`;
  if (e && typeof e === "object" && "message" in e) {
    return `Settle Up: ${(e as { message?: string }).message}`;
  }
  return `Settle Up HTTP ${status}: ${raw.slice(0, 200)}`;
}
