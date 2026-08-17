import type { FundsStatus, OrderStatus, PlayOrder } from "./types";

export const ACCEPT_SLA_MS = 15 * 60 * 1000;
export const START_SLA_MS = 30 * 60 * 1000;
export const MAX_HELD_PER_STREAMER = 3;

const TRANSITIONS: Record<OrderStatus, Partial<Record<string, OrderStatus>>> = {
  pending_accept: {
    accept: "accepted",
    reject: "rejected",
    cancel: "cancelled",
  },
  accepted: {
    start: "in_progress",
    cancel: "cancelled",
  },
  in_progress: {
    complete: "completed",
    cancel: "cancelled",
  },
  completed: {},
  cancelled: {},
  rejected: {},
};

export type OrderAction = "accept" | "reject" | "start" | "complete" | "cancel";
export type OrderActor = "viewer" | "streamer" | "system";

export function nextOrderStatus(
  current: OrderStatus,
  action: OrderAction,
): OrderStatus | null {
  return TRANSITIONS[current][action] ?? null;
}

/** 履约开始前可退；开打后仅主播中止 / 系统超时可退。完成后不退。 */
export function shouldRefund(params: {
  action: OrderAction;
  actor: OrderActor;
  from: OrderStatus;
  funds: FundsStatus;
}): boolean {
  if (params.funds !== "held") return false;
  if (params.action === "accept" || params.action === "start") return false;
  if (params.action === "complete") return false;
  if (params.from === "completed") return false;
  if (params.action === "reject") return true;
  if (params.action !== "cancel") return false;
  if (params.actor === "streamer" || params.actor === "system") return true;
  return params.from === "pending_accept" || params.from === "accepted";
}

export function nextFundsStatus(params: {
  action: OrderAction;
  actor: OrderActor;
  from: OrderStatus;
  funds: FundsStatus;
}): FundsStatus {
  if (params.action === "complete" && params.funds === "held") return "released";
  if (shouldRefund(params)) return "refunded";
  return params.funds;
}

export function viewerCanCancel(order: PlayOrder): boolean {
  return (
    order.funds === "held" &&
    (order.status === "pending_accept" || order.status === "accepted")
  );
}

export function streamerCanAbort(order: PlayOrder): boolean {
  return (
    order.funds === "held" &&
    (order.status === "accepted" || order.status === "in_progress")
  );
}

export function heldCountForStreamer(
  orders: PlayOrder[],
  streamerId: string,
): number {
  return orders.filter(
    (order) =>
      order.streamerId === streamerId &&
      order.funds === "held" &&
      (order.status === "pending_accept" || order.status === "accepted"),
  ).length;
}

export function overdueAction(
  order: PlayOrder,
  nowMs: number,
): "cancel" | null {
  if (order.funds !== "held") return null;
  if (order.status === "pending_accept" && nowMs >= Date.parse(order.acceptBy)) {
    return "cancel";
  }
  if (
    order.status === "accepted" &&
    order.startBy &&
    nowMs >= Date.parse(order.startBy)
  ) {
    return "cancel";
  }
  return null;
}

export const TERMINAL_STATUSES: OrderStatus[] = [
  "completed",
  "cancelled",
  "rejected",
];
