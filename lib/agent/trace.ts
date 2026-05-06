import type { TraceEvent, TraceEventType, ToolName } from "./types";

export function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function traceEvent(input: {
  eventType: TraceEventType;
  title: string;
  inputSummary?: string;
  resultSummary?: string;
  toolName?: ToolName;
  policySource?: string;
}): TraceEvent {
  return {
    id: createId("trace"),
    timestamp: nowIso(),
    ...input
  };
}

export function summarizeValue(value: unknown): string {
  if (value == null) return "No result";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, (_, item) => (typeof item === "string" && item.length > 120 ? `${item.slice(0, 117)}...` : item));
}
