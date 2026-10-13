import { describe, it, expect } from "vitest";
import { filterTools } from "../src/entitlements";
import { TOOL_CATALOG } from "../src/tools";

describe("filterTools", () => {
  it("returns only tools present in enabledTools", () => {
    const names = filterTools(TOOL_CATALOG, ["get_hot_leads", "list_tasks"]).map((t) => t.action);
    expect(names.sort()).toEqual(["get_hot_leads", "list_tasks"]);
  });
  it("ignores unknown tool names in enabledTools", () => {
    const names = filterTools(TOOL_CATALOG, ["get_hot_leads", "write_listing"]).map((t) => t.action);
    expect(names).toEqual(["get_hot_leads"]);
  });
  it("returns empty when nothing enabled", () => {
    expect(filterTools(TOOL_CATALOG, [])).toEqual([]);
  });
});
