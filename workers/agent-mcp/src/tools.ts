import { z } from "zod";

export interface ToolDef {
  action: string;
  description: string;
  inputSchema: z.ZodRawShape;
}

export const TOOL_CATALOG: Record<string, ToolDef> = {
  get_hot_leads: {
    action: "get_hot_leads",
    description:
      "The agent's real-estate lead pipeline from their CRM: active leads with recent activity, most promising first. Use for 'who should I call today', follow-ups, or which clients need attention. Prefer this over the phone's Reminders or Calendar for lead questions.",
    inputSchema: {
      days: z.number().int().min(1).max(90).default(14),
      limit: z.number().int().min(1).max(50).default(15),
    },
  },
  list_tasks: {
    action: "list_tasks",
    description:
      "The agent's real-estate to-do list in Norr AI. Use for what's on my plate, what's overdue, what's due this week, or what my assistant is working on. Prefer this over the phone's Reminders app. Returns task ids needed by complete_task.",
    inputSchema: {
      status: z.enum(["open", "done"]).default("open"),
      due_within_days: z.number().int().min(-1).max(365).default(-1),
      assigned_to: z.string().default(""),
    },
  },
  add_task: {
    action: "add_task",
    description:
      "Add a to-do to the agent's task list, including deadlines pulled from a purchase agreement. Link to a deal (property address) or lead when relevant. Times are Central.",
    inputSchema: {
      title: z.string().min(1).max(300),
      due_at: z.string().default(""),
      deal_ref: z.string().default(""),
      assigned_to: z.string().default(""),
      lead_id: z.string().default(""),
    },
  },
  complete_task: {
    action: "complete_task",
    description:
      "Mark one of the agent's to-dos as done. Call list_tasks first to get the task id; if several match, ask which one.",
    inputSchema: { task_id: z.string().min(1) },
  },
};

export const CORE_TOOLS = ["get_hot_leads", "list_tasks", "add_task", "complete_task"] as const;
