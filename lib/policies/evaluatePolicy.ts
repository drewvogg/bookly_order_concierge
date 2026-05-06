import { DEMO_TODAY } from "@/lib/agent/types";
import { booklyRepository, type SafeOrder } from "@/lib/repositories/booklyRepository";

type PolicyIssueType = "delivery_exception" | "return_request" | "replacement_request" | "refund_request";

type PolicyDecision = {
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
};

type TrackingLike = {
  status?: string;
  hoursSinceLastScan?: number;
};

type ShippingOptionsLike = {
  sameItemOption?: {
    available?: boolean;
    arrivesByDeadline?: boolean;
  };
  substituteOptions?: Array<{
    title?: string;
    arrivesByDeadline?: boolean;
  }>;
};

function daysBetween(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  return Math.floor((end - start) / 86_400_000);
}

function hasManualReviewFlag(order: SafeOrder) {
  const policyFlags = booklyRepository.policies.manualReviewFlags;
  return (
    order.orderValue >= booklyRepository.policies.manualReviewOrderValueThreshold ||
    order.riskFlags.some((flag) => policyFlags.includes(flag))
  );
}

function manualReviewDecision(issueType: PolicyIssueType): PolicyDecision {
  const policySource =
    issueType === "delivery_exception" || issueType === "replacement_request"
      ? "data/aops/escalation.md"
      : "data/aops/returns-and-refunds.md";

  return {
    eligible: false,
    recommendedAction: "create_support_ticket",
    reasonCode: "manual_review_required",
    customerExplanation:
      "This order requires support review because it has special handling requirements. I can help create a support case without making any automatic refund, return, or replacement decision.",
    requiresConfirmation: true,
    policySource
  };
}

export function evaluatePolicy(input: {
  issueType: PolicyIssueType;
  orderId: string;
  context?: Record<string, unknown>;
}): PolicyDecision {
  const order = booklyRepository.getOrder(input.orderId);
  if (!order) {
    return {
      eligible: false,
      recommendedAction: "ask_clarifying_question",
      reasonCode: "order_not_found",
      customerExplanation: "I need a valid order before I can evaluate this request.",
      requiresConfirmation: false,
      policySource: "data/aops/escalation.md"
    };
  }

  if (hasManualReviewFlag(order)) {
    return manualReviewDecision(input.issueType);
  }

  if (input.issueType === "delivery_exception" || input.issueType === "replacement_request") {
    const tracking = (input.context?.trackingStatus ?? {}) as TrackingLike;
    const shippingOptions = (input.context?.shippingOptions ?? {}) as ShippingOptionsLike;

    if (!["exception", "no_recent_scan"].includes(tracking.status ?? "")) {
      return {
        eligible: false,
        recommendedAction: "answer",
        reasonCode: "tracking_not_exception",
        customerExplanation: "The carrier status does not currently show a delivery exception.",
        requiresConfirmation: false,
        policySource: "data/aops/delivery-exceptions.md"
      };
    }

    if (typeof tracking.hoursSinceLastScan !== "number") {
      return {
        eligible: false,
        recommendedAction: "create_support_ticket",
        reasonCode: "tracking_data_unavailable",
        customerExplanation:
          "I cannot confirm replacement eligibility because the carrier did not return a usable last-scan age. A support case is the right next step.",
        requiresConfirmation: true,
        policySource: "data/aops/escalation.md"
      };
    }

    const hoursSinceLastScan = tracking.hoursSinceLastScan;
    if (hoursSinceLastScan < booklyRepository.policies.lostPackageMinimumHoursWithoutScan) {
      return {
        eligible: false,
        recommendedAction: "deny_self_service_action",
        reasonCode: "not_missing_long_enough",
        customerExplanation:
          "I cannot create an automatic replacement yet because Bookly waits for at least 48 hours without a meaningful carrier scan before treating a package as potentially lost.",
        requiresConfirmation: false,
        policySource: "data/aops/delivery-exceptions.md"
      };
    }

    if (shippingOptions.sameItemOption?.available && shippingOptions.sameItemOption.arrivesByDeadline) {
      return {
        eligible: true,
        recommendedAction: "offer_same_item_replacement",
        reasonCode: "same_item_replacement_available",
        customerExplanation: "A same-item replacement is available and estimated to arrive inside the requested window.",
        requiresConfirmation: true,
        policySource: "data/aops/delivery-exceptions.md"
      };
    }

    const substitute = shippingOptions.substituteOptions?.find((option) => option.arrivesByDeadline);
    if (substitute) {
      return {
        eligible: true,
        recommendedAction: "offer_substitute_replacement",
        reasonCode: "substitute_option_available",
        customerExplanation: `The original edition is unavailable, but Bookly can offer ${substitute.title} as a substitute estimated to arrive inside the requested window.`,
        requiresConfirmation: true,
        policySource: "data/aops/delivery-exceptions.md"
      };
    }

    return {
      eligible: false,
      recommendedAction: "create_support_ticket",
      reasonCode: "no_replacement_can_meet_deadline",
      customerExplanation:
        "I do not see a same-item or substitute option that is estimated to arrive in time. A priority support case is the best next step.",
      requiresConfirmation: true,
      policySource: "data/aops/delivery-exceptions.md"
    };
  }

  if (input.issueType === "return_request" || input.issueType === "refund_request") {
    if (!order.deliveredAt) {
      return {
        eligible: false,
        recommendedAction: "create_support_ticket",
        reasonCode: "not_delivered",
        customerExplanation:
          "This order has not been delivered, so it is not eligible for a standard self-service return label yet.",
        requiresConfirmation: true,
        policySource: "data/aops/returns-and-refunds.md"
      };
    }

    const deliveredDaysAgo = daysBetween(order.deliveredAt, DEMO_TODAY);
    if (deliveredDaysAgo > booklyRepository.policies.returnWindowDays) {
      return {
        eligible: false,
        recommendedAction: "deny_self_service_action",
        reasonCode: "outside_return_window",
        customerExplanation: `This order was delivered ${deliveredDaysAgo} days ago, so it is outside Bookly's 30-day self-service return window.`,
        requiresConfirmation: false,
        policySource: "data/aops/returns-and-refunds.md"
      };
    }

    return {
      eligible: true,
      recommendedAction: "create_return_label",
      reasonCode: "inside_return_window",
      customerExplanation: "This order is inside Bookly's 30-day return window and can receive a return label after confirmation.",
      requiresConfirmation: true,
      policySource: "data/aops/returns-and-refunds.md"
    };
  }

  return {
    eligible: false,
    recommendedAction: "create_support_ticket",
    reasonCode: "unsupported_policy_request",
    customerExplanation: "This request needs support review.",
    requiresConfirmation: true,
    policySource: "data/aops/escalation.md"
  };
}
