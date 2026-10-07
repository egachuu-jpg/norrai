import type { Env, ExecutorResult } from "./types";

export async function callExecutor(
  env: Env,
  action: string,
  agentEmail: string,
  args: Record<string, unknown>,
): Promise<ExecutorResult> {
  const res = await fetch(env.N8N_EXECUTOR_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Norr-Secret": env.N8N_SHARED_SECRET },
    body: JSON.stringify({ action, agent_email: agentEmail, ...args }),
  });
  if (!res.ok) throw new Error(`executor ${action} failed: ${res.status}`);
  return (await res.json()) as ExecutorResult;
}
