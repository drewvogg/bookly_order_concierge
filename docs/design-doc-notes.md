# Bookly Order Concierge Design Notes

These are source notes for the final one-page design document. They are intentionally more detailed than the final artifact should be. The one-page design doc should compress these notes aggressively and focus on the highest-signal decisions.

## 1. Assignment Framing

The assignment asks for a simple interactive customer-support agent demo, at least one multi-turn interaction, at least one tool/action, at least one clarifying question, and a one-page design document. It explicitly prioritizes thoughtful design decisions over production-ready code and says edge-case coverage can be scoped as long as assumptions and tradeoffs are clear.

That framing is why this project emphasizes a few deep workflows instead of many shallow ones: delayed delivery replacement, returns with a generated label, and escalation/manual review. The demo intentionally supports multiple branches inside those workflows, but it is not trying to model a full production OMS.

## 2. Architecture Overview

```txt
Chat UI -> /api/chat -> Agent Orchestrator
  -> ModelClient extraction -> WorkflowPlanner
  -> Tool Registry -> Bookly repositories/mock systems
  -> Policy Evaluator -> Response router/renderer -> Trace
```

The agent is the runtime around the model: extraction prompt, workflow state, deterministic planner, tool registry, policy evaluator, confirmation gates, action execution, response routing/rendering, and trace generation. Demo and Live modes share the same planner and tools. JSON-backed mock systems sit behind repository boundaries so they can later become OMS, carrier, inventory, returns, and CRM integrations.

Live Mode uses the LLM for fuzzy language understanding, not for customer-impacting workflow authority. The LLM extracts intent, workflow state updates, confirmation intent, address questions, and customer sentiment/tone signals. `WorkflowPlanner` chooses the next legal step. Most customer-facing messages are planner templates because identity questions, order lists, confirmation gates, policy outcomes, and action IDs/links need exact wording and low latency. The LLM renders only selected open-ended responses where natural wording is worth the extra model call.

AOP Markdown files in `data/aops` make policies readable. Runtime policy authority lives in `lib/policies/evaluatePolicy.ts`, not in free-form model interpretation. The Markdown files are reviewer-facing and traceability artifacts; the LLM should not adjudicate policy by interpreting prose every turn.

## 3. Conversation State And Trace

`ChatMessage.role` uses `user` for customer-authored messages and `assistant` for Bookly-authored replies.

`workflowState` is compact workflow memory. It stores verified identity fields, intent, selected order, order matches, recent tool outputs, optional return reason metadata, item-condition confirmation, policy decisions, customer signal counters, and action results. It is not chain-of-thought.

In plain English, workflow-state filling means: identify what the customer is trying to do, determine which required fields are missing, ask for the smallest next missing field, and only act once the workflow has enough verified state. For example, a return workflow needs `email`, `zipCode`, `orderId` or `itemHint`, `returnConditionConfirmed`, and final confirmation. A delayed replacement workflow needs `orderId`, `customerDeadline`, `trackingStatus`, `shippingOptions`, `policyDecision`, substitute approval, and address confirmation.

The trace panel renders structured events derived from state and tool execution: intent detection, customer signals, clarifying questions, tool calls, policy checks, confirmation gates, and action results. It intentionally does not expose raw chain-of-thought.

The server logs the same control-flow milestones to the terminal: extraction output, planner step type, tool start/done, response render mode/timing, and total turn duration. The UI trace is reviewer-facing; terminal logs are developer-facing and make Live Mode latency/debugging easier without adding streaming complexity.

## 4. Conversation & Decision Design

The loop is: extract workflow updates, update state, let `WorkflowPlanner` choose the next legal step, call tools, evaluate policy, ask for confirmation, take action, or escalate. The agent does not ask for every possible field upfront.

Primary required fields:

- Order identity: order number, or email plus zip code. Book title is optional disambiguation context, not an identity method.
- Item hint or order ID when multiple orders match.
- Customer deadline for urgent replacement checks.
- Original-condition confirmation for self-service returns.
- Explicit confirmation before creating replacements, return labels, or support tickets.

For multi-order matches, the agent lists matching order IDs and asks the customer to choose. This is a deliberate demo tradeoff: it avoids building an extra heuristic layer that guesses which order the customer probably means.

Intent means the support workflow the customer is trying to initiate, not the risk/policy outcome. Examples: `delivery_exception`, `return_or_refund`, `order_status`, `shipping_policy`, `password_reset`, or `unknown`. Risk and policy outcomes, such as `outside_return_window` or `manual_review_required`, are produced by policy evaluation after the order and context are known.

Live extraction also captures sentiment/tone signals:

- `human_help`: explicit request for a human, representative, manager, or support teammate. This escalates once an order can be tied to the case.
- `frustration`: angry or clearly dissatisfied tone.
- `urgency`: urgent timing pressure.
- `exception_request`: request for special review or exception.

Fuzzy signals such as frustration and urgency increment `escalationSignalCount`. The demo offers escalation after two fuzzy signals; it does not create a support ticket until the customer confirms. In delivery-exception flows, ordinary deadline language like “tomorrow” is treated as workflow input, not sentiment escalation, unless it is paired with frustration, human-help, or exception language.

## 5. Replacement Workflow

Replacement handling is intentionally split into separate business-system steps:

1. `lookupOrder`
2. `getTrackingStatus`
3. `checkReplacementInventory`
4. `quoteShippingOptions`
5. `evaluatePolicy`
6. Confirmation gate
7. `createReplacementOrder`

`inventory.json` stores stock locations only. `shippingQuotes.json` simulates a carrier/shipping partner quote service and returns estimated delivery plus whether delivery is guaranteed. The agent calculates `arrivesByDeadline` from the quote and customer deadline. This avoids baking derived delivery claims into inventory seed data.

Same-item replacements are offered before substitutes. Substitute language says Bookly can offer the item as a substitute, but the customer must approve it before action. Approved substitutes come from the inventory/product data; the LLM is not allowed to invent similar products.

The demo covers several representative branches:

- Same item available and estimated to arrive inside the requested window.
- Same item unavailable, approved substitute available inside the requested window.
- No same-item or substitute option can meet the deadline.
- Package has not been missing long enough for automatic replacement.

The branch where the same item is available but only after the deadline while a substitute can arrive in time is a logical production branch, but it is not necessary for the initial demo. The current policy structure could support it by comparing same-item and substitute shipping quotes and asking the customer whether they prefer the original later or the substitute sooner.

## 6. Return Workflow

Returns require delivery, a 30-day return window, original-condition confirmation, and final customer confirmation. Return reason is optional metadata: the agent preserves it when the customer volunteers one, but does not block self-service label creation to ask for it. The PDF label is the one intentionally “real” action in the demo: `createReturnLabel` stores label metadata, and `/api/labels/[labelId]` generates a PDF with `pdf-lib`.

If the order has not been delivered, the agent does not create a standard return label and offers support review instead. If the customer says the item is not in original condition and the issue is not damage-related, the agent routes to support review.

Sam Rivera's seed data intentionally includes multiple orders so the agent can demonstrate ambiguity handling and policy branching: an eligible return, an outside-window return, a very old order that should not be surfaced unless specifically requested, and a not-yet-delivered order.

## 7. Escalation Design

Escalation is triggered when:

- Policy requires manual review.
- The customer asks for an exception.
- Verification is insufficient.
- Tools cannot resolve the issue.
- No replacement can meet the deadline.
- A package is not yet missing long enough for automatic replacement, but the customer still needs review for urgent timing.
- A return is requested before delivery.
- The item condition blocks a self-service return.
- The customer asks for human help, or repeated sentiment/tone signals cross the escalation threshold.

In Live Mode, the LLM extracts sentiment/tone signals but does not decide the escalation action directly. `WorkflowPlanner` tracks `humanHelpRequested`, `exceptionRequested`, and `escalationSignalCount`; human-help requests trigger an escalation offer once an order is known, while frustration/urgency require two fuzzy signals. Demo Mode uses deterministic extraction for the same signal fields.

Manual-review cases should use neutral language. The agent should not accuse customers of fraud. It should say that a request needs support review because of policy, item type, order value, verification state, or special handling requirements.

## 8. Live LLM vs Demo Mode

Demo Mode is deterministic so the demo recording and reviewer walkthrough stay stable. It also lets reviewers run the app without an API key. Demo Mode is not meant to pretend to be the LLM; it is a deterministic model-client implementation that exercises the same orchestrator, tools, policy evaluator, trace panel, and action code.

Live Mode uses the same orchestrator, planner, tools, policy evaluator, and confirmation gates:

1. The LLM extracts structured workflow updates from the latest user message.
2. `WorkflowPlanner` decides the next legal tool, question, confirmation, action, or escalation.
3. The response router returns the planner template for precise operational messages, or asks the LLM to render selected open-ended responses.

The important hard guardrail is that the LLM does not decide eligibility, tool sequence, or customer-impacting action selection. It can identify fuzzy language and improve selected open-ended wording, but deterministic code owns workflow transitions, policy outcomes, and precise operational responses.

Default live model: `gpt-5-nano`, chosen because this demo needs low latency for constrained extraction more than complex reasoning. `OPENAI_MODEL` can override it.

## 9. What Production Would Tighten In Live Mode

The current Live Mode is acceptable for a demo because it demonstrates API calling, structured extraction, shared workflow planning, policy grounding, response routing, and orchestration. In production, the Live Mode implementation should be hardened in several ways:

### Structured outputs with a strict schema

The model should not merely be asked to “return JSON.” It should be constrained to a precise schema for extraction and any generated response rendering. The extraction schema should define allowed intents, workflow state fields, confirmation values, and sentiment/tone signals. The app should reject or recover from outputs that do not match the schema.

In this prototype, Live Mode asks for JSON and validates extraction with a hand-written validator. On validation failure, the client retries twice with explicit feedback, then falls back to deterministic extraction. Selected generated responses also validate the final JSON envelope and fall back to the planner's default message if needed. This is materially safer than a blind cast and appropriate for the demo, but still weaker than provider-enforced strict structured outputs.

### Real tool/function calling

The workflow planner dispatches customer-impacting tools in this design. Production could still use provider-native structured outputs for extraction and selected response generation, or for optional model-assisted tools such as summarization. Customer-impacting tools should remain behind the planner and policy gates.

### Runtime validation of returned steps

Runtime validation should focus on model extraction and generated response envelopes. Production should validate extraction against schema, normalize uncertain extraction values, and eval whether extraction quality is high enough for sentiment, urgency, and confirmation handling.

### State machine or deterministic orchestration for critical sequencing

Critical workflows should have explicit states and allowed transitions, such as `awaiting_identity`, `awaiting_order_disambiguation`, `order_verified`, `tracking_checked`, `replacement_options_quoted`, `policy_evaluated`, `awaiting_confirmation`, and `action_complete`.

This prototype implements that principle in a lightweight form: `WorkflowPlanner` enforces the legal next step from current workflow state, while the LLM extracts fields and phrases selected open-ended responses. A production system would likely make state names and transition tables more explicit.

### Evals around tool order, confirmation gates, and policy adherence

Production should include agent evals, not just unit tests. These evals should run representative conversations and assert behavior: which tools were called, in what order, whether the agent asked for missing fields, whether it avoided guarantees, whether it escalated manual-review cases, and whether it refused to act before confirmation.

This gives a regression harness for prompt changes, model changes, policy changes, and new workflows.

## 10. Hallucination & Safety Controls

- Use tools before order-specific claims.
- Use `quoteShippingOptions` before replacement delivery estimates.
- Never guarantee delivery unless the tool marks it guaranteed.
- Do not invent substitute products.
- Do not expose payment data.
- Use order number or email plus zip code for lookup in the demo. Do not ask for order date, shipping address, masked address, address ending, phone number, customer name, or book title as the identity method.
- Require explicit confirmation before customer-impacting actions.
- Escalate high-value, signed, collectible, or manually flagged items.
- Show trace events instead of chain-of-thought.

Trace event IDs use a UUID with a prefix. The timestamp is separate on the event, so IDs do not need to encode date/time.

## 11. Data, README Guidance, And Demo Coverage

The demo data is intentionally shaped to exercise branches:

- Ava has multiple recent orders, including two Hobbit orders, to demonstrate ambiguity handling.
- `BK-1002` demonstrates delayed replacement with same item unavailable but a paperback substitute quoted in time.
- Foundation demonstrates a package that is not missing long enough for automatic replacement.
- Project Hail Mary demonstrates an eligible return and generated PDF label.
- The Martian demonstrates outside-window escalation.
- Leviathan Wakes demonstrates a return request before delivery.
- The Left Hand of Darkness signed first edition demonstrates high-value manual review.

The README should not force reviewers to reverse-engineer seed JSON. It should provide recommended scripts and a compact scenario map, then link to `docs/demo-scenarios.md` for the full seed-data matrix.

The assignment says not every edge case is required. If a reviewer invents a combination not covered by seeded data, the appropriate answer is that the demo prioritizes representative workflows and documents that production would need broader data coverage, evals, and policy branches.

## 12. Action Store And Idempotency

The in-memory action store tracks end-result actions: replacement orders, return label metadata, and support tickets. It is not the tool-call log; the trace panel is the tool/action log. Counters start at realistic-looking values so generated IDs are easy to read in a demo.

Repeated replacement creation for the same order/SKU and repeated return labels for the same order/SKU/normalized optional reason reuse the existing in-memory demo record. The `reusedExistingAction` flag communicates whether the tool returned a new demo action or an existing one. This is good enough for the demo and approximates idempotency for the most visible customer-impacting actions.

Support-ticket duplicate protection is intentionally lighter. Production would use persisted idempotency keys and audit logs keyed by customer, order, action type, request fingerprint, and target system response.

The current store uses process memory via `globalThis`. That is acceptable for a local/hosted demo, but it is not durable or cross-process persistence. Production actions would persist to OMS, CRM, ticketing, or returns systems.

## 13. Remaining Follow-Ups

- Deeper planner tests/evals for every workflow transition.
- Provider-enforced structured outputs for extraction and selected generated responses.
- More explicit named workflow states and transition tables if the demo grows.
- Broader duplicate protection for support tickets.

## 14. Production Readiness

Production would replace JSON with real OMS, carrier, inventory, CRM, ticketing, and returns APIs. Identity would use authenticated sessions, OTP/email verification, and least-privilege account scopes. Actions would use persisted idempotency keys, audit logs, retries, timeouts, rate limits, policy versioning, and human handoff queues. Evaluation would include regression tests for tool sequencing, policy decisions, escalation language, confirmation handling, and refusal to invent guarantees or substitute products.

The live model client currently uses Chat Completions for JSON extraction and selected generated responses because it was fast to wire for the demo. A production agent should move to provider-enforced structured outputs, stronger extraction schemas, richer planner state, and an eval suite for extraction quality, state transitions, escalation thresholds, and response safety.

## 15. Design Doc Compression Notes

The final design doc should be a one-page artifact, not a dump of this file. Prioritize:

1. Architecture diagram.
2. The decision loop: LLM extraction -> workflow state -> planner -> tools -> policy -> confirmation -> response/action/escalation.
3. Why policy decisions are deterministic rather than free-form LLM judgment.
4. The most important safety controls: tool grounding, no invented guarantees, confirmation gates, PII/payment restrictions, neutral escalation.
5. Production-readiness tradeoffs: JSON mocks, lightweight verification, in-memory actions, stricter structured outputs/tool calling, evals, idempotency, and real system integrations.

Everything else can stay in README/docs as reviewer context or become interview prep notes.
