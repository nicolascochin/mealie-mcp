import { MealieError } from './errors.js';
import { api, type ApiPath } from './path.js';
import type { MealieUser } from './types.js';

export const DEFAULT_TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 200;
const MAX_DETAIL_LENGTH = 300;

export interface MealieClientOptions {
  /** Mealie base URL without trailing slash, e.g. http://mealie:9000. */
  baseUrl: string;
  /** The user's Mealie API token, sent as a bearer token on every call. */
  token: string;
  timeoutMs?: number;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Query string values; `undefined` entries are left out. */
export type Query = Record<string, string | number | boolean | undefined>;

/** Calls the Mealie API on behalf of one user. Built per MCP request, never shared between users. */
export class MealieClient {
  private readonly timeoutMs: number;

  constructor(private readonly options: MealieClientOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  getSelf(): Promise<MealieUser> {
    return this.get<MealieUser>(api`/api/users/self`);
  }

  get<T>(path: ApiPath, query?: Query): Promise<T> {
    return this.request<T>('GET', path, undefined, query);
  }

  post<T>(path: ApiPath, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  /** Sends one request. A GET is retried once after a network error or a 5xx; nothing else is retried. */
  async request<T>(method: Method, path: ApiPath, body?: unknown, query?: Query): Promise<T> {
    const attempts = method === 'GET' ? 2 : 1;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.send<T>(method, path, body, query);
      } catch (err) {
        if (attempt >= attempts || !isRetryable(err)) throw err;
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }

  private async send<T>(method: Method, path: ApiPath, body: unknown, query: Query | undefined): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.options.token}`, accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';

    let res: Response;
    try {
      res = await fetch(this.options.baseUrl + path + queryString(query), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new MealieError('timeout', `${method} ${path} timed out after ${this.timeoutMs} ms`);
      }
      throw new MealieError('network', `${method} ${path} failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!res.ok) {
      const detail = await readDetail(res);
      throw new MealieError('http', `${method} ${path} answered ${res.status}`, res.status, detail);
    }
    if (res.status === 204) return undefined as T;
    try {
      return (await res.json()) as T;
    } catch {
      throw new MealieError('invalid_response', `${method} ${path} did not return JSON`);
    }
  }
}

function queryString(query: Query | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

function isRetryable(err: unknown): boolean {
  return err instanceof MealieError && (err.kind === 'network' || (err.kind === 'http' && (err.status ?? 0) >= 500));
}

/**
 * Extracts a human-readable explanation from a FastAPI error body: `{"detail": "..."}`,
 * `{"detail": {"message": "..."}}` or a validation list `{"detail": [{"msg": "..."}]}`.
 * Never reads Mealie's `exception` field, which can hold internals.
 */
async function readDetail(res: Response): Promise<string | undefined> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return undefined;
  }
  const detail = (body as { detail?: unknown } | null)?.detail;
  let text: string | undefined;
  if (typeof detail === 'string') text = detail;
  else if (Array.isArray(detail)) {
    text = detail
      .map((item) => (item as { msg?: unknown } | null)?.msg)
      .filter((msg): msg is string => typeof msg === 'string')
      .join('; ');
  } else if (detail && typeof (detail as { message?: unknown }).message === 'string') {
    text = (detail as { message: string }).message;
  }
  if (!text) return undefined;
  return text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH)}…` : text;
}
