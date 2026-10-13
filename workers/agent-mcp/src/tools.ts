import { z } from "zod";

// Raw zod shape accepted by v2 `McpServer.registerTool` (`Record<string, z.ZodType>`).
// Not `z.ZodRawShape`: in zod 4 that alias widens to the loose `core.$ZodShape`
// (`$ZodType`), which is missing the full `ZodType` surface the v2 server overload
// requires, so it fails to bind the raw-shape `registerTool` overload.
export type RawShape = Record<string, z.ZodType>;

export interface ToolDef {
  action: string;
  description: string;
  inputSchema: RawShape;
}

export const TOOL_CATALOG: Record<string, ToolDef> = {
  get_hot_leads: {
    action: "get_hot_leads",
    description:
      "The agent's real-estate lead pipeline from their CRM, most promising first: leads who reached out again (repeat inquiry or open house return), then new leads, then qualified leads. Each lead has a 'why' to read back. Use for 'who should I call today', follow-ups, or which clients need attention. Prefer this over the phone's Reminders or Calendar for lead questions. email_opt_out and marketing_email_opt_out are about email only; neither means do-not-call or do-not-text.",
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
  find_lead: {
    action: "find_lead",
    description:
      "Look up a specific lead in the agent's CRM by name, email, phone number or property street, e.g. 'what's going on with the Johnsons?' or 'who was asking about 412 Elm?'. Returns contact info, what they asked for, when they came in, open to-dos, and what Norr AI has sent them. Search with one distinctive piece (a last name, not 'the Johnsons'). If several leads match, ask which one. Returns lead ids usable with add_task.",
    inputSchema: {
      query: z.string().min(2).max(100),
    },
  },
  my_activity: {
    action: "my_activity",
    description:
      "What Norr AI did for the agent over a recent period: new leads (including how many came in after hours), instant replies sent, nurture emails, open house follow-ups, and to-dos completed. Use for 'what did Norr AI do for me this week?' or 'how many leads came in this month?'. Report only the counts returned; don't infer replies or results beyond them.",
    inputSchema: {
      days: z.number().int().min(1).max(90).default(7),
    },
  },
};

export const CORE_TOOLS = ["get_hot_leads", "list_tasks", "add_task", "complete_task"] as const;
