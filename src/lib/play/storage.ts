import type { FundsStatus, PlayOrder, PlayStore } from "./types";

export const PLAY_STORAGE_KEY = "startrail-play-orders-v1";
export const DEMO_VIEWER_ID = "viewer-demo";
export const STARTING_TICKETS = 40;
export const MAX_TICKETS = 80;
export const REDEEM_AMOUNT = 10;

function inferFunds(order: Partial<PlayOrder>): FundsStatus {
  if (order.funds === "held" || order.funds === "refunded" || order.funds === "released") {
    return order.funds;
  }
  if (order.status === "completed") return "released";
  if (order.status === "cancelled" || order.status === "rejected") return "refunded";
  return "held";
}

function migrateOrder(order: PlayOrder): PlayOrder {
  const createdAt = order.createdAt || new Date().toISOString();
  return {
    ...order,
    id: String(order.id),
    viewerId: DEMO_VIEWER_ID,
    funds: inferFunds(order),
    acceptBy: order.acceptBy || createdAt,
    startBy: order.startBy,
    cancelReason: order.cancelReason,
  };
}

export function defaultPlayStore(firstStreamerId: string): PlayStore {
  return {
    version: 2,
    viewerId: DEMO_VIEWER_ID,
    tickets: STARTING_TICKETS,
    actingStreamerId: firstStreamerId,
    orders: [],
  };
}

export function loadPlayStore(firstStreamerId: string): PlayStore {
  if (typeof window === "undefined") {
    return defaultPlayStore(firstStreamerId);
  }

  try {
    const raw = localStorage.getItem(PLAY_STORAGE_KEY);
    if (!raw) return defaultPlayStore(firstStreamerId);

    const parsed = JSON.parse(raw) as {
      version?: number;
      tickets?: number;
      actingStreamerId?: string;
      orders?: PlayOrder[];
    };
    if (
      (parsed.version !== 1 && parsed.version !== 2) ||
      !Array.isArray(parsed.orders)
    ) {
      return defaultPlayStore(firstStreamerId);
    }

    return {
      version: 2,
      viewerId: DEMO_VIEWER_ID,
      tickets:
        typeof parsed.tickets === "number"
          ? Math.max(0, parsed.tickets)
          : STARTING_TICKETS,
      actingStreamerId: parsed.actingStreamerId || firstStreamerId,
      orders: parsed.orders.map(migrateOrder),
    };
  } catch {
    return defaultPlayStore(firstStreamerId);
  }
}

export function savePlayStore(store: PlayStore): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(PLAY_STORAGE_KEY, JSON.stringify(store));
}

export function heldTickets(orders: PlayOrder[]): number {
  return orders
    .filter((order) => order.funds === "held")
    .reduce((sum, order) => sum + order.priceTickets, 0);
}
