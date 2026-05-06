import type { ConfirmationIntent, CustomerSignal, Intent, WorkflowExtraction, WorkflowState } from "./types";
import { isRecord } from "@/lib/utils/typeGuards";

const intents = new Set<Intent>([
  "order_status",
  "delivery_exception",
  "return_or_refund",
  "shipping_policy",
  "password_reset",
  "unknown"
]);

const confirmationIntents = new Set<ConfirmationIntent>(["confirm", "reject", "unclear"]);

const customerSignals = new Set<CustomerSignal>([
  "frustration",
  "urgency",
  "human_help",
  "exception_request"
]);

const allowedWorkflowStateUpdateKeys = new Set([
  "intent",
  "email",
  "zipCode",
  "orderId",
  "itemHint",
  "customerDeadline",
  "customerDeadlineParseFailed",
  "returnReason",
  "returnConditionConfirmed"
]);

function validateWorkflowStateUpdates(value: unknown): WorkflowState | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error("workflowStateUpdates must be an object when provided.");
  }

  const updates: WorkflowState = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    if (!allowedWorkflowStateUpdateKeys.has(key)) {
      throw new Error(`workflowStateUpdates.${key} is not an allowed extraction field.`);
    }

    if (fieldValue === undefined || fieldValue === null || fieldValue === "") {
      continue;
    }

    if (key === "intent") {
      if (typeof fieldValue !== "string" || !intents.has(fieldValue as Intent)) {
        throw new Error("workflowStateUpdates.intent must be a supported intent.");
      }
      updates.intent = fieldValue;
      continue;
    }

    if (key === "customerDeadlineParseFailed" || key === "returnConditionConfirmed") {
      if (typeof fieldValue !== "boolean") {
        throw new Error(`workflowStateUpdates.${key} must be a boolean.`);
      }
      updates[key] = fieldValue;
      continue;
    }

    if (typeof fieldValue !== "string") {
      throw new Error(`workflowStateUpdates.${key} must be a string.`);
    }
    updates[key] = fieldValue;
  }

  return updates;
}

export function validateWorkflowExtraction(value: unknown): WorkflowExtraction {
  if (!isRecord(value)) {
    throw new Error("Workflow extraction must be an object.");
  }

  const workflowStateUpdates = validateWorkflowStateUpdates(value.workflowStateUpdates);

  const confirmationIntent =
    typeof value.confirmationIntent === "string" && confirmationIntents.has(value.confirmationIntent as ConfirmationIntent)
      ? (value.confirmationIntent as ConfirmationIntent)
      : "unclear";

  if (value.asksForAddress !== undefined && typeof value.asksForAddress !== "boolean") {
    throw new Error("asksForAddress must be a boolean when provided.");
  }

  if (value.customerSignals !== undefined) {
    if (
      !Array.isArray(value.customerSignals) ||
      value.customerSignals.some((signal) => typeof signal !== "string" || !customerSignals.has(signal as CustomerSignal))
    ) {
      throw new Error("customerSignals must be an array of supported signal strings.");
    }
  }

  return {
    workflowStateUpdates,
    confirmationIntent,
    asksForAddress: value.asksForAddress === true,
    customerSignals: Array.isArray(value.customerSignals) ? (value.customerSignals as CustomerSignal[]) : []
  };
}
