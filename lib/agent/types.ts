// Pins demo policy math so seeded return windows and "tomorrow" scripts stay stable.
export const DEMO_TODAY = "2026-05-05";

export type Intent =
  | "order_status"
  | "delivery_exception"
  | "return_or_refund"
  | "shipping_policy"
  | "password_reset"
  | "unknown";

// Chat roles distinguish customer-authored messages from agent-authored replies.
export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
};

export type TraceEventType =
  | "intent"
  | "workflow_state_update"
  | "customer_signal"
  | "clarifying_question"
  | "tool_call"
  | "policy_check"
  | "confirmation_gate"
  | "action_result"
  | "handoff";

export type TraceEvent = {
  id: string;
  eventType: TraceEventType;
  title: string;
  inputSummary?: string;
  resultSummary?: string;
  toolName?: ToolName;
  policySource?: string;
  timestamp: string;
};

export type ToolName =
  | "lookupOrder"
  | "getTrackingStatus"
  | "checkReplacementInventory"
  | "quoteShippingOptions"
  | "evaluatePolicy"
  | "createReplacementOrder"
  | "createReturnLabel"
  | "createSupportTicket";

export type PendingAction =
  | {
      type: "approve_substitute";
      description: string;
      originalOrderId: string;
      replacementSku: string;
      replacementTitle: string;
      estimatedDelivery: string | null;
      guaranteedDelivery: boolean;
    }
  | {
      type: "confirm_replacement_address";
      description: string;
      originalOrderId: string;
      replacementSku: string;
      replacementTitle: string;
      customerConfirmedSubstitute: boolean;
      estimatedDelivery: string | null;
      guaranteedDelivery: boolean;
    }
  | {
      type: "create_return_label";
      description: string;
      orderId: string;
      itemSku: string;
      returnReason?: string;
      itemConditionConfirmed: boolean;
    }
  | {
      type: "create_support_ticket";
      description: string;
      orderId?: string;
      issueType: string;
      priority: "normal" | "high";
      summary: string;
      context: Record<string, unknown>;
    };

// Workflow state is compact, structured memory: verified identity fields,
// selected order, recent tool outputs, policy decisions, customer signals,
// and pending facts. It is not chain-of-thought.
export type WorkflowState = Record<string, unknown>;

export type CustomerSignal = "frustration" | "urgency" | "human_help" | "exception_request";

export type ConfirmationIntent = "confirm" | "reject" | "unclear";

export type WorkflowExtraction = {
  workflowStateUpdates?: WorkflowState;
  confirmationIntent?: ConfirmationIntent;
  asksForAddress?: boolean;
  customerSignals?: CustomerSignal[];
};

export type ConversationState = {
  conversationId: string;
  messages: ChatMessage[];
  workflowState: WorkflowState;
  pendingAction?: PendingAction;
  traceEvents: TraceEvent[];
};

export type AgentInput = {
  userMessage: string;
  state: ConversationState;
};

export type AgentStep =
  | {
      type: "respond";
      message: string;
      workflowStateUpdates?: Record<string, unknown>;
      trace?: TraceEvent[];
    }
  | {
      type: "tool_call";
      toolName: ToolName;
      args: Record<string, unknown>;
      workflowStateUpdates?: Record<string, unknown>;
    }
  | {
      type: "ask_clarifying_question";
      message: string;
      missingFields: string[];
      workflowStateUpdates?: Record<string, unknown>;
    }
  | {
      type: "request_confirmation";
      message: string;
      pendingAction: PendingAction;
      workflowStateUpdates?: Record<string, unknown>;
    };

export type AgentTurnResult = {
  assistantMessage: ChatMessage;
  state: ConversationState;
};

export type ResponseRenderInput = {
  userMessage: string;
  state: ConversationState;
  step: AgentStep;
  defaultMessage: string;
};
