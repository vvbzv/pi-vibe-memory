import test from "node:test";
import assert from "node:assert/strict";
import {
  HindsightClient,
  HindsightError,
} from "../src/hindsight/client.js";
import {
  buildHindsightTags,
  createArtifactDocumentId,
  createObservationDocumentId,
  normalizeBankId,
} from "../src/hindsight/banks.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit }> = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const normalizedInit = init ?? {};
    calls.push({ url, init: normalizedInit });
    return handler(url, normalizedInit);
  }) as typeof fetch;

  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

test("retainBatch sends deterministic payload shape and configured auth", async () => {
  const fetchMock = mockFetch(() => jsonResponse({ accepted: true, operation_id: "op1" }));
  try {
    const client = new HindsightClient({
      baseUrl: "http://localhost:8888/",
      apiKey: "secret",
    });

    const result = await client.retainBatch("pi", [
      {
        content: "hello",
        documentId: "pi-observation:1",
        updateMode: "replace",
        tags: ["pi", "pi-vibe-memory"],
        metadata: { source: "test" },
      },
      {
        content: "world",
        tags: ["summary"],
      },
    ]);

    assert.deepEqual(result, { accepted: true, operation_id: "op1" });
    assert.equal(fetchMock.calls[0]?.url, "http://localhost:8888/v1/default/banks/pi/memories");
    assert.deepEqual(fetchMock.calls[0]?.init.headers, {
      "content-type": "application/json",
      "user-agent": "pi-vibe-memory",
      authorization: "Bearer secret",
    });
    assert.deepEqual(JSON.parse(String(fetchMock.calls[0]?.init.body)), {
      items: [
        {
          content: "hello",
          document_id: "pi-observation:1",
          update_mode: "replace",
          tags: ["pi", "pi-vibe-memory"],
          metadata: { source: "test" },
        },
        {
          content: "world",
          tags: ["summary"],
        },
      ],
    });
  } finally {
    fetchMock.restore();
  }
});

test("recall and reflect send budget and token options", async () => {
  const fetchMock = mockFetch((url) => {
    if (url.endsWith("/recall")) return jsonResponse({ memories: [{ content: "found" }] });
    return jsonResponse({ reflection: "think" });
  });
  try {
    const client = new HindsightClient({ baseUrl: "http://localhost:8888" });

    await client.recall("team/pi", "query", {
      budget: "low",
      limit: 3,
      maxTokens: 800,
      tags: ["decision"],
      tagsMatch: "any",
    });
    await client.reflect("team/pi", "query", { budget: "mid", maxTokens: 1200 });

    assert.equal(fetchMock.calls[0]?.url, "http://localhost:8888/v1/default/banks/team%2Fpi/recall");
    assert.deepEqual(JSON.parse(String(fetchMock.calls[0]?.init.body)), {
      query: "query",
      budget: "low",
      limit: 3,
      max_tokens: 800,
      tags: ["decision"],
      tags_match: "any",
    });
    assert.equal(fetchMock.calls[1]?.url, "http://localhost:8888/v1/default/banks/team%2Fpi/reflect");
    assert.deepEqual(JSON.parse(String(fetchMock.calls[1]?.init.body)), {
      query: "query",
      budget: "mid",
      max_tokens: 1200,
    });
  } finally {
    fetchMock.restore();
  }
});

test("client uses apiKeyEnv when apiKey is absent", async () => {
  const fetchMock = mockFetch(() => jsonResponse({ status: "ok" }));
  const previous = process.env.PVM_HINDSIGHT_TEST_KEY;
  process.env.PVM_HINDSIGHT_TEST_KEY = "env-secret";
  try {
    const client = new HindsightClient({
      baseUrl: "http://localhost:8888",
      apiKeyEnv: "PVM_HINDSIGHT_TEST_KEY",
    });

    await client.health();

    assert.equal((fetchMock.calls[0]?.init.headers as Record<string, string>).authorization, "Bearer env-secret");
  } finally {
    if (previous === undefined) delete process.env.PVM_HINDSIGHT_TEST_KEY;
    else process.env.PVM_HINDSIGHT_TEST_KEY = previous;
    fetchMock.restore();
  }
});

test("client aborts timed out requests", async () => {
  const fetchMock = mockFetch((_url, init) => new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    });
  }));
  try {
    const client = new HindsightClient({ baseUrl: "http://localhost:8888", timeoutMs: 1 });

    await assert.rejects(
      () => client.health(),
      (error: unknown) => error instanceof HindsightError && error.status === 0 && /timed out/i.test(error.message),
    );
  } finally {
    fetchMock.restore();
  }
});

test("client rejects invalid timeout values", () => {
  assert.throws(() => new HindsightClient({ baseUrl: "http://localhost:8888", timeoutMs: 0 }), /timeoutMs/);
});

test("client throws useful http errors without leaking authorization or body secrets", async () => {
  const fetchMock = mockFetch(() => new Response("boom apiKey=server-secret-token", { status: 500, statusText: "Server Error" }));
  try {
    const client = new HindsightClient({ baseUrl: "http://localhost:8888", apiKey: "client-test-token" });

    await assert.rejects(
      () => client.recall("pi", "query"),
      (error: unknown) => {
        assert.ok(error instanceof HindsightError);
        assert.equal(error.status, 500);
        assert.match(error.message, /500/);
        assert.match(error.message, /boom/);
        assert.match(error.message, /\[REDACTED_SECRET\]/);
        assert.doesNotMatch(error.message, /client-test-token|server-secret-token/);
        assert.doesNotMatch(error.body ?? "", /server-secret-token/);
        return true;
      },
    );
  } finally {
    fetchMock.restore();
  }
});


test("client scrubs fetch rejection messages and retained causes", async () => {
  const fetchMock = mockFetch(() => {
    throw new Error("network failed apiKey=fetch-secret-token");
  });
  try {
    const client = new HindsightClient({ baseUrl: "http://localhost:8888" });

    await assert.rejects(
      () => client.health(),
      (error: unknown) => {
        assert.ok(error instanceof HindsightError);
        assert.match(error.message, /\[REDACTED_SECRET\]/);
        assert.doesNotMatch(error.message, /fetch-secret-token/);
        assert.ok(error.cause instanceof Error);
        assert.match(error.cause.message, /\[REDACTED_SECRET\]/);
        assert.doesNotMatch(error.cause.message, /fetch-secret-token/);
        return true;
      },
    );
  } finally {
    fetchMock.restore();
  }
});

test("client scrubs invalid JSON causes", async () => {
  const fetchMock = mockFetch(() => new Response("apiKey=invalid-json-secret", { status: 200 }));
  try {
    const client = new HindsightClient({ baseUrl: "http://localhost:8888" });

    await assert.rejects(
      () => client.health(),
      (error: unknown) => {
        assert.ok(error instanceof HindsightError);
        assert.ok(error.cause instanceof Error);
        assert.match(error.message, /\[REDACTED_SECRET\]/);
        assert.match(error.cause.message, /\[REDACTED_SECRET\]/);
        assert.doesNotMatch(error.cause.message, /invalid-json-secret/);
        return true;
      },
    );
  } finally {
    fetchMock.restore();
  }
});

test("bank helpers create deterministic ids and tags", () => {
  assert.equal(normalizeBankId(""), "pi");
  assert.equal(normalizeBankId(" team/pi "), "team/pi");
  assert.equal(createObservationDocumentId("obs1"), "pi-observation:obs1");
  assert.match(createArtifactDocumentId("workspace 1", "src/runtime.ts"), /^pi-artifact:workspace-1:[a-f0-9]{16}$/);
  assert.deepEqual(buildHindsightTags({ projectSlug: "My App", workspaceId: "ws1", sessionId: "s1", kinds: ["decision"] }), [
    "pi",
    "pi-vibe-memory",
    "project:my-app",
    "workspace:ws1",
    "session:s1",
    "decision",
  ]);
});
