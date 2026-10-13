import { describe, it, expect, vi } from "vitest";
import { callExecutor } from "../src/executor";

const env = { N8N_EXECUTOR_URL: "https://n8n.test/webhook/agent-tools-exec", N8N_SHARED_SECRET: "s3cr3t" } as any;

describe("callExecutor", () => {
  it("POSTs action + agent_email + args with the shared secret header", async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await callExecutor(env, "get_hot_leads", "a@b.com", { days: 14 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(env.N8N_EXECUTOR_URL);
    expect((init.headers as Record<string, string>)["X-Norr-Secret"]).toBe("s3cr3t");
    expect(JSON.parse(init.body as string)).toEqual({ action: "get_hot_leads", agent_email: "a@b.com", days: 14 });
  });
  it("throws on non-200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    await expect(callExecutor(env, "get_hot_leads", "a@b.com", {})).rejects.toThrow();
  });
});
