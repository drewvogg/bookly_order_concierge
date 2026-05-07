import { DemoModelClient } from "./demoModelClient";
import { OpenAIModelClient } from "./openAIModelClient";
import { createId, nowIso, summarizeValue, traceEvent } from "./trace";
import { planNextStep } from "./workflowPlanner";
import type { ModelClient } from "./modelClient";
import type {
  AgentStep,
  AgentTurnResult,
  ChatMessage,
  ConversationState,
  CustomerSignal,
  PendingAction,
  TraceEvent,
  ToolName,
  WorkflowExtraction
} from "./types";
import { executeTool } from "@/lib/tools/toolRegistry";

type AgentTurnCallbacks = {
  onProgress?: (message: string) => void;
  onTraceEvent?: (event: TraceEvent) => void;
};

function createMessage(role: "user" | "assistant", content: string): ChatMessage {
  return {
    id: createId(role === "user" ? "usr" : "asst"),
    role,
    content,
    createdAt: nowIso()
  };
}

function getModelClient(): ModelClient {
  return process.env.LLM_MODE === "live" ? new OpenAIModelClient() : new DemoModelClient();
}

function logAgentEvent(event: string, details: Record<string, unknown>) {
  console.info(`[bookly-agent] ${event}`, details);
}

function emitProgress(callbacks: AgentTurnCallbacks | undefined, message: string) {
  callbacks?.onProgress?.(message);
}

function appendTraceEvent(state: ConversationState, event: TraceEvent, callbacks?: AgentTurnCallbacks) {
  state.traceEvents.push(event);
  callbacks?.onTraceEvent?.(event);
}

function getIncomingWorkflowState(state: ConversationState): Record<string, unknown> {
  return state.workflowState ?? {};
}

function withoutTurnLocalWorkflowState(workflowState: Record<string, unknown>) {
  // Tool outputs are turn-local continuation markers. Clearing them before a new
  // user message prevents the planner from re-entering the previous tool chain.
  const rest = { ...workflowState };
  delete rest.lastToolName;
  delete rest.lastToolOutput;
  return rest;
}

function applyWorkflowStateUpdates(state: ConversationState, updates?: Record<string, unknown>) {
  if (!updates) return;
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined && value !== null && value !== "") {
      state.workflowState[key] = value;
    }
  }
}

function appendTraceForExtraction(
  state: ConversationState,
  extraction: WorkflowExtraction,
  previousIntent: unknown,
  callbacks?: AgentTurnCallbacks
) {
  const intent = extraction.workflowStateUpdates?.intent;
  if (intent && intent !== previousIntent) {
    appendTraceEvent(
      state,
      traceEvent({
        eventType: "intent",
        title: "Intent detected",
        resultSummary: String(intent)
      }),
      callbacks
    );
  }

  const signals = extraction.customerSignals ?? [];
  if (signals.length > 0) {
    appendTraceEvent(
      state,
      traceEvent({
        eventType: "customer_signal",
        title: "Customer signal detected",
        resultSummary: signals.join(", ")
      }),
      callbacks
    );
  }
}

function appendTraceForStep(state: ConversationState, step: AgentStep, callbacks?: AgentTurnCallbacks) {
  if (step.type === "ask_clarifying_question") {
    appendTraceEvent(
      state,
      traceEvent({
        eventType: "clarifying_question",
        title: "Asked focused follow-up",
        resultSummary: `Missing: ${step.missingFields.join(", ")}`
      }),
      callbacks
    );
  }

  if (step.type === "request_confirmation") {
    appendTraceEvent(
      state,
      traceEvent({
        eventType: "confirmation_gate",
        title: "Confirmation required",
        resultSummary: step.pendingAction.description
      }),
      callbacks
    );
  }
}

function applyWorkflowExtraction(state: ConversationState, extraction: WorkflowExtraction) {
  applyWorkflowStateUpdates(state, extraction.workflowStateUpdates);

  const signals = new Set(extraction.customerSignals ?? []);
  if (signals.has("human_help")) {
    state.workflowState.humanHelpRequested = true;
  }

  if (signals.has("exception_request")) {
    state.workflowState.exceptionRequested = true;
  }

  const fuzzySignals: CustomerSignal[] = ["frustration", "urgency"];
  const currentIntent = state.workflowState.intent;
  const fuzzySignalCount = fuzzySignals.filter((signal) => {
    if (!signals.has(signal)) {
      return false;
    }

    // In delivery-exception workflows, deadline language is expected input.
    // Count urgency toward sentiment escalation only when paired with clearer
    // dissatisfaction or an explicit request for support review.
    if (
      signal === "urgency" &&
      currentIntent === "delivery_exception" &&
      !signals.has("frustration") &&
      !signals.has("human_help") &&
      !signals.has("exception_request")
    ) {
      return false;
    }

    return true;
  }).length;
  if (fuzzySignalCount > 0) {
    const previousCount =
      typeof state.workflowState.escalationSignalCount === "number"
        ? state.workflowState.escalationSignalCount
        : 0;
    state.workflowState.escalationSignalCount = previousCount + fuzzySignalCount;
  }
}

function inputSummary(toolName: ToolName, args: Record<string, unknown>) {
  switch (toolName) {
    case "lookupOrder":
      return `identity ${args.orderId ?? args.email ?? "unknown"} ${args.zipCode ? `zip ${args.zipCode}` : ""}`.trim();
    case "getTrackingStatus":
      return String(args.trackingNumber ?? "missing tracking number");
    case "checkReplacementInventory":
      return `order ${args.orderId ?? "unknown"} for deadline ${args.customerDeadline ?? "not provided"}`;
    case "quoteShippingOptions":
      return `order ${args.orderId ?? "unknown"} to zip ${args.zipCode ?? "unknown"}`;
    case "evaluatePolicy":
      return `${args.issueType ?? "request"} for order ${args.orderId ?? "unknown"}`;
    case "createReplacementOrder":
      return `replacement ${args.replacementSku ?? "unknown"} for ${args.originalOrderId ?? "unknown"}`;
    case "createReturnLabel":
      return `return label for ${args.orderId ?? "unknown"}`;
    case "createSupportTicket":
      return `${args.issueType ?? "support"} ticket`;
  }
}

function progressForTool(toolName: ToolName) {
  switch (toolName) {
    case "lookupOrder":
      return "Checking order details...";
    case "getTrackingStatus":
      return "Checking carrier status...";
    case "checkReplacementInventory":
      return "Checking replacement inventory...";
    case "quoteShippingOptions":
      return "Checking delivery estimates...";
    case "evaluatePolicy":
      return "Evaluating policy...";
    case "createReplacementOrder":
      return "Creating replacement order...";
    case "createReturnLabel":
      return "Creating return label...";
    case "createSupportTicket":
      return "Creating support ticket...";
  }
}

function isActionTool(toolName: ToolName) {
  return toolName === "createReplacementOrder" || toolName === "createReturnLabel" || toolName === "createSupportTicket";
}

function shouldRenderWithModel(step: AgentStep) {
  if (process.env.LLM_MODE !== "live" || step.type !== "respond") {
    return false;
  }

  return /\b(standard shipping|password resets|special circumstances|support review)\b/i.test(step.message);
}

async function renderAssistantContent(input: {
  modelClient: ModelClient;
  userMessage: string;
  state: ConversationState;
  step: AgentStep;
  turnId: string;
  callbacks?: AgentTurnCallbacks;
}) {
  if (input.step.type === "tool_call") {
    throw new Error("Tool call steps are not customer-facing messages.");
  }

  emitProgress(input.callbacks, "Preparing response...");

  if (!shouldRenderWithModel(input.step)) {
    logAgentEvent("response.done", {
      turnId: input.turnId,
      stepType: input.step.type,
      renderMode: "template",
      durationMs: 0
    });
    return input.step.message;
  }

  const startedAt = Date.now();
  const message = await input.modelClient.renderResponse({
    userMessage: input.userMessage,
    state: input.state,
    step: input.step,
    defaultMessage: input.step.message
  });
  logAgentEvent("response.done", {
    turnId: input.turnId,
    stepType: input.step.type,
    renderMode: "llm",
    durationMs: Date.now() - startedAt
  });
  return message;
}

function applyToolOutput(state: ConversationState, toolName: ToolName, output: Record<string, unknown>) {
  state.workflowState.lastToolName = toolName;
  state.workflowState.lastToolOutput = output;

  if (toolName === "lookupOrder") {
    const matches = Array.isArray(output.matches) ? output.matches : [];
    state.workflowState.orderMatches = matches;
    if (matches.length === 1) {
      state.workflowState.activeOrder = matches[0];
    } else {
      delete state.workflowState.activeOrder;
    }
  }

  if (toolName === "getTrackingStatus") {
    state.workflowState.trackingStatus = output.trackingStatus;
  }

  if (toolName === "checkReplacementInventory") {
    state.workflowState.inventory = output.inventory;
    state.workflowState.originalSku = output.originalSku;
  }

  if (toolName === "quoteShippingOptions") {
    state.workflowState.shippingOptions = output.shippingOptions;
  }

  if (toolName === "evaluatePolicy") {
    state.workflowState.policyDecision = output.policyDecision;
  }

  if (toolName === "createReplacementOrder") {
    const replacement = output.replacement;
    state.workflowState.replacement = replacement;
    state.workflowState.pendingActionCompleted = true;
  }

  if (toolName === "createReturnLabel") {
    state.workflowState.labelId = output.labelId;
    state.workflowState.downloadUrl = output.downloadUrl;
    state.workflowState.expiresAt = output.expiresAt;
    state.workflowState.labelReusedExistingAction = output.labelReusedExistingAction;
    state.workflowState.pendingActionCompleted = true;
  }

  if (toolName === "createSupportTicket") {
    state.workflowState.ticket = output.ticket;
    state.workflowState.pendingActionCompleted = true;
  }
}

export async function runAgentTurn(input: {
  message: string;
  state?: ConversationState;
  callbacks?: AgentTurnCallbacks;
}): Promise<AgentTurnResult> {
  const turnId = createId("turn");
  const turnStartedAt = Date.now();
  const modelClient = getModelClient();
  const mode = process.env.LLM_MODE === "live" ? "live" : "demo";
  logAgentEvent("turn.start", {
    turnId,
    mode,
    message: input.message
  });

  const workingState: ConversationState = input.state
    ? {
        ...input.state,
        messages: [...input.state.messages],
        traceEvents: [...input.state.traceEvents],
        workflowState: withoutTurnLocalWorkflowState(getIncomingWorkflowState(input.state))
      }
    : {
        conversationId: createId("conv"),
        messages: [],
        workflowState: {},
        traceEvents: []
      };

  workingState.messages.push(createMessage("user", input.message));
  const previousIntent = workingState.workflowState.intent;
  let extraction: WorkflowExtraction;
  const extractionStartedAt = Date.now();
  try {
    emitProgress(input.callbacks, "Understanding request...");
    extraction = await modelClient.extractWorkflowUpdate({ userMessage: input.message, state: workingState });
  } catch (error) {
    console.error("[bookly-agent] workflow extraction failed", error);
    throw error;
  }
  logAgentEvent("extraction.done", {
    turnId,
    durationMs: Date.now() - extractionStartedAt,
    workflowStateUpdates: extraction.workflowStateUpdates ?? {},
    confirmationIntent: extraction.confirmationIntent ?? "unclear",
    asksForAddress: extraction.asksForAddress === true,
    customerSignals: extraction.customerSignals ?? []
  });

  applyWorkflowExtraction(workingState, extraction);
  appendTraceForExtraction(workingState, extraction, previousIntent, input.callbacks);

  let lastStep: AgentStep | undefined;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const step = planNextStep({ userMessage: input.message, state: workingState, extraction });
    lastStep = step;
    logAgentEvent("planner.step", {
      turnId,
      iteration,
      stepType: step.type,
      toolName: step.type === "tool_call" ? step.toolName : undefined,
      missingFields: step.type === "ask_clarifying_question" ? step.missingFields : undefined,
      pendingAction: step.type === "request_confirmation" ? step.pendingAction.type : undefined
    });

    applyWorkflowStateUpdates(workingState, step.workflowStateUpdates);
    appendTraceForStep(workingState, step, input.callbacks);

    if (step.type === "tool_call") {
      workingState.pendingAction = undefined;
      let result: Awaited<ReturnType<typeof executeTool>>;
      const toolStartedAt = Date.now();
      logAgentEvent("tool.start", {
        turnId,
        toolName: step.toolName,
        args: step.args
      });
      emitProgress(input.callbacks, progressForTool(step.toolName));
      try {
        result = await executeTool(step.toolName, step.args);
      } catch (error) {
        console.error("[bookly-agent] tool execution failed", { toolName: step.toolName, error });
        throw error;
      }
      logAgentEvent("tool.done", {
        turnId,
        toolName: step.toolName,
        durationMs: Date.now() - toolStartedAt,
        resultSummary: result.resultSummary
      });

      applyToolOutput(workingState, step.toolName, result.output);
      const isPolicy = step.toolName === "evaluatePolicy";
      const isAction = isActionTool(step.toolName);

      appendTraceEvent(
        workingState,
        traceEvent({
          eventType: isAction ? "action_result" : isPolicy ? "policy_check" : "tool_call",
          title: isAction ? "Action completed" : isPolicy ? "Policy evaluated" : "Tool called",
          toolName: step.toolName,
          inputSummary: inputSummary(step.toolName, step.args),
          resultSummary: result.resultSummary || summarizeValue(result.output),
          policySource: result.policySource
        }),
        input.callbacks
      );
      continue;
    }

    if (step.type === "request_confirmation") {
      workingState.pendingAction = hydratePendingAction(step.pendingAction, workingState);
      const message = await renderAssistantContent({
        modelClient,
        userMessage: input.message,
        state: workingState,
        step,
        turnId,
        callbacks: input.callbacks
      });
      const assistantMessage = createMessage("assistant", message);
      workingState.messages.push(assistantMessage);
      logAgentEvent("turn.done", {
        turnId,
        durationMs: Date.now() - turnStartedAt,
        finalStepType: step.type
      });
      return { assistantMessage, state: workingState };
    }

    if (step.type === "ask_clarifying_question") {
      workingState.pendingAction = undefined;
      const message = await renderAssistantContent({
        modelClient,
        userMessage: input.message,
        state: workingState,
        step,
        turnId,
        callbacks: input.callbacks
      });
      const assistantMessage = createMessage("assistant", message);
      workingState.messages.push(assistantMessage);
      logAgentEvent("turn.done", {
        turnId,
        durationMs: Date.now() - turnStartedAt,
        finalStepType: step.type
      });
      return { assistantMessage, state: workingState };
    }

    workingState.pendingAction = undefined;
    const message = await renderAssistantContent({
      modelClient,
      userMessage: input.message,
      state: workingState,
      step,
      turnId,
      callbacks: input.callbacks
    });
    const assistantMessage = createMessage("assistant", message);
    workingState.messages.push(assistantMessage);
    logAgentEvent("turn.done", {
      turnId,
      durationMs: Date.now() - turnStartedAt,
      finalStepType: step.type
    });
    return { assistantMessage, state: workingState };
  }

  const fallback = createMessage(
    "assistant",
    lastStep?.type === "respond" ? lastStep.message : "I hit the demo step limit while working through this request."
  );
  workingState.messages.push(fallback);
  return { assistantMessage: fallback, state: workingState };
}

function hydratePendingAction(stepAction: PendingAction, state: ConversationState): PendingAction {
  if (!stepAction || typeof stepAction !== "object") return stepAction;
  const action = stepAction as Record<string, unknown>;
  const activeOrder = state.workflowState.activeOrder as Record<string, unknown> | undefined;

  if (action.type === "approve_substitute" && !action.originalOrderId) {
    action.originalOrderId = activeOrder?.orderId;
  }

  if (action.type === "confirm_replacement_address" && !action.originalOrderId) {
    action.originalOrderId = activeOrder?.orderId;
  }

  if (action.type === "create_support_ticket" && !action.orderId && activeOrder?.orderId) {
    action.orderId = activeOrder.orderId;
  }

  return action as PendingAction;
}
