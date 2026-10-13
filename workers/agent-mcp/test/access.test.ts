import { describe, it, expect } from "vitest";
import { resolveAgent } from "../src/access";

describe("resolveAgent", () => {
  it("returns props when validate_agent finds a client", async () => {
    const call = async () => ({ client_id: "c1", enabled_tools: ["get_hot_leads"] });
    const props = await resolveAgent(call as any, {} as any, "a@b.com");
    expect(props).toEqual({ email: "a@b.com", clientId: "c1", enabledTools: ["get_hot_leads"] });
  });
  it("returns null when no client matches", async () => {
    const call = async () => ({ client_id: null });
    const props = await resolveAgent(call as any, {} as any, "nobody@x.com");
    expect(props).toBeNull();
  });
});
