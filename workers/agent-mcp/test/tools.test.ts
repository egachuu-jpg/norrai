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
  it("maps every tool to an executor action equal to its name", () => {
    for (const [name, tool] of Object.entries(TOOL_CATALOG)) {
      expect(tool.action).toBe(name);
    }
  });
});
