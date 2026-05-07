import { evaluatePolicy } from "@/lib/policies/evaluatePolicy";
import { DEFAULT_RETURN_REASON, booklyRepository } from "@/lib/repositories/booklyRepository";
import type { ToolName } from "@/lib/agent/types";

export type ToolExecutionResult = {
  output: Record<string, unknown>;
  resultSummary: string;
  policySource?: string;
};

type InventoryLocation = {
  locationId: string;
  name: string;
  quantity: number;
};

type ReplacementInventoryOption = {
  available?: boolean;
  sku: string;
  title: string;
  inventoryLocations: InventoryLocation[];
  substitutionReason?: string;
  requiresCustomerApproval?: boolean;
};

type QuotedInventoryOption = ReplacementInventoryOption & {
  fastestLocation: InventoryLocation | null;
  estimatedDelivery: string | null;
  guaranteedDelivery: boolean;
  arrivesByDeadline: boolean;
};

type QuotedReplacementInventory = {
  sameItemOption?: QuotedInventoryOption;
  substituteOptions: QuotedInventoryOption[];
};

function asString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function asBoolean(value: unknown) {
  return typeof value === "boolean" ? value : false;
}

function asNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function isOnOrBefore(date: string | null, deadline?: string) {
  if (!date || !deadline) {
    return false;
  }

  return date <= deadline;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function findReplacementOption(orderId: string, replacementSku: string): ReplacementInventoryOption | undefined {
  const order = booklyRepository.getOrder(orderId);
  if (!order) {
    return undefined;
  }

  const inventory = booklyRepository.getInventoryProfile(order.inventoryProfile);
  if (!inventory) {
    return undefined;
  }

  const options = [inventory.sameItemOption, ...inventory.substituteOptions].filter(Boolean);
  return options.find((option) => option.sku === replacementSku);
}

function quoteInventoryOption(input: {
  option: ReplacementInventoryOption | undefined;
  zipCode?: string;
  customerDeadline?: string;
}): QuotedInventoryOption | undefined {
  const option = input.option;
  if (!option) {
    return undefined;
  }

  // Inventory tells us where stock exists; shipping quotes tell us whether any
  // stocked location can meet the customer's requested delivery window.
  const quotes = option.inventoryLocations
    .map((location) => {
      const quote = input.zipCode
        ? booklyRepository.getShippingQuote({
            sku: option.sku,
            zipCode: input.zipCode,
            locationId: location.locationId
          })
        : undefined;

      return quote ? { location, quote } : undefined;
    })
    .filter(isDefined)
    .sort((a, b) => a.quote.estimatedDelivery.localeCompare(b.quote.estimatedDelivery));
  const fastest = quotes[0];
  const estimatedDelivery = fastest?.quote?.estimatedDelivery ?? null;

  return {
    ...option,
    fastestLocation: fastest?.location ?? null,
    estimatedDelivery,
    guaranteedDelivery: fastest?.quote?.guaranteedDelivery ?? false,
    arrivesByDeadline: isOnOrBefore(estimatedDelivery, input.customerDeadline)
  };
}

function quoteReplacementInventory(input: {
  orderId?: string;
  zipCode?: string;
  customerDeadline?: string;
}): QuotedReplacementInventory | undefined {
  const order = input.orderId ? booklyRepository.getOrder(input.orderId) : undefined;
  const inventory = order ? booklyRepository.getInventoryProfile(order.inventoryProfile) : undefined;

  if (!inventory) {
    return undefined;
  }

  return {
    sameItemOption: quoteInventoryOption({
      option: inventory.sameItemOption,
      zipCode: input.zipCode,
      customerDeadline: input.customerDeadline
    }),
    substituteOptions: inventory.substituteOptions
      .map((option) =>
        quoteInventoryOption({
          option,
          zipCode: input.zipCode,
          customerDeadline: input.customerDeadline
        })
      )
      .filter(isDefined)
  };
}

export async function executeTool(toolName: ToolName, args: Record<string, unknown>): Promise<ToolExecutionResult> {
  switch (toolName) {
    case "lookupOrder": {
      const matches = booklyRepository.searchOrders({
        orderId: asString(args.orderId),
        email: asString(args.email),
        zipCode: asString(args.zipCode),
        itemHint: asString(args.itemHint),
        undeliveredOnly: asBoolean(args.undeliveredOnly)
      });

      return {
        output: { matches },
        resultSummary:
          matches.length === 0
            ? "No matching verified order found"
            : matches.length === 1
              ? `Found ${matches[0].orderId} for ${matches[0].itemTitle}`
              : `Found ${matches.length} likely orders`
      };
    }

    case "getTrackingStatus": {
      const trackingNumber = asString(args.trackingNumber);
      const trackingStatus = trackingNumber ? booklyRepository.getTrackingStatus(trackingNumber) : undefined;
      return {
        output: { trackingStatus },
        resultSummary: trackingStatus
          ? `${trackingStatus.status}: ${trackingStatus.statusDetail}`
          : "No tracking status found"
      };
    }

    case "checkReplacementInventory": {
      const orderId = asString(args.orderId);
      const order = orderId ? booklyRepository.getOrder(orderId) : undefined;
      const inventory = order ? booklyRepository.getInventoryProfile(order.inventoryProfile) : undefined;
      const sameItemLocations = inventory?.sameItemOption.inventoryLocations.length ?? 0;
      const substituteCount = inventory?.substituteOptions.length ?? 0;

      return {
        output: {
          originalSku: order?.sku,
          orderId,
          zipCode: asString(args.zipCode),
          customerDeadline: asString(args.customerDeadline),
          inventory
        },
        resultSummary: inventory
          ? `Same item stocked at ${sameItemLocations} location(s); ${substituteCount} substitute option(s) available`
          : "No replacement inventory found"
      };
    }

    case "quoteShippingOptions": {
      const orderId = asString(args.orderId);
      const zipCode = asString(args.zipCode);
      const customerDeadline = asString(args.customerDeadline);
      const shippingOptions = quoteReplacementInventory({
        orderId,
        zipCode,
        customerDeadline
      });
      const sameItem = shippingOptions?.sameItemOption;
      const substitute = shippingOptions?.substituteOptions.find((option) => option?.arrivesByDeadline);
      const bestOption = sameItem?.arrivesByDeadline ? sameItem : substitute;

      return {
        output: {
          orderId,
          zipCode,
          customerDeadline,
          shippingOptions
        },
        resultSummary: bestOption?.estimatedDelivery
          ? `${bestOption.title} quoted for ${bestOption.estimatedDelivery}`
          : "No quoted replacement option meets the deadline"
      };
    }

    case "evaluatePolicy": {
      const decision = evaluatePolicy({
        issueType: (asString(args.issueType) ?? "return_request") as Parameters<typeof evaluatePolicy>[0]["issueType"],
        orderId: asString(args.orderId) ?? "",
        context: (args.context as Record<string, unknown>) ?? {}
      });
      return {
        output: { policyDecision: decision },
        resultSummary: `${decision.reasonCode}: ${decision.recommendedAction}`,
        policySource: decision.policySource
      };
    }

    case "createReplacementOrder": {
      const originalOrderId = asString(args.originalOrderId) ?? "";
      const replacementSku = asString(args.replacementSku) ?? "";
      const order = booklyRepository.getOrder(originalOrderId);
      const option = findReplacementOption(originalOrderId, replacementSku);
      const isSubstitute = order ? order.sku !== replacementSku : true;
      const estimatedDelivery = asNullableString(args.estimatedDelivery);
      const guaranteedDelivery = asBoolean(args.guaranteedDelivery);

      if (!asBoolean(args.customerConfirmedAddress)) {
        throw new Error("Replacement order requires address confirmation.");
      }
      if (isSubstitute && !asBoolean(args.customerConfirmedSubstitute)) {
        throw new Error("Substitute replacement requires explicit approval.");
      }
      if (!option) {
        throw new Error("Replacement SKU must come from inventory data.");
      }

      const replacement = booklyRepository.createReplacement({
        originalOrderId,
        replacementSku,
        estimatedDelivery,
        guaranteedDelivery
      });
      return {
        output: { replacement },
        resultSummary: replacement.reusedExistingAction
          ? `Reused existing ${replacement.replacementOrderId}, estimated delivery ${replacement.estimatedDelivery}`
          : `Created ${replacement.replacementOrderId}, estimated delivery ${replacement.estimatedDelivery}`
      };
    }

    case "createReturnLabel": {
      if (!asBoolean(args.itemConditionConfirmed)) {
        throw new Error("Return label requires original-condition confirmation.");
      }

      const label = booklyRepository.createReturnLabel({
        orderId: asString(args.orderId) ?? "",
        itemSku: asString(args.itemSku) ?? "",
        returnReason: asString(args.returnReason) ?? DEFAULT_RETURN_REASON
      });
      return {
        output: {
          labelId: label.labelId,
          downloadUrl: `/api/labels/${label.labelId}`,
          expiresAt: label.expiresAt,
          labelReusedExistingAction: label.reusedExistingAction
        },
        resultSummary: label.reusedExistingAction
          ? `Reused PDF return label ${label.labelId}`
          : `Created PDF return label ${label.labelId}`
      };
    }

    case "createSupportTicket": {
      const ticket = booklyRepository.createSupportTicket({
        issueType: asString(args.issueType) ?? "support_review",
        priority: args.priority === "high" ? "high" : "normal",
        summary: asString(args.summary) ?? "Customer requested support review"
      });
      return {
        output: { ticket },
        resultSummary: `Created ${ticket.ticketId} with ${ticket.priority} priority`
      };
    }
  }
}
