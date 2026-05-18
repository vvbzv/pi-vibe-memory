import { scrubSecrets } from "../scrub.js";
import { PACKAGE_NAME } from "../constants.js";
import type { HindsightBudget } from "../config.js";

type JsonObject = Record<string, unknown>;
export type HindsightMetadata = Record<string, string>;
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type RetainUpdateMode = "append" | "replace";
export type TagsMatchMode = "all" | "any";

export interface HindsightClientOptions {
  baseUrl: string;
  apiKey?: string;
  apiKeyEnv?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

export interface MemoryItemInput {
  content: string;
  documentId?: string;
  updateMode?: RetainUpdateMode;
  tags?: string[];
  metadata?: HindsightMetadata;
}

export interface RetainOptions {
  async?: boolean;
  budget?: HindsightBudget;
  maxTokens?: number;
}

export interface RecallOptions {
  budget?: HindsightBudget;
  limit?: number;
  maxTokens?: number;
  tags?: string[];
  tagsMatch?: TagsMatchMode;
}

export interface ReflectOptions {
  budget?: HindsightBudget;
  maxTokens?: number;
  limit?: number;
}

export interface GetBankOptions {
  createIfMissing?: boolean;
}

export interface HealthResult extends JsonObject {}
export interface RetainResult extends JsonObject {}
export interface RecallResult extends JsonObject {}
export interface ReflectResult extends JsonObject {}
export interface BankProfile extends JsonObject {}
export interface Operation extends JsonObject {}

export class HindsightError extends Error {
  readonly status: number;
  readonly body?: string;

  constructor(message: string, options: { status: number; body?: string; cause?: unknown }) {
    super(message);
    this.name = "HindsightError";
    this.status = options.status;
    this.body = options.body;
    if (options.cause !== undefined) this.cause = sanitizeCause(options.cause);
  }
}

function sanitizeCause(cause: unknown): unknown {
  if (cause instanceof Error) {
    const sanitized = new Error(scrubSecrets(cause.message, { maxChars: 500 }));
    sanitized.name = cause.name;
    return sanitized;
  }
  if (cause === undefined) return undefined;
  return new Error(scrubSecrets(String(cause), { maxChars: 500 }));
}

export class HindsightClient {
  readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: HindsightClientOptions) {
    if (!options.baseUrl.trim()) throw new Error("Hindsight baseUrl is required");
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    const configuredKey = options.apiKey?.trim();
    const envKey = options.apiKeyEnv ? process.env[options.apiKeyEnv]?.trim() : undefined;
    this.apiKey = configuredKey || envKey || undefined;
    const timeoutMs = options.timeoutMs ?? 1500;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error("Hindsight timeoutMs must be a positive finite number");
    }
    this.timeoutMs = timeoutMs;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  health(): Promise<HealthResult> {
    return this.request<HealthResult>("GET", "/health");
  }

  retainBatch(bankId: string, items: MemoryItemInput[], options: RetainOptions = {}): Promise<RetainResult> {
    if (items.length === 0) throw new Error("retainBatch requires at least one item");
    return this.request<RetainResult>("POST", this.bankPath(bankId, "memories"), {
      ...retainOptionsToPayload(options),
      items: items.map(memoryItemToPayload),
    });
  }

  recall(bankId: string, query: string, options: RecallOptions = {}): Promise<RecallResult> {
    return this.request<RecallResult>("POST", this.bankPath(bankId, "recall"), {
      query,
      ...recallOptionsToPayload(options),
    });
  }

  reflect(bankId: string, query: string, options: ReflectOptions = {}): Promise<ReflectResult> {
    return this.request<ReflectResult>("POST", this.bankPath(bankId, "reflect"), {
      query,
      ...reflectOptionsToPayload(options),
    });
  }

  getBank(bankId: string, options: GetBankOptions = {}): Promise<BankProfile | null> {
    const suffix = options.createIfMissing ? "?create_if_missing=true" : "";
    return this.request<BankProfile | null>("GET", `${this.bankPath(bankId)}${suffix}`, undefined, { allowNotFound: true });
  }

  listOperations(bankId: string): Promise<Operation[]> {
    return this.request<Operation[]>("GET", this.bankPath(bankId, "operations"));
  }

  private bankPath(bankId: string, action?: string): string {
    const base = `/v1/default/banks/${encodeURIComponent(bankId)}`;
    return action ? `${base}/${action}` : base;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: JsonObject,
    options: { allowNotFound?: boolean } = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: this.headers(body !== undefined),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      if (options.allowNotFound && response.status === 404) return null as T;
      if (!response.ok) await throwHttpError(response);
      return await parseJsonResponse<T>(response);
    } catch (error) {
      if (error instanceof HindsightError) throw error;
      if (isAbortError(error)) {
        throw new HindsightError(`Hindsight request timed out after ${this.timeoutMs}ms`, { status: 0, cause: error });
      }
      throw new HindsightError(`Hindsight request failed: ${scrubSecrets(errorMessage(error), { maxChars: 500 })}`, { status: 0, cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }

  private headers(hasBody: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      "user-agent": PACKAGE_NAME,
    };
    if (hasBody) headers["content-type"] = "application/json";
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    return headers;
  }
}

function memoryItemToPayload(item: MemoryItemInput): JsonObject {
  const payload: JsonObject = { content: item.content };
  if (item.documentId !== undefined) payload.document_id = item.documentId;
  if (item.updateMode !== undefined) payload.update_mode = item.updateMode;
  if (item.tags !== undefined) payload.tags = item.tags;
  if (item.metadata !== undefined) payload.metadata = item.metadata;
  return payload;
}

function retainOptionsToPayload(options: RetainOptions): JsonObject {
  const payload: JsonObject = {};
  if (options.async !== undefined) payload.async = options.async;
  if (options.budget !== undefined) payload.budget = options.budget;
  if (options.maxTokens !== undefined) payload.max_tokens = options.maxTokens;
  return payload;
}

function recallOptionsToPayload(options: RecallOptions): JsonObject {
  const payload: JsonObject = {};
  if (options.budget !== undefined) payload.budget = options.budget;
  if (options.limit !== undefined) payload.limit = options.limit;
  if (options.maxTokens !== undefined) payload.max_tokens = options.maxTokens;
  if (options.tags !== undefined) payload.tags = options.tags;
  if (options.tagsMatch !== undefined) payload.tags_match = options.tagsMatch;
  return payload;
}

function reflectOptionsToPayload(options: ReflectOptions): JsonObject {
  const payload: JsonObject = {};
  if (options.budget !== undefined) payload.budget = options.budget;
  if (options.limit !== undefined) payload.limit = options.limit;
  if (options.maxTokens !== undefined) payload.max_tokens = options.maxTokens;
  return payload;
}

async function throwHttpError(response: Response): Promise<never> {
  const body = scrubSecrets(await response.text());
  throw new HindsightError(`Hindsight request failed with ${response.status} ${scrubSecrets(response.statusText, { maxChars: 120 })}: ${body}`, {
    status: response.status,
    body,
  });
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    const body = scrubSecrets(text, { maxChars: 500 });
    throw new HindsightError(`Hindsight returned invalid JSON: ${body}`, { status: response.status, body, cause: new Error(`Invalid JSON response body: ${body}`) });
  }
}

function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException || error instanceof Error) && error.name === "AbortError";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
