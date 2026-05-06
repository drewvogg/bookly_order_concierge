# Bookly Order Concierge — Codex Build Brief

## Read This First

You are helping build a polished but appropriately scoped take-home demo for a Solutions Engineering interview at Decagon.

The candidate is building an AI customer support agent for **Bookly**, a fictional online bookstore. The assignment asks for:

- A simple interactive chat or voice demo
- At least one multi-turn interaction
- At least one example of the agent using a tool or taking an action, real or mocked
- At least one case where the agent asks a clarifying question instead of answering immediately
- A one-page design document explaining architecture, conversation design, hallucination/safety controls, and production-readiness tradeoffs
- A prototype/demo via GitHub repo with clear run instructions and/or a 2-minute recording

The assignment explicitly emphasizes thoughtful design and workflow orchestration over production-ready code. Do not build a massive production system. Build a small, crisp, impressive prototype that demonstrates agent architecture, tool orchestration, safety gates, and tradeoff thinking.

The assignment PDF may be available locally in the repo or working directory as a private reference. Do not commit it. It is only for context.

Suggested local path for the assignment PDF:

```txt
.local/SE Take-Home Final.pdf
```

Suggested `.gitignore` entry:

```txt
.local/
```

Do not reference assignment PDF citations in generated user-facing repo content. Keep the repo self-contained.

---

# Product Concept

## Agent Name

**Bookly Order Concierge**

## Agent Scope

Bookly Order Concierge is a conversational AI support agent for Bookly, a fictional online bookstore. It helps customers with:

- Order status
- Delivery exceptions / delayed gift rescue
- Return/refund requests
- Replacement options
- Escalation when policy requires support review

The agent should not be named or scoped as a “Gift Rescue Agent.” The delayed gift scenario is the hero demo flow, but the agent should feel broader: an order and return support concierge.

## Core Story

The hero demo should show a customer whose order is delayed and needed as a gift. The agent:

1. Asks for enough information to identify the order.
2. Looks up the order.
3. Checks carrier/tracking status.
4. Checks replacement inventory.
5. Applies Bookly policy.
6. Explains the available option.
7. Confirms whether a substitute replacement is acceptable.
8. Confirms address.
9. Creates a replacement order.
10. Shows all tool calls and policy decisions in a trace panel.

The demo should feel like a small version of a Decagon-style AI support agent: not just an LLM wrapper, but an agent runtime with tools, policies, confirmation gates, and traceability.

---

# Important Product/Architecture Philosophy

## Mocked Data, Not Mocked Architecture

Use mocked data for Bookly systems, because Bookly is fictional.

But do not make the architecture feel like a hardcoded chatbot. Business systems should sit behind service/client/repository boundaries so the app looks like it could be swapped to real systems later.

Correct architecture:

```txt
Chat UI
  → /api/chat
  → Agent Orchestrator
  → ModelClient
      → DemoModelClient
      → OpenAIModelClient
  → Tool Registry
  → Bookly service clients
  → Mock OMS / Carrier / Inventory / Policy / Returns / Ticketing data
  → Customer-facing response + trace events
```

The business systems are mocked. The orchestration pattern is real.

## Agent vs LLM

The agent is not simply “the LLM.” The agent is the runtime around the LLM:

```txt
Agent runtime
  ├── LLM/model client
  ├── system prompt
  ├── conversation state
  ├── tool registry
  ├── policy evaluator
  ├── safety/confirmation gates
  └── trace generator
```

The LLM is the language/reasoning engine. Tools are things the LLM can request and the application executes.

The agent should not adjudicate policies purely through free-form LLM reasoning. The LLM can help route intent and explain outcomes, but deterministic business/policy decisions should happen in code.

---

# Scope Control

This should be impressive, not bloated.

Prioritize:

1. One excellent end-to-end hero flow
2. One return flow with a real generated PDF label
3. One escalation/safety flow
4. A clean two-panel UI with traceability
5. A crisp README and design-doc notes

Do not overbuild:

- No real UPS/FedEx/USPS APIs
- No real payments APIs
- No real customer authentication
- No real external database
- No Redis
- No Prisma/SQLite unless explicitly requested later
- No voice interface
- No admin dashboard
- No complex styling
- No multi-provider LLM implementation unless the core demo is already done

If time is tight, build fewer files than the ideal repo structure. A smaller repo with clear architecture is better than a large incomplete repo.

---

# Chosen Tech Stack

Use:

- Next.js App Router
- TypeScript
- React
- Tailwind or simple CSS
- OpenAI SDK for Live LLM mode
- `pdf-lib` for dynamic demo return-label PDF generation
- `cross-env` for cross-platform npm scripts
- Seeded JSON data
- No external database

## Node Version

Use Node 24 LTS.

`.nvmrc`:

```txt
24
```

`package.json`:

```json
{
  "engines": {
    "node": ">=24 <25",
    "npm": ">=11"
  }
}
```

Do not require nvm. README should say:

```txt
Use Node 24 LTS. If you use nvm, run `nvm use`; otherwise install Node 24 using your preferred method.
```

---

# NPM Scripts

Use Demo Model as the default because it works without an API key.

```json
{
  "scripts": {
    "dev": "cross-env LLM_MODE=demo next dev",
    "dev:demo": "cross-env LLM_MODE=demo next dev",
    "dev:live": "cross-env LLM_MODE=live next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit"
  }
}
```

## Mode Behavior

### Demo Model Mode

```txt
LLM_MODE=demo
```

- Default local mode
- No API key required
- Uses `DemoModelClient`
- Deterministic demo flows
- Should still exercise the same orchestrator, tools, policy evaluator, action generation, and trace panel
- Should not be a fake final-response-only transcript

### Live LLM Mode

```txt
LLM_MODE=live
```

- Uses `OpenAIModelClient`
- Requires `OPENAI_API_KEY`
- Calls the real OpenAI API
- Uses the same tools, policies, traces, and conversation state
- This is the version to use in the Vercel-hosted demo if deployed

## Environment Variables

`.env.example`:

```env
OPENAI_API_KEY=
LLM_MODE=demo
DEMO_ACCESS_CODE=
```

`.gitignore` should include:

```txt
.env
.env.local
.env.*.local
.local/
.next/
node_modules/
```

---

# UI Requirements

Build a simple, polished two-panel web app.

## Left Panel: Chat

Include:

- Chat history
- Text input
- Send button
- “New Conversation” button
- Optional demo scenario selector or helper buttons, if easy

The user should be able to type arbitrary messages. The suggested demo scripts should work reliably.

## Right Panel: Agent Trace

Include:

- Mode badge: “Demo Model” or “Live LLM”
- Current intent
- Missing required fields
- Tool calls
- Policy checks
- Pending action / confirmation gate
- Final action result

Do not expose raw chain-of-thought. Show structured application-level trace events only.

Example trace event:

```json
{
  "eventType": "tool_call",
  "toolName": "evaluatePolicy",
  "inputSummary": "delivery_exception for order BK-1002",
  "resultSummary": "same item unavailable; substitute available; approval required",
  "policySource": "data/aops/delivery-exceptions.md"
}
```

## Session Reset

Add a “New Conversation” button.

Each new conversation should clear:

- Messages
- Collected slots
- Pending action
- Trace events

Do not run all demo scenarios in one continuous chat thread. Different customers should be separate conversations.

---

# Suggested Repo Structure

This is an ideal structure. If it feels too large during implementation, consolidate, but preserve the architectural boundaries.

```txt
bookly-order-concierge/
  app/
    page.tsx
    api/
      chat/route.ts
      mock/
        orders/route.ts
        tracking/[trackingNumber]/route.ts
        inventory/route.ts
        replacements/route.ts
        support-ticket/route.ts
        return-labels/route.ts
      labels/[labelId]/route.ts

  components/
    ChatPanel.tsx
    TracePanel.tsx
    ModeBadge.tsx
    DemoScenarioSelector.tsx

  data/
    customers.json
    orders.json
    tracking.json
    inventory.json
    policies.json
    actions.json

  data/aops/
    delivery-exceptions.md
    returns-and-refunds.md
    replacements.md
    escalation.md

  lib/
    agent/
      orchestrator.ts
      systemPrompt.ts
      types.ts
      modelClient.ts
      demoModelClient.ts
      openAIModelClient.ts
      toolRegistry.ts
      trace.ts
    clients/
      orderClient.ts
      carrierClient.ts
      inventoryClient.ts
      supportClient.ts
      returnsClient.ts
    repositories/
      customerRepository.ts
      orderRepository.ts
      trackingRepository.ts
      inventoryRepository.ts
      actionRepository.ts
    tools/
      lookupOrder.ts
      getTrackingStatus.ts
      checkReplacementInventory.ts
      evaluatePolicy.ts
      createReplacementOrder.ts
      createReturnLabel.ts
      createSupportTicket.ts
    policies/
      evaluatePolicy.ts
      policyTypes.ts
    pdf/
      generateReturnLabel.ts

  docs/
    design-doc-notes.md

  .env.example
  .gitignore
  .nvmrc
  package.json
  README.md
```

## Practical Simplification

If this structure feels too large, collapse into:

```txt
lib/
  agent/
  data/
  tools/
  policies/
  pdf/
```

Do not let file count become the goal. Working demo + clear architecture is the goal.

---

# Runtime Policy Design

## AOP Markdown vs Executable Policy

Include AOP-style Markdown files because they make the policies reviewable and closer to a natural-language operating-procedure model.

But do **not** let the LLM read Markdown and make runtime eligibility decisions.

Correct model:

```txt
Human-readable AOP Markdown files
  → manually encoded executable policy logic
  → evaluatePolicy tool returns structured decision
  → LLM explains structured decision to the customer
```

The Markdown files are documentation / explainability artifacts.

The runtime decision authority is:

```txt
lib/policies/evaluatePolicy.ts
data/policies.json
```

The `evaluatePolicy` result can point back to the Markdown source via `policySource`.

This is a hallucination control: the LLM does not calculate policy eligibility from prose.

## Policies JSON

`data/policies.json`:

```json
{
  "returnWindowDays": 30,
  "lostPackageMinimumHoursWithoutScan": 48,
  "manualReviewOrderValueThreshold": 200,
  "replacementRequiresCustomerConfirmation": true,
  "substituteRequiresExplicitApproval": true,
  "neverGuaranteeDeliveryUnlessToolSaysGuaranteed": true,
  "manualReviewFlags": [
    "high_value_item",
    "signed_collectible",
    "manual_review_required"
  ]
}
```

## AOP Markdown Files

### `data/aops/delivery-exceptions.md`

Include:

```md
# Delivery Exception Procedure

A replacement can be considered when:
- The order has a carrier exception or no recovery scan.
- The package has had no meaningful scan for at least 48 hours.
- The estimated delivery is missing or outside the promised/customer-needed window.
- The order does not require manual review.
- Replacement inventory is available.

When handling a delayed gift:
1. Identify the order.
2. Check tracking status.
3. Ask for the customer’s deadline if it was not provided.
4. Check whether the same item can arrive before the deadline.
5. If the same item can arrive before the deadline, offer it first.
6. If the same item cannot arrive before the deadline but an approved substitute can, explain the substitution and ask whether it is acceptable.
7. If no option can arrive before the deadline, offer a priority support case.
8. Do not describe expected delivery as guaranteed unless the tool marks it as guaranteed.
9. Confirm shipping address and customer approval before creating a replacement.
```

### `data/aops/returns-and-refunds.md`

Include:

```md
# Returns and Refunds Procedure

Bookly’s standard return window is 30 days from delivery.

Eligible returns require:
- Order identification
- Item identification
- Return reason
- Policy eligibility
- Customer confirmation before label creation

If an order is outside the return window:
- Explain that self-service returns are unavailable.
- If the customer asks for an exception or provides special circumstances, offer a support review.

High-value, signed, collectible, or manually flagged items require support review.

Never expose payment card details, payment tokens, or sensitive billing information.
```

### `data/aops/replacements.md`

Include:

```md
# Replacement Procedure

Replacement orders are customer-impacting actions and require explicit confirmation.

Substitute replacements require explicit approval of the specific substitute item.

Approved substitutes must come from inventory/product data. The agent must not invent similar products.

If a customer rejects the available replacement/substitute, offer a support ticket or explain other available options.
```

### `data/aops/escalation.md`

Include:

```md
# Escalation Procedure

Create a support ticket when:
- Policy requires manual review.
- The customer asks for an exception.
- Verification is insufficient.
- The issue involves high-value or special-handling items.
- Available tools cannot resolve the issue.
- The customer rejects available self-service options.

Do not accuse customers of fraud. Use neutral language such as “this requires support review.”
```

---

# System Prompt

Create `lib/agent/systemPrompt.ts` and export a system prompt like this:

```txt
You are Bookly Order Concierge, an AI customer support agent for Bookly, a fictional online bookstore.

You help customers with order status, delayed deliveries, replacement options, returns, refunds, and shipping-policy questions.

Core rules:
- Use tools before making order-specific claims.
- Do not invent order status, delivery dates, refund eligibility, inventory, replacement options, or policy exceptions.
- When required information is missing, ask the smallest focused follow-up question needed to continue.
- Continue collecting required fields until the workflow can proceed, the customer declines, or escalation is needed.
- Do not ask for every possible field upfront unless the workflow requires it.
- Before taking customer-impacting actions, such as creating a replacement order, return label, refund request, or support ticket, ask for explicit confirmation.
- Never describe expected delivery as guaranteed unless the tracking/shipping tool explicitly says it is guaranteed.
- Do not reveal full shipping addresses until the customer has passed lightweight verification.
- Use masked address confirmation when possible, such as “the address ending in 60614.”
- Never expose payment card details, payment tokens, or sensitive billing information.
- Do not accuse customers of fraud. If policy or risk checks require review, explain that the request requires support review.
- Escalate when the policy evaluator says manual review is required, when the customer asks for an exception, when identity/order verification is insufficient, or when available tools cannot resolve the issue.
- Keep responses warm, concise, and operationally clear.
```

---

# Conversation and Decision Design

## Intent Definition

Intent means “what support workflow is the customer trying to accomplish.”

Use:

```ts
type Intent =
  | "order_status"
  | "delivery_exception"
  | "return_or_refund"
  | "shipping_policy"
  | "password_reset"
  | "unknown";
```

Risk/fraud/special handling is not the initial user intent. It is a policy/risk outcome after order lookup and policy evaluation.

Examples:

```txt
Customer intent: return_or_refund
Policy outcome: outside_return_window

Customer intent: return_or_refund
Policy outcome: high_value_manual_review_required
```

## Decision Pattern

The agent should follow this general loop:

```txt
1. Identify intent.
2. Check whether required fields are present.
3. If required fields are missing, ask the smallest focused follow-up question.
4. If data is needed, call tools.
5. If policy is needed, call evaluatePolicy.
6. If action is customer-impacting, ask for explicit confirmation.
7. If confirmed and policy allows, take action.
8. If policy blocks or requires review, explain and offer escalation.
9. If the request is unsupported, escalate or provide a safe alternative.
```

Do not ask for every possible field upfront. Ask only what is needed next.

## Required Fields by Workflow

### Order Lookup

Require one of:

```txt
- orderId
- email + zipCode
```

If email is provided without ZIP/order ID, ask for ZIP before exposing order-specific details.

### Delivery Exception

Need:

```txt
- order identity
- tracking status
- customer deadline if time-sensitive
```

### Replacement Creation

Need:

```txt
- originalOrderId
- replacementSku
- explicit approval of substitute, if substitute
- masked shipping address confirmation
- explicit customer approval to create replacement
```

### Return Label

Need:

```txt
- order identity
- item being returned
- return reason
- policy eligibility
- confirmation before label creation
```

### Support Ticket

Need:

```txt
- issue type
- summary
- context
- confirmation when customer-impacting
```

---

# Model Client Interface

Create a model abstraction:

```ts
export interface ModelClient {
  nextStep(input: AgentInput): Promise<AgentStep>;
}
```

Implement:

```txt
DemoModelClient
OpenAIModelClient
```

## DemoModelClient

The Demo Model must not just return canned final responses.

It should return structured steps/tool calls so the normal orchestrator still runs.

For example, for the delayed gift scenario:

```txt
User says delayed gift
  → DemoModelClient returns ask_clarifying_question for email + ZIP or order number

User provides Ava email + ZIP and The Hobbit
  → returns tool_call lookupOrder

Tool result returns BK-1002
  → returns tool_call getTrackingStatus

Tool result indicates exception
  → returns tool_call checkReplacementInventory

Inventory says same item unavailable, substitute available
  → returns tool_call evaluatePolicy

Policy says offer substitute
  → returns request_confirmation asking if paperback substitute is acceptable

User confirms substitute
  → request address confirmation if needed

User confirms same address
  → tool_call createReplacementOrder

Tool result replacement created
  → respond with final summary
```

This makes Demo Model mode exercise the real orchestrator/tools/policy/trace flow.

## OpenAIModelClient

Use OpenAI tool calling if practical.

Set temperature to `0`.

Rationale:
- support workflows need consistency, policy adherence, and repeatable tool selection
- do not claim this makes outputs perfectly deterministic
- validate behavior through tool-call traces and state, not exact response text

If tool calling becomes too time-consuming, use a structured JSON response format from the model and map it to `AgentStep`. But tool calling is preferred.

---

# Agent Step Shape

Use an internal shape like this:

```ts
type AgentStep =
  | {
      type: "respond";
      message: string;
      trace?: TraceEvent[];
    }
  | {
      type: "tool_call";
      toolName: ToolName;
      args: Record<string, unknown>;
    }
  | {
      type: "ask_clarifying_question";
      message: string;
      missingFields: string[];
    }
  | {
      type: "request_confirmation";
      message: string;
      pendingAction: PendingAction;
    };
```

Tool names:

```ts
type ToolName =
  | "lookupOrder"
  | "getTrackingStatus"
  | "checkReplacementInventory"
  | "evaluatePolicy"
  | "createReplacementOrder"
  | "createReturnLabel"
  | "createSupportTicket";
```

---

# Conversation State

Each conversation should have isolated state:

```ts
type ConversationState = {
  conversationId: string;
  messages: ChatMessage[];
  collectedSlots: Record<string, unknown>;
  pendingAction?: PendingAction;
  traceEvents: TraceEvent[];
};
```

State can be client-side for the demo if easier, but `/api/chat` must receive enough context each turn to continue the workflow.

---

# Tools

Implement these tools:

```txt
lookupOrder
getTrackingStatus
checkReplacementInventory
evaluatePolicy
createReplacementOrder
createReturnLabel
createSupportTicket
```

## `lookupOrder`

Input:

```ts
{
  orderId?: string;
  email?: string;
  zipCode?: string;
  itemHint?: string;
}
```

Rules:
- If `orderId` is provided, verify against customer email or ZIP if available.
- If only email is provided, ask for ZIP before exposing order-specific details.
- Return matching orders with minimal safe details.
- For multi-order accounts, return likely relevant orders but avoid over-disclosing irrelevant very old orders unless the customer specifically asks.

Output example:

```ts
{
  matches: [
    {
      orderId: "BK-1002",
      customerId: "cust_ava",
      itemTitle: "The Hobbit - Deluxe Hardcover Edition",
      sku: "HOBBIT-DELUXE-HC",
      trackingNumber: "1ZBOOKLY1002",
      deliveryZip: "60614",
      maskedAddress: "address ending in 60614"
    }
  ]
}
```

## `getTrackingStatus`

Input:

```ts
{
  trackingNumber: string;
}
```

Output:

```ts
{
  trackingNumber: string;
  carrier: string;
  status: "in_transit" | "delivered" | "exception" | "no_recent_scan";
  statusDetail: string;
  lastScanAt: string;
  estimatedDelivery?: string;
  guaranteedDelivery: boolean;
  hoursSinceLastScan: number;
}
```

## `checkReplacementInventory`

Input:

```ts
{
  originalSku: string;
  zipCode: string;
  customerDeadline?: string;
}
```

Output should include:
- same-item option if available
- approved substitute options only
- estimated delivery date
- whether estimated delivery is inside customer deadline
- whether delivery is guaranteed

Do not let the LLM invent substitutes. Approved substitutes must come from seed data.

Output example:

```ts
{
  originalSku: "HOBBIT-DELUXE-HC",
  sameItemOption: {
    available: false,
    estimatedDelivery: null,
    arrivesByDeadline: false
  },
  substituteOptions: [
    {
      sku: "HOBBIT-PAPERBACK",
      title: "The Hobbit - Paperback Edition",
      substitutionReason: "Same book, different format",
      estimatedDelivery: "2026-05-06",
      arrivesByDeadline: true,
      guaranteedDelivery: false,
      requiresCustomerApproval: true
    }
  ]
}
```

## `evaluatePolicy`

This is the most important safety tool.

Input:

```ts
{
  issueType: "delivery_exception" | "return_request" | "replacement_request" | "refund_request";
  orderId: string;
  context?: Record<string, unknown>;
}
```

Output:

```ts
{
  eligible: boolean;
  recommendedAction:
    | "answer"
    | "ask_clarifying_question"
    | "offer_same_item_replacement"
    | "offer_substitute_replacement"
    | "create_return_label"
    | "create_support_ticket"
    | "deny_self_service_action";
  reasonCode: string;
  customerExplanation: string;
  requiresConfirmation: boolean;
  policySource: string;
}
```

The LLM explains this result. It does not adjudicate the policy itself.

Policy scenarios:
- replacement requires at least 48 hours without scan/recovery
- replacement blocked if manual review flags exist
- same-item replacement preferred when available and can arrive in time
- substitute replacement requires explicit customer approval
- outside return window blocks self-service label
- outside return window can escalate if customer asks for exception
- high-value/special handling requires manual review

## `createReplacementOrder`

Input:

```ts
{
  originalOrderId: string;
  replacementSku: string;
  customerConfirmedSubstitute: boolean;
  customerConfirmedAddress: boolean;
}
```

Rules:
- Only run after explicit confirmation.
- Create a mock replacement action record.
- Return replacement order ID.
- In demo, can store created actions in memory.

Output:

```ts
{
  replacementOrderId: "RBK-5001",
  status: "created",
  estimatedDelivery: "2026-05-06",
  guaranteedDelivery: false
}
```

## `createReturnLabel`

Input:

```ts
{
  orderId: string;
  itemSku: string;
  returnReason: string;
}
```

Use `pdf-lib` to generate a dynamic PDF return label.

Output:

```ts
{
  labelId: "RL-9001",
  downloadUrl: "/api/labels/RL-9001",
  expiresAt: "2026-05-12"
}
```

PDF should include:

```txt
Bookly Demo Return Label
Customer name
Return address
Return center address
Order ID
Item
Return reason
DEMO LABEL — NOT VALID FOR SHIPPING
```

If storing PDFs on Vercel is awkward, generate the PDF dynamically in `/api/labels/[labelId]/route.ts` from label metadata stored in memory or encoded in state. For local/demo purposes, in-memory is acceptable.

## `createSupportTicket`

Input:

```ts
{
  orderId?: string;
  issueType: string;
  priority: "normal" | "high";
  summary: string;
  context: Record<string, unknown>;
}
```

Output:

```ts
{
  ticketId: "TCK-7001",
  status: "created",
  priority: "high"
}
```

---

# Seed Data

Use neutral fake customers. Do not use obvious labels like `fraud@example.com` because it may poison model behavior.

## Customer 1: Ava Morgan

Purpose: delayed gift delivery scenarios.

```txt
ava.morgan@example.com
ZIP: 60614
```

Ava should have four orders.

### Ava Order A: Same item can arrive in time

```txt
Order: BK-1001
Item: The Hobbit - Deluxe Hardcover Edition
SKU: HOBBIT-DELUXE-HC
Tracking: exception/no recent scan
Hours since last scan: 60
Customer deadline scenario: tomorrow evening
Same item available for expedited replacement
Estimated delivery: tomorrow
Guaranteed: false
```

Expected behavior:
- Agent can offer same-item expedited replacement.
- Agent must say estimated, not guaranteed.
- Agent must confirm address and approval before creating replacement.

### Ava Order B: Same item unavailable, approved substitute can arrive in time

```txt
Order: BK-1002
Item: The Hobbit - Deluxe Hardcover Edition
SKU: HOBBIT-DELUXE-HC
Tracking: exception/no recent scan
Hours since last scan: 72
Same item unavailable
Approved substitute: The Hobbit - Paperback Edition
Substitute SKU: HOBBIT-PAPERBACK
Estimated delivery: tomorrow
Guaranteed: false
```

Expected behavior:
- Agent explains same edition is unavailable.
- Agent offers paperback as approved substitute.
- Agent asks whether substitute is acceptable.
- If customer says yes, confirm address and create replacement.
- If customer says no, offer support ticket.

This should be the hero screen-recording path.

### Ava Order C: No option can arrive in time

```txt
Order: BK-1003
Item: Dune - Collector's Edition
SKU: DUNE-COLLECTOR-HC
Tracking: exception/no recent scan
Hours since last scan: 80
Same item not available in time
No approved substitute available in time
```

Expected behavior:
- Agent does not invent a replacement.
- Agent offers to create priority support ticket.

### Ava Order D: Package has not been missing long enough

```txt
Order: BK-1004
Item: Foundation - Paperback
SKU: FOUNDATION-PB
Tracking: no recent scan
Hours since last scan: 8
Same item available
Estimated delivery possible
Policy minimum for replacement: 48 hours without scan/recovery
```

Expected behavior:
- Agent says it cannot mark the package lost or create replacement yet.
- Agent can explain the most recent tracking state.
- Agent can offer to create a support ticket if customer wants review or if deadline is urgent.

## Customer 2: Sam Rivera

Purpose: return/refund workflow with multiple orders.

```txt
sam.rivera@example.com
ZIP: 94110
```

Sam should have three orders.

### Sam Order A: Eligible return

```txt
Order: BK-2001
Item: Project Hail Mary - Paperback
Delivered: 10 days ago
Return window: 30 days
Returnable: true
```

Expected behavior:
- If customer asks to return recent order, agent can create return label after reason and confirmation.

### Sam Order B: Outside window but somewhat recent

```txt
Order: BK-2002
Item: The Martian - Hardcover
Delivered: 50 days ago
Return window: 30 days
Returnable: false
Reason: outside_return_window
```

Expected behavior:
- Agent explains outside 30-day return window.
- If customer asks for an exception, offer support ticket.
- Do not create return label.

### Sam Order C: Very old order

```txt
Order: BK-2003
Item: Old Man's War - Paperback
Delivered: 400 days ago
Return window: 30 days
Returnable: false
```

Expected behavior:
- Agent should not prioritize this order unless the customer specifically names it.
- If mentioned, agent explains it is far outside return window and can offer support review only if customer asks.

Multi-order lookup behavior:
- If Sam says “I want to return an order” without specifying which, agent should ask which order/item.
- It may mention recent likely candidates.
- Better phrasing: “I found a few recent orders. Are you asking about Project Hail Mary or The Martian?”
- Do not mention the 400-day-old order unless the customer specifically names it.

## Customer 3: Jordan Lee

Purpose: special handling / manual review.

```txt
jordan.lee@example.com
ZIP: 10003
```

```txt
Order: BK-3001
Item: Signed First Edition - The Left Hand of Darkness
SKU: LEFT-HAND-SIGNED
Order value: 425
Risk flags: high_value_item, signed_collectible, manual_review_required
Delivered: 20 days ago
```

Expected behavior:
- Valid order exists.
- Agent should not accuse customer of fraud.
- `evaluatePolicy` returns manual review required.
- Agent cannot self-serve refund/return/replacement.
- Agent offers to create support ticket.

---

# Demo Scenarios for README

Include these as suggested scripts in README.

## Scenario 1: Delayed gift, substitute replacement

Start new conversation.

Customer:

```txt
My order still hasn’t arrived and it’s supposed to be a birthday gift for tomorrow. Can you help?
```

Expected:
- Agent asks for order number or email + ZIP.

Customer:

```txt
It’s ava.morgan@example.com, ZIP 60614. I think it was The Hobbit.
```

Expected:
- lookup order
- get tracking
- check inventory
- evaluate policy
- explain same item unavailable
- offer paperback substitute
- ask if acceptable

Customer:

```txt
Paperback is fine if it can get here tomorrow.
```

Expected:
- Agent asks to confirm address/address ending.

Customer:

```txt
Yes, send it to the same address.
```

Expected:
- create replacement order
- summarize replacement
- say delivery is estimated, not guaranteed

## Scenario 2: Ambiguous return request + PDF label

Start new conversation.

Customer:

```txt
I want to return a book.
```

Expected:
- Agent asks which order/item.

Customer:

```txt
sam.rivera@example.com, 94110. It’s Project Hail Mary.
```

Expected:
- lookup order
- evaluate return policy
- ask reason if missing

Customer:

```txt
I ordered the wrong format.
```

Expected:
- ask for confirmation before creating label

Customer:

```txt
Yes, create the label.
```

Expected:
- call createReturnLabel
- return label ID/download link
- trace should show PDF generation tool

## Scenario 3: Outside return window with escalation on pushback

Start new conversation.

Customer:

```txt
I want to return The Martian. My email is sam.rivera@example.com and ZIP is 94110.
```

Expected:
- lookup order
- evaluate policy
- explain outside 30-day return window
- do not create label
- offer support review if special circumstances

Customer:

```txt
Can someone make an exception? I was traveling and missed the window.
```

Expected:
- ask for confirmation to create support ticket if needed
- call createSupportTicket if customer intent is explicit enough
- return ticket ID

## Scenario 4: Package not missing long enough

Start new conversation.

Customer:

```txt
My Foundation order seems stuck and I need it soon. My email is ava.morgan@example.com and ZIP is 60614.
```

Expected:
- lookup order
- get tracking
- evaluate policy
- say it has not been without scan long enough for automatic replacement
- offer support ticket if urgent

## Scenario 5: High-value manual review

Start new conversation.

Customer:

```txt
I want a refund for my signed first edition. My email is jordan.lee@example.com and ZIP is 10003.
```

Expected:
- lookup order
- evaluate policy
- do not accuse customer of fraud
- explain special review required
- offer support ticket
- do not create refund or return label automatically

---

# Hallucination / Safety Controls

Implement and document:

1. No order-specific claims without `lookupOrder`.
2. No delivery claims without `getTrackingStatus`.
3. No replacement options without `checkReplacementInventory`.
4. No policy eligibility decisions without `evaluatePolicy`.
5. No customer-impacting action without explicit confirmation.
6. No substitute product unless listed as approved substitute.
7. Never describe estimated delivery as guaranteed unless tool result says guaranteed.
8. Never expose payment information.
9. Mask address details until lightweight verification.
10. Do not accuse customers of fraud.
11. Escalate high-value/manual-review/ambiguous-policy cases.
12. Keep trace events structured and do not expose raw chain-of-thought.

---

# Lightweight Verification

For demo purposes:

```txt
Order lookup requires:
- order ID, or
- email + ZIP code
```

Before action:
- confirm masked address, such as “the address ending in 60614”
- do not expose full payment data ever

Production readiness note:
- production would use authenticated sessions, OTP/email verification, CRM identity, least-privilege tool scopes, and audit logs

---

# Action Records

Since JSON data is static, created actions can be held in memory per server process/session for the demo.

Actions:
- replacement order
- support ticket
- return label

This is acceptable for prototype. In production, actions would persist to OMS/CRM/ticketing systems with idempotency keys.

---

# Vercel Compatibility

Use JSON data and no SQLite so the app can optionally deploy to Vercel.

Hosted version:
- should run in Live LLM mode
- API key stored as Vercel environment variable
- optionally use `DEMO_ACCESS_CODE`
- no sensitive data
- seeded fake users only

Local version:
- `npm run dev` runs Demo Model mode with no API key
- `npm run dev:live` runs Live LLM mode with `OPENAI_API_KEY`

---

# Design Doc Plan

Do not necessarily write the final design doc as a polished PDF/Doc yet. Instead, create:

```txt
docs/design-doc-notes.md
```

This file should collect concise points for the candidate to turn into a one-page design document in their own voice.

The candidate will write/refine the final design doc separately.

## `docs/design-doc-notes.md` Should Include

### 1. Architecture Overview

Include:

```txt
Chat UI → /api/chat → Agent Orchestrator → ModelClient → Tool Registry → Bookly service clients → Mock systems → Response + Trace
```

Mention:
- Demo Model and Live LLM share same orchestrator/tools
- JSON-backed systems are mocked behind API-shaped clients
- AOP Markdown is human-readable policy documentation
- `evaluatePolicy` is executable policy authority

### 2. Conversation & Decision Design

Mention:
- intent classification
- workflow-specific required fields / slots
- focused follow-up questions
- policy evaluator
- confirmation gates
- escalation paths
- no unnecessary questions when user already provides enough info

### 3. Example System Prompt

Include the system prompt from this brief.

### 4. Hallucination & Safety Controls

Mention:
- tool-grounding
- deterministic policy evaluator
- substitute whitelist
- no payment info
- masked PII
- confirmation before action
- escalation for manual review
- structured trace instead of raw chain-of-thought

### 5. Production Readiness

Mention:
- replace JSON mocks with OMS/carrier/inventory/CRM/ticketing integrations
- authenticated identity verification
- payment-provider isolation
- idempotency keys for actions
- persistent audit logs
- rate limits/retries/timeouts
- policy versioning
- eval suite/regression testing
- human handoff
- previous conversation/customer context retrieval with PII controls

### 6. Assumptions & Tradeoffs

Mention:
- Bookly is fictional, so business systems are mocked
- JSON chosen over SQLite for demo reliability and Vercel compatibility
- AOP Markdown manually encoded into policy evaluator rather than interpreted dynamically
- Demo does not handle every support edge case
- Demo uses lightweight email + ZIP verification, not real auth
- Created actions are demo records, not real carrier/payment/OMS actions

---

# README Requirements

README should include:

1. Project overview
2. Architecture summary
3. Run instructions
4. Environment variables
5. Live vs Demo Model explanation
6. Suggested demo scripts
7. Safety/guardrail summary
8. Tradeoffs
9. Link to `docs/design-doc-notes.md`

Example run instructions:

```bash
npm install
npm run dev
```

Live mode:

```bash
cp .env.example .env.local
# Add OPENAI_API_KEY
npm run dev:live
```

The README should explain:

```txt
npm run dev
  Starts Demo Model mode. No API key required.

npm run dev:live
  Starts Live LLM mode. Requires OPENAI_API_KEY in .env.local.
```

---

# Implementation Priorities

Build in this order:

1. Next.js UI shell with chat + trace panel.
2. Seed JSON data.
3. Repositories/clients for orders/tracking/inventory/actions.
4. Tools.
5. Policy evaluator.
6. Agent orchestrator.
7. DemoModelClient.
8. OpenAIModelClient.
9. PDF return label generation with `pdf-lib`.
10. README + design-doc notes.
11. Optional Vercel deployment.

Do not over-polish UI before workflows work.

## Milestone 1: One Working Workflow

Get Scenario 1 working end-to-end first:

- User reports delayed gift.
- Agent asks for email/ZIP.
- Tools run.
- Policy applied.
- Substitute offered.
- Confirmation collected.
- Replacement created.
- Trace panel updates.

## Milestone 2: Return Label

Add Scenario 2:

- Ambiguous return request.
- Clarifying question.
- Policy eligibility.
- Return reason.
- Confirmation.
- PDF label generated.

## Milestone 3: Escalation Branches

Add Scenarios 3–5:

- Outside return window
- Package not missing long enough
- High-value manual review

## Milestone 4: Live LLM

Once Demo Model mode works, wire OpenAI live mode.

## Milestone 5: Polish

- README
- design-doc notes
- UI polish
- optional Vercel

---

# Acceptance Criteria

The final demo should show:

- Customer can chat with the agent.
- Agent asks clarifying questions when needed.
- Agent uses tools.
- Agent takes at least one action.
- Agent generates a PDF return label.
- Agent creates a replacement order.
- Agent creates a support ticket.
- Trace panel shows intent, tools, policy checks, pending actions, and final actions.
- Demo Model mode works without API key.
- Live LLM mode works with OpenAI API key.
- New Conversation resets state.
- README contains run instructions and suggested demo scripts.
- Design-doc notes cover architecture, conversation design, system prompt, hallucination/safety controls, production readiness, and tradeoffs.

---

# Things to Avoid

Do not:

- Integrate real UPS/FedEx/USPS APIs
- Integrate real payment/refund APIs
- Build real authentication
- Use Redis
- Use SQLite/Prisma unless explicitly requested later
- Build a giant admin system
- Build voice mode
- Let the LLM invent substitute products
- Let the LLM decide policy eligibility from Markdown prose
- Expose raw chain-of-thought in the trace panel
- Commit API keys
- Commit the assignment PDF

---

# Questions for Codex to Ask Before Building

If anything is unclear, ask concise questions. But do not ask questions that this brief already answers.

Potential useful questions:
1. Should I create the Next.js app from scratch in the current directory?
2. Is OpenAI the only live model provider for now?
3. Should styling use Tailwind or plain CSS?
4. Is Vercel deployment in scope for this first build pass, or should I stop after local demo + README/design notes?

Default assumptions if no answer:
- Yes, create the app from scratch.
- OpenAI only.
- Use simple Tailwind/plain CSS, whichever is faster.
- Vercel deployment is optional after local demo works.

---

# Final Reminder

The goal is not to build a production-grade support platform.

The goal is to produce a take-home demo that makes the reviewer think:

- This candidate understands what an AI agent is.
- This candidate can call an LLM API.
- This candidate can orchestrate tools/workflows.
- This candidate thinks clearly about policy, safety, and hallucination controls.
- This candidate can make smart scope tradeoffs.
- This candidate can build something polished and reviewable without overcomplicating it.
