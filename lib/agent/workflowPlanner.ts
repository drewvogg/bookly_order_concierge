import { DEFAULT_RETURN_REASON, booklyRepository } from "@/lib/repositories/booklyRepository";
import { asRecord } from "@/lib/utils/typeGuards";
import {
  DEMO_TODAY,
  type AgentInput,
  type AgentStep,
  type ConfirmationIntent,
  type CustomerSignal,
  type Intent,
  type PendingAction,
  type WorkflowExtraction,
  type WorkflowState
} from "./types";

type PlannerState = WorkflowState;
const DAY_MS = 86_400_000;
const YES_NO_CLARIFIER_FIELDS = new Set(["returnConditionConfirmed"]);

// Deterministic extraction is used by DemoModelClient and as a Live Mode
// validation-failure fallback. Successful Live Mode extraction comes from the LLM.
const KNOWN_ITEMS = [
  { key: "hobbit", hint: "The Hobbit" },
  { key: "dune", hint: "Dune" },
  { key: "foundation", hint: "Foundation" },
  { key: "project hail mary", hint: "Project Hail Mary" },
  { key: "hail mary", hint: "Project Hail Mary" },
  { key: "martian", hint: "The Martian" },
  { key: "leviathan", hint: "Leviathan Wakes" },
  { key: "wakes", hint: "Leviathan Wakes" },
  { key: "old man's war", hint: "Old Man's War" },
  { key: "old mans war", hint: "Old Man's War" },
  { key: "signed first edition", hint: "The Left Hand of Darkness" },
  { key: "left hand", hint: "The Left Hand of Darkness" }
];

function text(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function lower(value: string) {
  return value.toLowerCase();
}

function isConfirming(message: string) {
  return /\b(yes|yep|yeah|correct|confirmed|confirm|same address|send it|create|proceed|go ahead|fine|works|do it)\b/i.test(
    message
  );
}

function isRejecting(message: string) {
  return /\b(no|nope|don't|do not|not okay|not fine|cancel|stop|not paperback)\b/i.test(message);
}

function isAskingForAddress(message: string) {
  return /\b(what|which|confirm|show|tell me|verify).*\b(address|ship|shipping)\b/i.test(message);
}

function messageHasFrustrationSignal(message: string) {
  const normalized = lower(message);
  return booklyRepository.policies.customerFrustrationEscalationSignals.some((signal) =>
    normalized.includes(signal)
  );
}

function messageHasHumanHelpSignal(message: string) {
  return /\b(human|person|representative|support team|manager|supervisor)\b/i.test(message);
}

function messageHasExceptionSignal(message: string) {
  return /\b(exception|review|traveling|missed the window|missed window|special circumstance)\b/i.test(message);
}

function messageHasUrgencySignal(message: string) {
  return /\b(urgent|asap|right away|immediately|today|tomorrow|soon|need it)\b/i.test(message);
}

function confirmsOriginalCondition(message: string) {
  return /\b(unused|unopened|original condition|original packaging|original wrapping|still wrapped|still in (the )?packaging)\b/i.test(
    message
  );
}

function deniesOriginalCondition(message: string) {
  return /\b(used|opened|not original|not in original|missing packaging|no packaging|damaged)\b/i.test(message);
}

function extractReturnReason(message: string) {
  if (/\bwrong (format|item|book|edition)\b/i.test(message)) {
    return "Customer received or ordered the wrong item or format";
  }

  if (/\b(damaged|defective|broken|torn|ripped|water damaged)\b/i.test(message)) {
    return "Item arrived damaged";
  }

  if (
    /\b(changed my mind|decided|different one|another (book|one)|try a different|try another|do not want|don't want)\b/i.test(
      message
    )
  ) {
    return "Customer preference changed";
  }

  return undefined;
}

function classifyIntent(message: string, currentIntent?: Intent): Intent {
  if (currentIntent && currentIntent !== "unknown") return currentIntent;
  const value = lower(message);

  if (/\b(return|refund|label|wrong format)\b/.test(value)) return "return_or_refund";
  if (/\b(delayed|late|stuck|missing|hasn.?t arrived|not arrived|gift|birthday|replacement)\b/.test(value)) {
    return "delivery_exception";
  }
  if (/\b(status|tracking|where is|where's)\b/.test(value)) return "order_status";
  if (/\b(password|login|sign in)\b/.test(value)) return "password_reset";
  if (/\b(shipping policy|shipping|delivery policy)\b/.test(value)) return "shipping_policy";
  return "unknown";
}

function formatIsoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined;
  }

  return date.toISOString().slice(0, 10);
}

function normalizeYear(value?: string) {
  if (!value) {
    return new Date(`${DEMO_TODAY}T00:00:00Z`).getUTCFullYear();
  }

  const year = Number(value);
  return year < 100 ? 2000 + year : year;
}

function addDaysToDemoToday(days: number) {
  const date = new Date(new Date(`${DEMO_TODAY}T00:00:00Z`).getTime() + days * DAY_MS);
  return date.toISOString().slice(0, 10);
}

function parseCustomerDeadline(message: string) {
  if (/\btoday\b/i.test(message)) {
    return DEMO_TODAY;
  }

  if (/\btomorrow\b/i.test(message)) {
    return addDaysToDemoToday(1);
  }

  const isoDate = message.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (isoDate) {
    return formatIsoDate(Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3]));
  }

  const numericDate = message.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (numericDate) {
    return formatIsoDate(normalizeYear(numericDate[3]), Number(numericDate[1]), Number(numericDate[2]));
  }

  const monthDate = message.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{2,4}))?\b/i
  );
  if (monthDate) {
    const monthIndex = [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec"
    ].indexOf(monthDate[1].slice(0, 3).toLowerCase());
    return formatIsoDate(normalizeYear(monthDate[3]), monthIndex + 1, Number(monthDate[2]));
  }

  return undefined;
}

function looksLikeDeadlineAttempt(message: string) {
  return (
    /\b(deadline|arrive|arrival|deliver|delivery|need it|need this|by|before|on|asap|soon)\b/i.test(message) &&
    /\b(next|this|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|weekend|\d{1,2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(
      message
    )
  );
}

function extractWorkflowFields(message: string) {
  const updates: PlannerState = {};
  const email = message.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  const zipCode = message.match(/\b\d{5}\b/)?.[0];
  const orderId = message.match(/\bBK-\d{4}\b/i)?.[0]?.toUpperCase();
  const item = KNOWN_ITEMS.find((candidate) => lower(message).includes(candidate.key));
  const customerDeadline = parseCustomerDeadline(message);

  if (email) updates.email = email;
  if (zipCode) updates.zipCode = zipCode;
  if (orderId) updates.orderId = orderId;
  if (item) updates.itemHint = item.hint;
  if (customerDeadline) updates.customerDeadline = customerDeadline;
  if (customerDeadline) updates.customerDeadlineParseFailed = false;
  if (!customerDeadline && looksLikeDeadlineAttempt(message)) updates.customerDeadlineParseFailed = true;
  const returnReason = extractReturnReason(message);
  if (returnReason) updates.returnReason = returnReason;
  if (confirmsOriginalCondition(message)) updates.returnConditionConfirmed = true;
  if (deniesOriginalCondition(message)) updates.returnConditionConfirmed = false;

  return updates;
}

function extractCustomerSignals(message: string): CustomerSignal[] {
  const signals = new Set<CustomerSignal>();

  if (messageHasFrustrationSignal(message)) {
    signals.add("frustration");
  }

  if (messageHasUrgencySignal(message)) {
    signals.add("urgency");
  }

  if (messageHasHumanHelpSignal(message)) {
    signals.add("human_help");
  }

  if (messageHasExceptionSignal(message)) {
    signals.add("exception_request");
  }

  return [...signals];
}

function extractConfirmationIntent(message: string): ConfirmationIntent {
  if (isConfirming(message)) {
    return "confirm";
  }

  if (isRejecting(message)) {
    return "reject";
  }

  return "unclear";
}

function latestClarifierMissingFields(input: AgentInput) {
  const lastClarifier = [...input.state.traceEvents]
    .reverse()
    .find((event) => event.eventType === "clarifying_question");

  return lastClarifier?.resultSummary
    ?.replace("Missing: ", "")
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
}

function extractContextualShortAnswer(input: AgentInput) {
  const updates: PlannerState = {};
  const booleanField = latestClarifierMissingFields(input)?.find((field) => YES_NO_CLARIFIER_FIELDS.has(field));

  if (booleanField) {
    if (isConfirming(input.userMessage)) {
      updates[booleanField] = true;
    }

    if (isRejecting(input.userMessage)) {
      updates[booleanField] = false;
    }
  }

  return updates;
}

export function extractDeterministicWorkflowUpdate(input: AgentInput): WorkflowExtraction {
  const workflowStateUpdates: PlannerState = {
    ...extractWorkflowFields(input.userMessage),
    ...extractContextualShortAnswer(input)
  };
  const intent = classifyIntent(input.userMessage, input.state.workflowState.intent as Intent | undefined);

  if (intent) {
    workflowStateUpdates.intent = intent;
  }

  return {
    workflowStateUpdates,
    confirmationIntent: extractConfirmationIntent(input.userMessage),
    asksForAddress: isAskingForAddress(input.userMessage),
    customerSignals: extractCustomerSignals(input.userMessage)
  };
}

function getActiveOrder(fields: PlannerState) {
  return asRecord(fields.activeOrder);
}

function getPolicyDecision(fields: PlannerState) {
  return asRecord(fields.policyDecision);
}

function getShippingOptions(fields: PlannerState) {
  return asRecord(fields.shippingOptions);
}

function getTrackingStatus(fields: PlannerState) {
  return asRecord(fields.trackingStatus);
}

function getSubstituteOption(fields: PlannerState) {
  const shippingOptions = getShippingOptions(fields);
  const options = shippingOptions?.substituteOptions;
  return Array.isArray(options) ? asRecord(options[0]) : undefined;
}

function getOptionEstimatedDelivery(option?: Record<string, unknown>) {
  return text(option?.estimatedDelivery) ?? null;
}

function getMaskedAddressForOrder(orderId: string) {
  return booklyRepository.getOrder(orderId)?.maskedAddress ?? "the address on the order";
}

function supportTicketAction(input: {
  orderId?: string;
  issueType: string;
  priority?: "normal" | "high";
  summary: string;
  context?: Record<string, unknown>;
}): PendingAction {
  return {
    type: "create_support_ticket",
    description: "Create a Bookly support review ticket",
    orderId: input.orderId,
    issueType: input.issueType,
    priority: input.priority ?? "normal",
    summary: input.summary,
    context: input.context ?? {}
  };
}

function getCustomerSignalEscalation(fields: PlannerState) {
  if (fields.humanHelpRequested === true) {
    return {
      issueType: "customer_requested_human_help",
      priority: "normal" as const,
      explanation: "You asked for human help.",
      summary: `Customer requested human support for ${text(getActiveOrder(fields)?.orderId) ?? "this order"}.`
    };
  }

  const signalCount = typeof fields.escalationSignalCount === "number" ? fields.escalationSignalCount : 0;
  if (signalCount >= booklyRepository.policies.customerSignalEscalationThreshold) {
    return {
      issueType: "customer_sentiment_review",
      priority: "high" as const,
      explanation: "This has enough urgency or frustration signals that a support review is appropriate.",
      summary: `Customer sentiment/urgency threshold reached for ${text(getActiveOrder(fields)?.orderId) ?? "this order"}.`
    };
  }

  return undefined;
}

export function planNextStep(input: AgentInput & { extraction: WorkflowExtraction }): AgentStep {
    const extracted: PlannerState = input.extraction.workflowStateUpdates ?? {};
    const intent = (extracted.intent as Intent | undefined) ?? (input.state.workflowState.intent as Intent | undefined) ?? "unknown";
    const fields: PlannerState = { ...input.state.workflowState, ...extracted, intent };
    const workflowStateUpdates: PlannerState = { ...extracted, intent };
    const activeOrder = getActiveOrder(fields);
    const activeOrderId = text(activeOrder?.orderId);

    const pending = input.state.pendingAction;
    if (pending) {
      return handlePendingAction(input, pending);
    }

    const lastToolName = text(fields.lastToolName);
    if (lastToolName) {
      return afterTool(fields, workflowStateUpdates);
    }

    const supportEscalation = getCustomerSignalEscalation(fields);
    if (activeOrderId && supportEscalation) {
      return {
        type: "request_confirmation",
        message: `${supportEscalation.explanation} Should I create a support ticket so the team can review ${activeOrderId}?`,
        pendingAction: supportTicketAction({
          orderId: activeOrderId,
          issueType: supportEscalation.issueType,
          priority: supportEscalation.priority,
          summary: supportEscalation.summary,
          context: {
            customerSignals: {
              humanHelpRequested: fields.humanHelpRequested,
              escalationSignalCount: fields.escalationSignalCount
            }
          }
        }),
        workflowStateUpdates
      };
    }

    const policyDecision = getPolicyDecision(fields);
    if (
      policyDecision?.reasonCode === "inside_return_window" &&
      Object.hasOwn(workflowStateUpdates, "returnConditionConfirmed")
    ) {
      return {
        ...afterPolicy(fields),
        workflowStateUpdates
      };
    }

    if (policyDecision?.reasonCode === "outside_return_window" && fields.exceptionRequested === true) {
      return {
        type: "request_confirmation",
        message: "I can create a support review ticket for that exception request. Should I create it?",
        pendingAction: supportTicketAction({
          orderId: activeOrderId,
          issueType: "return_exception_review",
          priority: "normal",
          summary: `Customer requested an exception review for ${activeOrderId}.`,
          context: { policyDecision }
        }),
        workflowStateUpdates
      };
    }

    if (intent === "shipping_policy") {
      return {
        type: "respond",
        message:
          "Bookly standard shipping estimates are shown at checkout, and order-specific delivery claims need a tracking lookup. If you share an order number, or the email and zip code on the order, I can check the exact status.",
        workflowStateUpdates
      };
    }

    if (intent === "password_reset") {
      return {
        type: "respond",
        message:
          "For password resets, use the reset link on Bookly's sign-in page. I cannot access or change account credentials from this support flow.",
        workflowStateUpdates
      };
    }

    if (intent === "unknown") {
      return {
        type: "ask_clarifying_question",
        message: "I can help with order status, delayed deliveries, replacements, returns, or refunds. What can I help with today?",
        missingFields: ["intent"],
        workflowStateUpdates
      };
    }

    if (intent === "return_or_refund" && !text(fields.email) && !text(fields.orderId)) {
      return {
        type: "ask_clarifying_question",
        message:
          "Sure. What is the order number, or the email and zip code on the order? You can include the book title too if you know it.",
        missingFields: ["order identity", "item"],
        workflowStateUpdates
      };
    }

    if (!text(fields.orderId) && (!text(fields.email) || !text(fields.zipCode))) {
      return {
        type: "ask_clarifying_question",
        message: "I can help with that. What is the order number, or the email and zip code on the order?",
        missingFields: ["orderId or email+zipCode"],
        workflowStateUpdates
      };
    }

    return {
      type: "tool_call",
      toolName: "lookupOrder",
      args: {
        orderId: text(fields.orderId),
        email: text(fields.email),
        zipCode: text(fields.zipCode),
        itemHint: text(fields.itemHint)
      },
      workflowStateUpdates
    };
}

function handlePendingAction(input: AgentInput & { extraction: WorkflowExtraction }, pending: PendingAction): AgentStep {
    const message = input.userMessage;
    const confirmationIntent = input.extraction.confirmationIntent ?? extractConfirmationIntent(message);
    if (pending.type === "approve_substitute") {
      if (confirmationIntent === "reject") {
        return {
          type: "request_confirmation",
          message: `No problem. I will not create the replacement for ${pending.replacementTitle}. I can create a priority support ticket so the team can review other options. Should I do that?`,
          pendingAction: supportTicketAction({
            issueType: "replacement_rejected",
            priority: "high",
            summary: "Customer rejected the available substitute replacement."
          })
        };
      }

      if (confirmationIntent !== "confirm") {
        return {
          type: "request_confirmation",
          message: `Please confirm whether ${pending.replacementTitle} is acceptable as the replacement.`,
          pendingAction: pending
        };
      }

      return {
        type: "request_confirmation",
        message:
          `Great. I can create the replacement for ${pending.replacementTitle}. ` +
          "Please confirm I should send it to the same address on the order.",
        pendingAction: {
          type: "confirm_replacement_address",
          description: `Create replacement order for ${pending.replacementTitle}`,
          originalOrderId: pending.originalOrderId,
          replacementSku: pending.replacementSku,
          replacementTitle: pending.replacementTitle,
          customerConfirmedSubstitute: true,
          estimatedDelivery: pending.estimatedDelivery,
          guaranteedDelivery: pending.guaranteedDelivery
        }
      };
    }

    if (pending.type === "confirm_replacement_address") {
      if (confirmationIntent === "reject") {
        return {
          type: "respond",
          message: "Got it. I have not created a replacement order. A support teammate can help update the address or review other options."
        };
      }

      if (input.extraction.asksForAddress === true) {
        return {
          type: "request_confirmation",
          message: `I can confirm the saved shipping address as the ${getMaskedAddressForOrder(pending.originalOrderId)}. Should I send the replacement there?`,
          pendingAction: pending
        };
      }

      if (confirmationIntent !== "confirm") {
        return {
          type: "request_confirmation",
          message: "Please confirm whether I should create the replacement and send it to the same address on the order.",
          pendingAction: pending
        };
      }

      return {
        type: "tool_call",
        toolName: "createReplacementOrder",
        args: {
          originalOrderId: pending.originalOrderId,
          replacementSku: pending.replacementSku,
          customerConfirmedSubstitute: pending.customerConfirmedSubstitute,
          customerConfirmedAddress: true,
          estimatedDelivery: pending.estimatedDelivery,
          guaranteedDelivery: pending.guaranteedDelivery
        }
      };
    }

    if (pending.type === "create_return_label") {
      if (confirmationIntent === "reject") {
        return {
          type: "respond",
          message: "No return label created. I can restart the return flow if you decide you want one."
        };
      }

      if (confirmationIntent !== "confirm") {
        return {
          type: "request_confirmation",
          message: "Please confirm whether I should create the return label.",
          pendingAction: pending
        };
      }

      return {
        type: "tool_call",
        toolName: "createReturnLabel",
        args: {
          orderId: pending.orderId,
          itemSku: pending.itemSku,
          returnReason: pending.returnReason,
          itemConditionConfirmed: pending.itemConditionConfirmed
        }
      };
    }

    if (pending.type === "create_support_ticket") {
      if (confirmationIntent === "reject") {
        return {
          type: "respond",
          message: "Okay, I have not created a support ticket."
        };
      }

      if (confirmationIntent !== "confirm") {
        return {
          type: "request_confirmation",
          message: "Please confirm whether I should create the support ticket.",
          pendingAction: pending
        };
      }

      return {
        type: "tool_call",
        toolName: "createSupportTicket",
        args: pending
      };
    }

    return {
      type: "respond",
      message: "I cleared the pending action. What would you like to do next?"
    };
}

function afterTool(fields: PlannerState, workflowStateUpdates: PlannerState): AgentStep {
    const lastToolName = text(fields.lastToolName);
    const activeOrder = getActiveOrder(fields);
    const activeOrderId = text(activeOrder?.orderId);
    const intent = fields.intent as Intent;

    if (lastToolName === "lookupOrder") {
      const matches = Array.isArray(fields.orderMatches) ? fields.orderMatches : [];
      if (matches.length === 0) {
        return {
          type: "ask_clarifying_question",
          message: "I could not find a verified matching order. Could you check the order number, or provide the email and zip code on the order?",
          missingFields: ["verified order"]
        };
      }

      if (matches.length > 1) {
        const options = matches
          .map((match) => asRecord(match))
          .filter(Boolean)
          .map((match) => `${match?.orderId} (${match?.itemTitle}, placed ${match?.placedAt})`)
          .filter(Boolean)
          .join("; ");
        return {
          type: "ask_clarifying_question",
          message: `I found a few matching orders: ${options}. Which order should I use?`,
          missingFields: ["orderId"]
        };
      }

      if (intent === "return_or_refund") {
        return {
          type: "tool_call",
          toolName: "evaluatePolicy",
          args: {
            issueType: "return_request",
            orderId: activeOrderId,
            context: { order: activeOrder }
          },
          workflowStateUpdates
        };
      }

      return {
        type: "tool_call",
        toolName: "getTrackingStatus",
        args: { trackingNumber: text(activeOrder?.trackingNumber) },
        workflowStateUpdates
      };
    }

    if (lastToolName === "getTrackingStatus") {
      const trackingStatus = getTrackingStatus(fields);
      if (intent === "order_status") {
        return {
          type: "respond",
          message:
            `I found ${activeOrderId} for ${activeOrder?.itemTitle}. ` +
            `The carrier status is ${trackingStatus?.status}: ${trackingStatus?.statusDetail} ` +
            (trackingStatus?.estimatedDelivery
              ? `Estimated delivery is ${trackingStatus.estimatedDelivery}.`
              : "There is no current delivery estimate from the carrier.")
        };
      }

      const hoursSinceLastScan =
        typeof trackingStatus?.hoursSinceLastScan === "number" ? trackingStatus.hoursSinceLastScan : undefined;
      if (hoursSinceLastScan === undefined) {
        return {
          type: "tool_call",
          toolName: "evaluatePolicy",
          args: {
            issueType: "delivery_exception",
            orderId: activeOrderId,
            context: {
              order: activeOrder,
              trackingStatus
            }
          },
          workflowStateUpdates
        };
      }

      if (!text(fields.customerDeadline) && (hoursSinceLastScan ?? 0) >= 48) {
        const message =
          fields.customerDeadlineParseFailed === true
            ? "I could not turn that into a specific deadline date. Please send a date like May 7, 05/07/2026, or 2026-05-07 so I can check replacement options."
            : "When do you need the book to arrive? That helps me check only replacement options that can meet your deadline.";

        return {
          type: "ask_clarifying_question",
          message,
          missingFields: ["customerDeadline"]
        };
      }

      return {
        type: "tool_call",
        toolName: "checkReplacementInventory",
        args: {
          orderId: activeOrderId,
          originalSku: text(activeOrder?.sku),
          zipCode: text(activeOrder?.deliveryZip),
          customerDeadline: text(fields.customerDeadline)
        },
        workflowStateUpdates
      };
    }

    if (lastToolName === "checkReplacementInventory") {
      return {
        type: "tool_call",
        toolName: "quoteShippingOptions",
        args: {
          orderId: activeOrderId,
          zipCode: text(activeOrder?.deliveryZip),
          customerDeadline: text(fields.customerDeadline)
        },
        workflowStateUpdates
      };
    }

    if (lastToolName === "quoteShippingOptions") {
      return {
        type: "tool_call",
        toolName: "evaluatePolicy",
        args: {
          issueType: "delivery_exception",
          orderId: activeOrderId,
          context: {
            order: activeOrder,
            trackingStatus: getTrackingStatus(fields),
            shippingOptions: getShippingOptions(fields),
            customerDeadline: text(fields.customerDeadline)
          }
        },
        workflowStateUpdates
      };
    }

    if (lastToolName === "evaluatePolicy") {
      return afterPolicy(fields);
    }

    if (lastToolName === "createReplacementOrder") {
      const replacement = asRecord(fields.replacement);
      const guaranteed = replacement?.guaranteedDelivery === true;
      const verb =
        replacement?.reusedExistingAction === true ? "found existing replacement order" : "created replacement order";
      return {
        type: "respond",
        message:
          `Done. I ${verb} ${replacement?.replacementOrderId} for ${activeOrderId}. ` +
          `Estimated delivery is ${replacement?.estimatedDelivery}${guaranteed ? " and the carrier marks it guaranteed." : ", but it is not guaranteed."}`
      };
    }

    if (lastToolName === "createReturnLabel") {
      const reused = fields.labelReusedExistingAction === true;
      return {
        type: "respond",
        message:
          `${reused ? "Your existing return label" : "Your return label"} is ready: ${fields.labelId}. You can download it here: ${fields.downloadUrl}. ` +
          `It expires on ${fields.expiresAt}.`
      };
    }

    if (lastToolName === "createSupportTicket") {
      const ticket = asRecord(fields.ticket);
      return {
        type: "respond",
        message: `I created support ticket ${ticket?.ticketId} with ${ticket?.priority} priority. The support team can review the case from here.`
      };
    }

    return {
      type: "respond",
      message: "I finished that step. What would you like to do next?"
    };
}

function afterPolicy(fields: PlannerState): AgentStep {
    const decision = getPolicyDecision(fields);
    const order = getActiveOrder(fields);
    const orderId = text(order?.orderId);
    const itemTitle = text(order?.itemTitle);
    const intent = fields.intent as Intent;

    if (!decision) {
      return {
        type: "respond",
        message: "I could not evaluate the policy for this request."
      };
    }

    const supportEscalation = getCustomerSignalEscalation(fields);
    if (supportEscalation) {
      return {
        type: "request_confirmation",
        message: `${supportEscalation.explanation} Should I create a support ticket so the team can review ${orderId}?`,
        pendingAction: supportTicketAction({
          orderId,
          issueType: supportEscalation.issueType,
          priority: supportEscalation.priority,
          summary: supportEscalation.summary,
          context: {
            policyDecision: decision,
            customerSignals: {
              humanHelpRequested: fields.humanHelpRequested,
              escalationSignalCount: fields.escalationSignalCount
            }
          }
        })
      };
    }

    if (decision.reasonCode === "inside_return_window") {
      const returnReason = text(fields.returnReason) ?? DEFAULT_RETURN_REASON;

      if (fields.returnConditionConfirmed !== true) {
        if (fields.returnConditionConfirmed === false && returnReason !== "Item arrived damaged") {
          return {
            type: "request_confirmation",
            message:
              "Bookly self-service returns require the item to be unused and in its original condition and packaging. I cannot create an automatic return label, but I can create a support review ticket. Should I do that?",
            pendingAction: supportTicketAction({
              orderId,
              issueType: "return_condition_review",
              priority: "normal",
              summary: `Customer requested review for return condition on ${orderId}.`,
              context: { policyDecision: decision }
            })
          };
        }

        return {
          type: "ask_clarifying_question",
          message: `I found ${orderId} for ${itemTitle}, and it is inside the 30-day return window. Is the item unused and in its original condition and packaging?`,
          missingFields: ["returnConditionConfirmed"]
        };
      }

      return {
        type: "request_confirmation",
        message: `I can create a PDF return label for ${itemTitle}. Should I create it?`,
        pendingAction: {
          type: "create_return_label",
          description: `Create return label for ${itemTitle}`,
          orderId: orderId ?? "",
          itemSku: text(order?.sku) ?? "",
          returnReason,
          itemConditionConfirmed: true
        }
      };
    }

    if (decision.reasonCode === "outside_return_window") {
      return {
        type: "respond",
        message:
          `${decision.customerExplanation} I cannot create a self-service return label for it, but if there are special circumstances I can create a support review ticket.`
      };
    }

    if (decision.reasonCode === "manual_review_required") {
      return {
        type: "request_confirmation",
        message:
          `${decision.customerExplanation} Should I create a support ticket so the team can review ${orderId}?`,
        pendingAction: supportTicketAction({
          orderId,
          issueType: intent === "delivery_exception" ? "delivery_manual_review" : "return_manual_review",
          priority: "high",
          summary: `Manual review required for ${orderId}.`,
          context: { policyDecision: decision }
        })
      };
    }

    if (decision.recommendedAction === "offer_same_item_replacement") {
      const shippingOptions = getShippingOptions(fields);
      const sameItem = asRecord(shippingOptions?.sameItemOption);
      const guaranteed = sameItem?.guaranteedDelivery === true;
      return {
        type: "request_confirmation",
        message:
          `I found ${orderId}. The carrier has not recovered it, and a same-item replacement is available. ` +
          `It is estimated for ${sameItem?.estimatedDelivery}${guaranteed ? " and the carrier marks it guaranteed" : ", but it is not guaranteed"}. Please confirm I should send it to the ${text(order?.maskedAddress) ?? "address on the order"}.`,
        pendingAction: {
          type: "confirm_replacement_address",
          description: `Create same-item replacement for ${itemTitle}`,
          originalOrderId: orderId ?? "",
          replacementSku: text(sameItem?.sku) ?? text(order?.sku) ?? "",
          replacementTitle: text(sameItem?.title) ?? itemTitle ?? "same item",
          customerConfirmedSubstitute: false,
          estimatedDelivery: getOptionEstimatedDelivery(sameItem),
          guaranteedDelivery: guaranteed
        }
      };
    }

    if (decision.recommendedAction === "offer_substitute_replacement") {
      const substitute = getSubstituteOption(fields);
      const guaranteed = substitute?.guaranteedDelivery === true;
      return {
        type: "request_confirmation",
        message:
          `I found ${orderId}. The original edition is not available for a replacement that can arrive in time. ` +
          `We can offer ${substitute?.title} as a substitute, estimated for ${substitute?.estimatedDelivery}${guaranteed ? " with a carrier guarantee" : ", but not guaranteed"}. Is that substitute acceptable?`,
        pendingAction: {
          type: "approve_substitute",
          description: `Approve substitute replacement ${substitute?.title}`,
          originalOrderId: orderId ?? "",
          replacementSku: text(substitute?.sku) ?? "",
          replacementTitle: text(substitute?.title) ?? "the substitute",
          estimatedDelivery: getOptionEstimatedDelivery(substitute),
          guaranteedDelivery: guaranteed
        }
      };
    }

    if (decision.reasonCode === "not_missing_long_enough") {
      return {
        type: "request_confirmation",
        message:
          `${decision.customerExplanation} The latest carrier status still shows the package in transit. Should I create a support review ticket for the urgent timing?`,
        pendingAction: supportTicketAction({
          orderId,
          issueType: "delivery_timing_review",
          priority: "normal",
          summary: `Customer requested timing review before lost-package threshold for ${orderId}.`,
          context: { policyDecision: decision }
        })
      };
    }

    if (decision.recommendedAction === "create_support_ticket") {
      const priority = decision.reasonCode === "not_delivered" ? "normal" : "high";
      const issueType =
        decision.reasonCode === "not_delivered" ? "pre_delivery_return_review" : "delivery_exception_review";
      return {
        type: "request_confirmation",
        message: `${decision.customerExplanation} Should I create a${priority === "high" ? " priority" : ""} support ticket?`,
        pendingAction: supportTicketAction({
          orderId,
          issueType,
          priority,
          summary:
            decision.reasonCode === "not_delivered"
              ? `Customer requested return help before delivery for ${orderId}.`
              : `No automated replacement option can satisfy ${orderId}.`,
          context: { policyDecision: decision }
        })
      };
    }

    return {
      type: "respond",
      message: text(decision.customerExplanation) ?? "This request needs support review."
    };
}
