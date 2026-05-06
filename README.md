# Bookly Order Concierge

Bookly Order Concierge is a demo AI customer support agent for Bookly, a fictional online bookstore. It focuses on order status, delayed delivery rescue, replacements, returns, generated PDF return labels, and support escalation.

The point of the demo is the agent runtime: a chat UI calls `/api/chat`, a model client extracts workflow updates, a deterministic `WorkflowPlanner` chooses the next legal step, tools query mocked Bookly systems, policy code decides eligibility, and the UI shows a structured trace of every customer signal, tool call, shipping quote, policy check, confirmation gate, and action.

## Architecture

```txt
Chat UI -> /api/chat -> Agent Orchestrator
  -> ModelClient extraction -> WorkflowPlanner
  -> Tool Registry -> Bookly repositories/mock systems
  -> Policy Evaluator -> Response router/renderer -> Trace
```

`LLM_MODE=demo` uses deterministic extraction and response templates. `LLM_MODE=live` uses the OpenAI SDK to extract intent, fields, confirmation, and sentiment/tone signals; most customer-facing responses come from planner templates so IDs, order details, confirmations, and policy outcomes stay exact. The LLM is reserved for selected open-ended responses where natural wording is useful. Both modes use the same `WorkflowPlanner`, tools, policies, confirmation gates, and trace events. Live mode defaults to `gpt-5-nano`; set `OPENAI_MODEL` to use a different model available in your OpenAI account.

## Run Locally

Use Node 24 LTS. If you use `nvm`, run `nvm use`; otherwise install Node 24 using your preferred method.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

The dev server logs each turn to the terminal with extraction results, planner steps, tool calls, response render mode/timing, and total duration. This is useful when testing Live Mode latency or checking which intent/sentiment signals the model extracted.

Live Mode routes responses for speed and reliability. Operational messages such as identity questions, order disambiguation, confirmation gates, policy outcomes, and created action IDs/links use planner templates. Those responses need exact wording and should not pay for a second model call. The LLM is used for extraction on each turn and for selected open-ended responses where natural wording is worth the latency.

Live mode:

```bash
cp .env.example .env.local
# Add OPENAI_API_KEY to .env.local
# Optional: override OPENAI_MODEL with a model available in your account
npm run dev:live
```

## Environment

```txt
LLM_MODE=demo
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5-nano
```

- `LLM_MODE`: `demo` runs deterministic extraction and response templates; `live` calls the OpenAI API for extraction and selected response rendering.
- `OPENAI_API_KEY`: required only when `LLM_MODE=live`.
- `OPENAI_MODEL`: optional live-mode override. The repo defaults to `gpt-5-nano` when this is unset.

## Demo Assumptions

The seeded data and `DEMO_TODAY` constant are part of the demo contract. They pin dates, return windows, tracking age, replacement availability, and shipping quote outcomes so the scripts below produce stable results. Changing `data/*.json` or `DEMO_TODAY` can intentionally change the demo branches. The AOP markdown in `data/aops/*.md` documents policy intent for reviewers, but runtime policy decisions come from `lib/policies/evaluatePolicy.ts`.

The JSON files work together:

- `orders.json` links customers to orders, tracking numbers, delivery dates, values, risk flags, and inventory profiles.
- `tracking.json` simulates carrier state and last-scan age.
- `inventory.json` stores stock locations only; it does not store delivery promises.
- `shippingQuotes.json` is the mocked carrier quote source used to calculate fastest replacement delivery and deadline fit.
- `policies.json` stores thresholds and policy flags used by `evaluatePolicy`.

## Seeded Scenario Map

The seed data is intentionally scenario-driven. The recommended scripts below are the fastest way to evaluate the intended workflows. For a fuller breakdown of each seeded customer/order and the policy branch it exercises, see [`docs/demo-scenarios.md`](docs/demo-scenarios.md).

| Customer | Key orders | Primary workflow |
|---|---|---|
| Ava Morgan | `BK-1001`–`BK-1004` | Delayed/lost package replacement scenarios: same-item replacement, substitute replacement, no viable replacement, and package-not-missing-long-enough |
| Sam Rivera | `BK-2001`–`BK-2004` | Return scenarios: eligible return label, outside-window exception, very old order filtering, and return before delivery |
| Jordan Lee | `BK-3001` | High-value/signed collectible order requiring manual review |

The prototype is scoped to representative support branches rather than exhaustive OMS behavior. Other combinations may work, but the scripts below are the recommended review path. Testing every possible seeded-data combination may produce behavior that would need broader production logic, stricter state enforcement, or additional policy branches.

## Demo Scripts

These scripts suggest the shape of messages that exercise the deterministic workflow planner. You do not need to copy them exactly, but staying close to the order identity, deadline, and confirmation structure keeps the demo predictable. Live mode uses the same planner and tools; the model extracts fuzzy language, but code chooses the workflow step and templates most operational responses.

### Scenario 1: delayed gift, ambiguous order, substitute replacement

```txt
My order still hasn't arrived and it's supposed to be a birthday gift for tomorrow. Can you help?
It's ava.morgan@example.com, ZIP 60614. I think it was The Hobbit.
BK-1002
Paperback is fine if it can get here tomorrow.
Yes, send it to the same address.
```

Expected behavior:

- Agent asks for order identity, then disambiguates between multiple Hobbit orders.
- Agent looks up the order, tracking status, inventory, shipping quotes, and policy.
- Agent explains the same item is unavailable in time but an approved paperback substitute can arrive by the requested window.
- Agent asks for substitute approval and address confirmation before creating a replacement.
- Agent describes delivery as estimated, not guaranteed.

### Scenario 2: ambiguous return request and generated PDF label

```txt
I want to return a book.
sam.rivera@example.com, 94110. It's Project Hail Mary.
Yes, it is unused and in the original packaging.
Yes, create the label.
```

Expected behavior:

- Agent asks for the missing order/item identity.
- Agent evaluates return eligibility against the 30-day window.
- Agent confirms the item is unused and in original condition/packaging.
- Agent asks for final confirmation before creating the label.
- Agent generates a dynamic PDF return label.

### Scenario 3: outside return window with escalation

```txt
I want to return The Martian. My email is sam.rivera@example.com and ZIP is 94110.
Can someone make an exception? I was traveling and missed the window.
Yes, create the support ticket.
```

Expected behavior:

- Agent explains the order is outside Bookly's self-service return window.
- Agent does not create a return label.
- Agent offers support review only after the customer asks for an exception.
- Agent asks for confirmation before creating the support ticket.

### Scenario 4: package not missing long enough

```txt
My Foundation order seems stuck and I need it soon. My email is ava.morgan@example.com and ZIP is 60614.
Yes, create the support ticket.
```

Expected behavior:

- Agent checks tracking and replacement policy.
- Agent explains the package has not been without a meaningful scan long enough for automatic replacement.
- Agent offers support escalation because the customer says timing is urgent.

### Scenario 5: high-value manual review

```txt
I want a refund for my signed first edition of The Left Hand of Darkness. My email is jordan.lee@example.com and ZIP is 10003.
```

Expected behavior:

- Agent verifies the order exists.
- Agent does not accuse the customer of fraud.
- Agent explains the order requires support review because it is high-value/special-handling.
- Agent does not create an automatic refund, replacement, or return label.

### Scenario 6: return request before delivery

```txt
I want to return Leviathan Wakes. My email is sam.rivera@example.com and ZIP is 94110.
Yes, create a support ticket.
```

Expected behavior:

- Agent verifies the order exists.
- Agent explains a standard self-service return label is unavailable before delivery.
- Agent offers support review instead.

## Guardrails

- No order-specific claims before `lookupOrder`.
- No delivery claims before `getTrackingStatus`.
- No replacement options before `checkReplacementInventory`.
- No replacement delivery estimate before `quoteShippingOptions`.
- No policy eligibility decision outside `evaluatePolicy`.
- No model-selected tool or action; `WorkflowPlanner` owns workflow transitions in both modes.
- No replacement order or return label without explicit confirmation.
- No return label unless the item condition requirement is confirmed or the flow escalates.
- No substitute unless it exists in inventory data and the customer approves it.
- Human-help requests offer escalation once an order can be tied to the case; fuzzy frustration or urgency signals offer escalation after two signals. Routine delivery-deadline language is treated as workflow input, not sentiment escalation.
- Estimated delivery is never described as guaranteed unless the shipping or tracking tool says so.
- Address details stay masked; payment data is never exposed.
- Manual-review cases escalate neutrally without fraud language.
- The trace panel shows application-level events, not chain-of-thought.

## Tradeoffs

Bookly systems are mocked with JSON for demo reliability and easy deployment. The runtime boundaries are intentionally real: repositories, tools, policy evaluator, model client, workflow planner, response router/renderer, and orchestrator can be swapped to production integrations later. Created replacement orders and return labels have small in-memory duplicate protection for repeated demo actions; production would use persisted idempotency keys, audit logs, retries, and human handoff queues.

Demo Mode is the deterministic reference path. Live Mode is more natural-language-flexible, but not more authoritative: the model extracts workflow fields and customer sentiment/tone signals, then the shared planner decides the next legal step. This avoids the main failure mode of prompt-only agents, where a generic LLM can mis-sequence tools or misread policy. A production system would further harden extraction with provider-enforced structured outputs, evals for extraction quality and planner transitions, richer human-handoff policy, and real system integrations.

See [docs/design-doc-notes.md](docs/design-doc-notes.md) for expanded design-document source notes.
