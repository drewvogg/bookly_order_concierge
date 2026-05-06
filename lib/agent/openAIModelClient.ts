import OpenAI from "openai";
import { validateWorkflowExtraction } from "./workflowExtractionValidator";
import { extractDeterministicWorkflowUpdate } from "./workflowPlanner";
import { DEMO_TODAY, type AgentInput, type ResponseRenderInput, type WorkflowExtraction } from "./types";
import type { ModelClient } from "./modelClient";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { asRecord, isRecord } from "@/lib/utils/typeGuards";

const defaultOpenAIModel = "gpt-5-nano";
const maxValidationRetries = 2;
const genericItemHints = new Set(["book", "the book", "item", "the item", "order", "the order"]);

const extractionContract = `Return only JSON with this shape:
{
  "workflowStateUpdates": {
    "intent"?: "order_status" | "delivery_exception" | "return_or_refund" | "shipping_policy" | "password_reset" | "unknown",
    "email"?: string,
    "zipCode"?: string,
    "orderId"?: string,
    "itemHint"?: string,
    "customerDeadline"?: "YYYY-MM-DD",
    "customerDeadlineParseFailed"?: boolean,
    "returnReason"?: string,
    "returnConditionConfirmed"?: boolean
  },
  "confirmationIntent": "confirm" | "reject" | "unclear",
  "asksForAddress": boolean,
  "customerSignals": Array<"frustration" | "urgency" | "human_help" | "exception_request">
}

Extraction rules:
- Extract only facts present in the latest user message or clear from the immediate conversation context.
- Order lookup identity supports only orderId, or email plus zipCode. Book title can be itemHint only.
- Do not set itemHint to generic words like "book", "item", or "order"; omit itemHint unless the user names a specific title or edition.
- Always classify obvious requests: returns/refunds/labels as return_or_refund; late/missing/stuck delivery or replacement requests as delivery_exception; tracking/status questions as order_status.
- Use ${DEMO_TODAY} as the demo date for relative dates like today/tomorrow.
- If the user appears to provide a deadline but it cannot be normalized to YYYY-MM-DD, set customerDeadlineParseFailed true.
- Mark confirmationIntent for short yes/no answers when the previous assistant question was a yes/no or confirmation question.
- Mark returnConditionConfirmed true for answers that mean unused/original condition/packaging is satisfied; false for used/opened/not original.
- Mark human_help for explicit requests for a human, person, representative, manager, or support teammate.
- Mark frustration for angry or clearly dissatisfied tone.
- Mark urgency for urgent timing pressure beyond routine date/deadline information. Do not mark urgency for a neutral delivery date such as "tomorrow" unless the customer is clearly pressuring or upset.
- Mark exception_request when the user asks for an exception, special review, or special circumstances.
- Do not include tool outputs or policy decisions in workflowStateUpdates.`;

const responseContract = `Return only JSON with this shape:
{ "message": string }

Response rules:
- The workflow planner has already selected the legal next step. Do not change the action, policy result, IDs, URLs, dates, or required confirmation.
- If plannerSelectedStep.type is ask_clarifying_question, ask only for the missing information in plannerSelectedStep.missingFields.
- If plannerSelectedStep.type is request_confirmation, ask for the exact confirmation implied by plannerSelectedStep.pendingAction and do not imply the action has already happened.
- If plannerSelectedStep.type is respond, answer using defaultPlannerMessage as the source of truth.
- Use only facts from the provided state, trace, and planner message.
- Preserve required alternatives from defaultPlannerMessage, especially "order number, or email and zip code" identity options.
- Do not expose internal object fields such as pendingAction.type, issueType, summary, policy reason codes, or workflow state keys.
- Do not tell the user they must reply with an exact phrase. A normal yes/no confirmation is enough.
- Do not offer or imply unsupported actions: emailing labels, scheduling pickups, contacting carriers, sending tracking updates, changing addresses, cancelling orders, or issuing refunds directly.
- Use "zip code" in customer-facing identity language.
- Use customer-facing terms like "order number" instead of internal field names like "orderId".
- Keep the response to one or two concise sentences unless a label URL or order list requires more.
- Keep the response warm, concise, and operationally clear.`;

function getMessageFromResponse(value: unknown) {
  if (!isRecord(value) || typeof value.message !== "string" || value.message.trim() === "") {
    throw new Error("Response render output must be an object with a non-empty message string.");
  }

  return value.message.trim();
}

function isConcreteIntent(value: unknown) {
  return typeof value === "string" && value !== "unknown";
}

function normalizeWorkflowExtraction(input: {
  userMessage: string;
  extraction: WorkflowExtraction;
  fallbackExtraction: WorkflowExtraction;
}): WorkflowExtraction {
  const extractedUpdates = { ...(input.extraction.workflowStateUpdates ?? {}) };
  const fallbackUpdates = input.fallbackExtraction.workflowStateUpdates ?? {};
  const itemHint = typeof extractedUpdates.itemHint === "string" ? extractedUpdates.itemHint.trim().toLowerCase() : "";

  if (genericItemHints.has(itemHint)) {
    delete extractedUpdates.itemHint;
  }

  if (extractedUpdates.intent === "unknown" && isConcreteIntent(fallbackUpdates.intent)) {
    delete extractedUpdates.intent;
  }

  const latestMessageIsShortConfirmation =
    (input.extraction.confirmationIntent === "confirm" || input.extraction.confirmationIntent === "reject") &&
    input.userMessage.trim().split(/\s+/).length <= 5;

  if (latestMessageIsShortConfirmation && !fallbackUpdates.returnReason) {
    delete extractedUpdates.returnReason;
  }

  return {
    ...input.extraction,
    workflowStateUpdates: {
      ...fallbackUpdates,
      ...extractedUpdates
    },
    confirmationIntent:
      input.extraction.confirmationIntent === "unclear"
        ? input.fallbackExtraction.confirmationIntent
        : input.extraction.confirmationIntent,
    asksForAddress: input.extraction.asksForAddress || input.fallbackExtraction.asksForAddress,
    customerSignals: input.extraction.customerSignals ?? []
  };
}

function safePlannerStep(step: ResponseRenderInput["step"]) {
  if (step.type === "ask_clarifying_question") {
    return {
      type: step.type,
      message: step.message,
      missingFields: step.missingFields
    };
  }

  if (step.type === "request_confirmation") {
    return {
      type: step.type,
      message: step.message,
      pendingActionDescription: step.pendingAction.description
    };
  }

  if (step.type === "respond") {
    return {
      type: step.type,
      message: step.message
    };
  }

  return {
    type: step.type
  };
}

function responseFacts(state: ResponseRenderInput["state"]) {
  const activeOrder = asRecord(state.workflowState.activeOrder);
  const ticket = asRecord(state.workflowState.ticket);
  const replacement = asRecord(state.workflowState.replacement);

  return {
    intent: state.workflowState.intent,
    activeOrder: activeOrder
      ? {
          orderId: activeOrder.orderId,
          itemTitle: activeOrder.itemTitle,
          maskedAddress: activeOrder.maskedAddress
        }
      : undefined,
    labelId: state.workflowState.labelId,
    downloadUrl: state.workflowState.downloadUrl,
    expiresAt: state.workflowState.expiresAt,
    replacementOrderId: replacement?.replacementOrderId,
    ticketId: ticket?.ticketId,
    ticketPriority: ticket?.priority,
    recentTrace: state.traceEvents.slice(-6).map((event) => ({
      eventType: event.eventType,
      title: event.title,
      resultSummary: event.resultSummary,
      toolName: event.toolName,
      policySource: event.policySource
    }))
  };
}

export class OpenAIModelClient implements ModelClient {
  private client: OpenAI;

  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is required when LLM_MODE=live.");
    }
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  private async requestJson(messages: ChatCompletionMessageParam[]) {
    try {
      const response = await this.client.chat.completions.create({
        model: process.env.OPENAI_MODEL ?? defaultOpenAIModel,
        temperature: 1,
        response_format: { type: "json_object" },
        messages
      });

      const content = response.choices[0]?.message.content;
      if (!content) {
        throw new Error("The model returned an empty response.");
      }

      return content;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown OpenAI API error";
      throw new Error(`Live LLM request failed. Check OPENAI_API_KEY and OPENAI_MODEL. ${message}`);
    }
  }

  async extractWorkflowUpdate(input: AgentInput): Promise<WorkflowExtraction> {
    const fallbackExtraction = extractDeterministicWorkflowUpdate(input);
    const messages: ChatCompletionMessageParam[] = [
      {
        role: "system",
        content:
          "You extract structured workflow updates for Bookly Order Concierge. You do not decide policy, choose tools, or write customer-facing responses.\n\n" +
          extractionContract
      },
      {
        role: "user",
        content: JSON.stringify({
          latestUserMessage: input.userMessage,
          conversationState: input.state
        })
      }
    ];

    let lastValidationError = "Unknown validation error";
    for (let attempt = 0; attempt <= maxValidationRetries; attempt += 1) {
      const content = await this.requestJson(messages);
      try {
        const extraction = validateWorkflowExtraction(JSON.parse(content));

        return normalizeWorkflowExtraction({
          userMessage: input.userMessage,
          extraction,
          fallbackExtraction
        });
      } catch (error) {
        lastValidationError = error instanceof Error ? error.message : "Unknown validation error";
        console.error("[bookly-agent] Live LLM returned invalid workflow extraction", {
          attempt: attempt + 1,
          maxAttempts: maxValidationRetries + 1,
          content,
          error
        });

        messages.push({ role: "assistant", content });
        if (attempt < maxValidationRetries) {
          messages.push({
            role: "user",
            content:
              `The previous extraction failed validation: ${lastValidationError}\n` +
              "Return corrected JSON only. Do not explain the correction."
          });
        }
      }
    }

    console.error("[bookly-agent] Falling back to deterministic extraction after Live extraction failures", {
      error: lastValidationError
    });
    return fallbackExtraction;
  }

  async renderResponse(input: ResponseRenderInput): Promise<string> {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `You write customer-facing replies for Bookly Order Concierge.\n\n${responseContract}`
      },
      {
        role: "user",
        content: JSON.stringify({
          latestUserMessage: input.userMessage,
          plannerSelectedStep: safePlannerStep(input.step),
          defaultPlannerMessage: input.defaultMessage,
          responseFacts: responseFacts(input.state)
        })
      }
    ];

    let lastValidationError = "Unknown validation error";
    for (let attempt = 0; attempt <= maxValidationRetries; attempt += 1) {
      const content = await this.requestJson(messages);
      try {
        return getMessageFromResponse(JSON.parse(content));
      } catch (error) {
        lastValidationError = error instanceof Error ? error.message : "Unknown validation error";
        console.error("[bookly-agent] Live LLM returned invalid response render output", {
          attempt: attempt + 1,
          maxAttempts: maxValidationRetries + 1,
          content,
          error
        });

        messages.push({ role: "assistant", content });
        if (attempt < maxValidationRetries) {
          messages.push({
            role: "user",
            content:
              `The previous response failed validation: ${lastValidationError}\n` +
              "Return corrected JSON only. Do not explain the correction."
          });
        }
      }
    }

    console.error("[bookly-agent] Falling back to planner response after Live response-render failures", {
      error: lastValidationError
    });
    return input.defaultMessage;
  }
}
