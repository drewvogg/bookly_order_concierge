# Demo Scenarios and Seed Data

This file explains how the seeded data maps to intended demo behaviors. The prototype is intentionally scenario-driven rather than a full production order-management system.

## Ava Morgan — Delayed / Lost Package Workflows

Email: `ava.morgan@example.com`  
ZIP: `60614`

| Order | Scenario | Expected behavior |
|---|---|---|
| BK-1001 | Same item can arrive within requested deadline | Agent may offer same-item replacement, explain delivery is estimated not guaranteed, ask for address confirmation, then create replacement after approval |
| BK-1002 | Same item unavailable, configured substitute can arrive within deadline | Agent explains original is unavailable, offers the paperback as a substitute, asks if substitute is acceptable, then confirms address before replacement |
| BK-1003 | No viable replacement can arrive within deadline | Agent does not invent options and offers support escalation |
| BK-1004 | Package has not been missing long enough | Agent explains automatic replacement is not yet available under policy. It does not offer a ticket on the first policy response for routine timing pressure, but can offer escalation if the customer asks for human help or continues expressing frustration after the policy outcome is explained |

## Sam Rivera — Return Workflows

Email: `sam.rivera@example.com`  
ZIP: `94110`

| Order | Scenario | Expected behavior |
|---|---|---|
| BK-2001 | Eligible return within 30-day window | Agent confirms the item is unused and in original condition/packaging, asks for final confirmation, then generates a PDF return label. Return reason is optional metadata if the customer volunteers it |
| BK-2002 | Outside return window but relatively recent | Agent explains policy, does not create label, offers escalation if customer asks for exception |
| BK-2003 | Very old order | Agent should not surface this unless specifically asked; if asked, explain it is far outside policy |
| BK-2004 | Not yet delivered / return unavailable | Agent should not create a return label, should explain the self-service return flow is unavailable before delivery, and should offer support review |

## Jordan Lee — Manual Review

Email: `jordan.lee@example.com`  
ZIP: `10003`

| Order | Scenario | Expected behavior |
|---|---|---|
| BK-3001 | High-value / signed collectible | Agent does not accuse customer of fraud, does not self-serve refund/return, and offers support review |

## Sentiment / Tone Escalation

Live Mode extracts customer sentiment and tone signals such as frustration, urgency, exception requests, and requests for human help. The workflow planner, not the LLM, decides what those signals do:

- Human-help requests escalate once an order can be tied to the case. If the account is verified but multiple orders match, the agent asks once for the order to route the ticket correctly, then can offer an account-level ticket if the customer keeps asking for human support.
- Frustration and urgency are fuzzy signals. The demo tracks them in workflow state and escalates after two signals only after an available automated remedy has been offered or a terminal no-remediation policy outcome has been explained.
- Exception requests can open a support-review path when policy blocks self-service action.

## Recommended Golden Paths

Use the README scripts for the fastest evaluation path. These records also support exploratory testing, but not every possible combination is intentionally handled. To keep Demo Mode predictable, provide the order number when the agent lists multiple matches, give a concrete deadline date for replacement checks, and answer confirmation questions explicitly. In production, unsupported combinations would become part of the eval suite and policy expansion backlog.
