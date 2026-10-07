import type { ToolDef } from "./tools";

export function filterTools(
  catalog: Record<string, ToolDef>,
  enabledTools: string[],
): ToolDef[] {
  const enabled = new Set(enabledTools);
  return Object.values(catalog).filter((t) => enabled.has(t.action));
}

export function isEntitled(enabledTools: string[], action: string): boolean {
  return enabledTools.includes(action);
}
