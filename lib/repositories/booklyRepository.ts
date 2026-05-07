import customersSeed from "@/data/customers.json";
import inventorySeed from "@/data/inventory.json";
import ordersSeed from "@/data/orders.json";
import policiesSeed from "@/data/policies.json";
import shippingQuotesSeed from "@/data/shippingQuotes.json";
import trackingSeed from "@/data/tracking.json";

type CustomerRecord = (typeof customersSeed)[number];
type OrderRecord = (typeof ordersSeed)[number];
type ShippingQuoteRecord = (typeof shippingQuotesSeed)[number];
type TrackingRecord = (typeof trackingSeed)[number];
type InventoryProfile = (typeof inventorySeed.profiles)[keyof typeof inventorySeed.profiles];

export const DEFAULT_RETURN_REASON = "Customer requested standard return";

export type SafeOrder = {
  orderId: string;
  customerId: string;
  customerName: string;
  itemTitle: string;
  sku: string;
  trackingNumber: string;
  deliveryZip: string;
  maskedAddress: string;
  placedAt: string;
  deliveredAt?: string;
  orderValue: number;
  riskFlags: string[];
  inventoryProfile?: string;
};

export type ReplacementAction = {
  replacementOrderId: string;
  originalOrderId: string;
  replacementSku: string;
  status: "created";
  estimatedDelivery: string | null;
  guaranteedDelivery: boolean;
  reusedExistingAction: boolean;
};

export type ReturnLabelMetadata = {
  labelId: string;
  orderId: string;
  itemSku: string;
  itemTitle: string;
  customerName: string;
  customerReturnAddress: string;
  returnReason: string;
  createdAt: string;
  expiresAt: string;
  reusedExistingAction: boolean;
};

export type SupportTicket = {
  ticketId: string;
  status: "created";
  priority: "normal" | "high";
  issueType: string;
  summary: string;
};

type ActionStore = {
  replacementCounter: number;
  ticketCounter: number;
  labelCounter: number;
  replacements: ReplacementAction[];
  tickets: SupportTicket[];
  labels: Record<string, ReturnLabelMetadata>;
};

const actionStore = globalThis as typeof globalThis & { booklyActionStore?: ActionStore };

function getActionStore(): ActionStore {
  actionStore.booklyActionStore ??= {
    replacementCounter: 5000,
    ticketCounter: 7000,
    labelCounter: 9000,
    replacements: [],
    tickets: [],
    labels: {}
  };
  return actionStore.booklyActionStore;
}

function normalize(value?: string) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function getCustomerById(customerId: string) {
  return customersSeed.find((customer) => customer.customerId === customerId);
}

function toSafeOrder(order: OrderRecord): SafeOrder {
  const customer = getCustomerById(order.customerId);
  if (!customer) {
    throw new Error(`Missing customer for order ${order.orderId}`);
  }

  return {
    orderId: order.orderId,
    customerId: order.customerId,
    customerName: customer.name,
    itemTitle: order.itemTitle,
    sku: order.sku,
    trackingNumber: order.trackingNumber,
    deliveryZip: order.deliveryZip,
    maskedAddress: customer.maskedAddress,
    placedAt: order.placedAt,
    deliveredAt: order.deliveredAt,
    orderValue: order.orderValue,
    riskFlags: [...order.riskFlags],
    inventoryProfile: order.inventoryProfile
  };
}

export const booklyRepository = {
  policies: policiesSeed,

  findCustomerByEmailZip(email?: string, zipCode?: string): CustomerRecord | undefined {
    const normalizedEmail = normalize(email);
    const normalizedZip = normalize(zipCode);
    return customersSeed.find(
      (customer) => normalize(customer.email) === normalizedEmail && normalize(customer.zipCode) === normalizedZip
    );
  },

  getCustomer(customerId: string): CustomerRecord | undefined {
    return getCustomerById(customerId);
  },

  getOrder(orderId: string): SafeOrder | undefined {
    const order = ordersSeed.find((item) => item.orderId.toLowerCase() === orderId.toLowerCase());
    return order ? toSafeOrder(order) : undefined;
  },

  searchOrders(input: { orderId?: string; email?: string; zipCode?: string; itemHint?: string }): SafeOrder[] {
    if (input.orderId) {
      const order = this.getOrder(input.orderId);
      if (!order) return [];

      if (input.email || input.zipCode) {
        const customer = getCustomerById(order.customerId);
        const emailOk = !input.email || normalize(customer?.email) === normalize(input.email);
        const zipOk = !input.zipCode || normalize(order.deliveryZip) === normalize(input.zipCode);
        return emailOk && zipOk ? [order] : [];
      }

      return [order];
    }

    const customer = this.findCustomerByEmailZip(input.email, input.zipCode);
    if (!customer) return [];

    const itemHint = normalize(input.itemHint);
    const customerOrders = ordersSeed.filter((order) => order.customerId === customer.customerId);

    if (itemHint) {
      const scored = customerOrders
        .map((order) => {
          const haystack = normalize(`${order.itemTitle} ${order.sku}`);
          const hintTokens = itemHint.split(" ").filter(Boolean);
          const score = hintTokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);
          return { order, score };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || b.order.placedAt.localeCompare(a.order.placedAt));

      return scored.slice(0, 2).map(({ order }) => toSafeOrder(order));
    }

    return customerOrders
      .filter((order) => !order.deliveredAt || order.deliveredAt >= "2026-02-01")
      .sort((a, b) => b.placedAt.localeCompare(a.placedAt))
      .slice(0, 3)
      .map(toSafeOrder);
  },

  getTrackingStatus(trackingNumber: string): TrackingRecord | undefined {
    return trackingSeed.find((tracking) => tracking.trackingNumber === trackingNumber);
  },

  getShippingQuote(input: { sku: string; zipCode: string; locationId: string }): ShippingQuoteRecord | undefined {
    return shippingQuotesSeed.find(
      (quote) =>
        quote.sku === input.sku &&
        quote.zipCode === input.zipCode &&
        quote.locationId === input.locationId
    );
  },

  getInventoryProfile(profileId?: string): InventoryProfile | undefined {
    if (!profileId) {
      return undefined;
    }

    return inventorySeed.profiles[profileId as keyof typeof inventorySeed.profiles];
  },

  createReplacement(input: {
    originalOrderId: string;
    replacementSku: string;
    estimatedDelivery: string | null;
    guaranteedDelivery: boolean;
  }): ReplacementAction {
    const store = getActionStore();
    // Demo idempotency: if the same replacement action is retried in one app session,
    // return the earlier result instead of creating another customer-facing order.
    const priorReplacementForSameSku = store.replacements.find(
      (replacement) =>
        replacement.originalOrderId === input.originalOrderId &&
        replacement.replacementSku === input.replacementSku
    );
    if (priorReplacementForSameSku) {
      return { ...priorReplacementForSameSku, reusedExistingAction: true };
    }

    store.replacementCounter += 1;
    const action: ReplacementAction = {
      replacementOrderId: `RBK-${store.replacementCounter}`,
      originalOrderId: input.originalOrderId,
      replacementSku: input.replacementSku,
      status: "created",
      estimatedDelivery: input.estimatedDelivery,
      guaranteedDelivery: input.guaranteedDelivery,
      reusedExistingAction: false
    };
    store.replacements.push(action);
    return action;
  },

  createSupportTicket(input: {
    issueType: string;
    priority: "normal" | "high";
    summary: string;
  }): SupportTicket {
    const store = getActionStore();
    store.ticketCounter += 1;
    const ticket: SupportTicket = {
      ticketId: `TCK-${store.ticketCounter}`,
      status: "created",
      priority: input.priority,
      issueType: input.issueType,
      summary: input.summary
    };
    store.tickets.push(ticket);
    return ticket;
  },

  createReturnLabel(input: { orderId: string; itemSku: string; returnReason?: string }): ReturnLabelMetadata {
    const order = this.getOrder(input.orderId);
    if (!order) {
      throw new Error(`Cannot create label for unknown order ${input.orderId}`);
    }
    const customer = getCustomerById(order.customerId);
    if (!customer) {
      throw new Error(`Cannot create label without customer ${order.customerId}`);
    }

    const store = getActionStore();
    const returnReason = input.returnReason?.trim() || DEFAULT_RETURN_REASON;
    // Same idea as replacements: retrying the exact same return label request
    // should return the existing demo label instead of creating duplicates.
    const priorLabelForSameReturn = Object.values(store.labels).find(
      (label) =>
        label.orderId === input.orderId &&
        label.itemSku === input.itemSku &&
        label.returnReason === returnReason
    );
    if (priorLabelForSameReturn) {
      return { ...priorLabelForSameReturn, reusedExistingAction: true };
    }

    store.labelCounter += 1;
    const metadata: ReturnLabelMetadata = {
      labelId: `RL-${store.labelCounter}`,
      orderId: input.orderId,
      itemSku: input.itemSku,
      itemTitle: order.itemTitle,
      customerName: customer.name,
      customerReturnAddress: customer.returnAddress,
      returnReason,
      createdAt: new Date().toISOString(),
      expiresAt: "2026-05-12",
      reusedExistingAction: false
    };
    store.labels[metadata.labelId] = metadata;
    return metadata;
  },

  getReturnLabel(labelId: string): ReturnLabelMetadata | undefined {
    return getActionStore().labels[labelId];
  }
};
