import { describe, it, expect } from "vitest";
import { TOOL_CATALOG, CORE_TOOLS } from "../src/tools";

describe("tool catalog", () => {
  it("defines the four core tools with names, descriptions, and zod input schemas", () => {
    for (const name of CORE_TOOLS) {
      const tool = TOOL_CATALOG[name];
      expect(tool, `missing ${name}`).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema).toBeTruthy();
    }
  });
  it("defines find_lead and my_activity with the inputs the n8n executor forwards", () => {
    expect(Object.keys(TOOL_CATALOG.find_lead.inputSchema)).toEqual(["query"]);
    expect(Object.keys(TOOL_CATALOG.my_activity.inputSchema)).toEqual(["days"]);
    expect(TOOL_CATALOG.find_lead.inputSchema.query.safeParse("a").success).toBe(false);
    expect(TOOL_CATALOG.find_lead.inputSchema.query.safeParse("Johnson").success).toBe(true);
    expect(TOOL_CATALOG.my_activity.inputSchema.days.parse(undefined)).toBe(7);
    expect(TOOL_CATALOG.my_activity.inputSchema.days.safeParse(91).success).toBe(false);
  });
  it("is not core: new tools must be granted per client", () => {
    expect(CORE_TOOLS).not.toContain("find_lead");
    expect(CORE_TOOLS).not.toContain("my_activity");
  });
  it("maps every tool to an executor action equal to its name", () => {
    for (const [name, tool] of Object.entries(TOOL_CATALOG)) {
      expect(tool.action).toBe(name);
    }
  });
});
