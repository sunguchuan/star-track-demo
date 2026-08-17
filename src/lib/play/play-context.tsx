"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { assertOrderAllowed } from "@/lib/play/policy";
import type { PlayErrorKey } from "@/lib/play/errors";
import { kindPrice } from "@/lib/play/pricing";
import {
  ACCEPT_SLA_MS,
  heldCountForStreamer,
  MAX_HELD_PER_STREAMER,
  nextFundsStatus,
  nextOrderStatus,
  overdueAction,
  START_SLA_MS,
  viewerCanCancel,
  type OrderAction,
  type OrderActor,
} from "@/lib/play/order-machine";
import {
  defaultPlayStore,
  loadPlayStore,
  MAX_TICKETS,
  REDEEM_AMOUNT,
  savePlayStore,
} from "@/lib/play/storage";
import type {
  CancelReason,
  Goods,
  PlayKind,
  PlayOrder,
  PlayStore,
  Streamer,
} from "@/lib/play/types";

type PlaceListedInput = {
  goods: Goods;
  seed?: string;
  details: string;
};

type PlacePrivateInput = {
  streamer: Streamer;
  kind: PlayKind;
  game: string;
  title: string;
  seed?: string;
  details: string;
};

type PlayContextValue = {
  ready: boolean;
  store: PlayStore;
  placeListedOrder: (input: PlaceListedInput) => { ok: true } | { ok: false; reason: PlayErrorKey };
  placePrivateOrder: (
    input: PlacePrivateInput,
  ) => { ok: true } | { ok: false; reason: PlayErrorKey };
  actOnOrder: (
    orderId: string,
    action: OrderAction,
    as: "viewer" | "streamer",
  ) => { ok: true } | { ok: false; reason: PlayErrorKey };
  redeemTickets: () => { ok: true } | { ok: false; reason: PlayErrorKey };
  setActingStreamerId: (id: string) => void;
  goOfflineAndRefund: () => { ok: true; refunded: number } | { ok: false; reason: PlayErrorKey };
};

const PlayContext = createContext<PlayContextValue | null>(null);

function nowIso(): string {
  return new Date().toISOString();
}

function actorReason(actor: OrderActor): CancelReason {
  if (actor === "system") return "timeout";
  return actor;
}

function applyOrderAction(
  prev: PlayStore,
  orderId: string,
  action: OrderAction,
  actor: OrderActor,
  extra?: Partial<PlayOrder>,
): { ok: true; next: PlayStore } | { ok: false; reason: PlayErrorKey } {
  const order = prev.orders.find((item) => item.id === orderId);
  if (!order) return { ok: false, reason: "order_not_found" };

  if (actor === "viewer" && action === "cancel" && !viewerCanCancel(order)) {
    return {
      ok: false,
      reason: "cannot_refund_in_progress",
    };
  }

  const nextStatus = nextOrderStatus(order.status, action);
  if (!nextStatus) {
    return { ok: false, reason: "invalid_transition" };
  }

  const funds = nextFundsStatus({
    action,
    actor,
    from: order.status,
    funds: order.funds,
  });
  const refund = funds === "refunded" && order.funds === "held";

  const patch: PlayOrder = {
    ...order,
    ...extra,
    status: nextStatus,
    funds,
    updatedAt: nowIso(),
    cancelReason:
      extra?.cancelReason ??
      (action === "cancel" || action === "reject"
        ? actorReason(actor)
        : order.cancelReason),
    startBy:
      action === "accept"
        ? new Date(Date.now() + START_SLA_MS).toISOString()
        : order.startBy,
  };

  return {
    ok: true,
    next: {
      ...prev,
      tickets: refund ? prev.tickets + order.priceTickets : prev.tickets,
      orders: prev.orders.map((item) => (item.id === orderId ? patch : item)),
    },
  };
}

export function PlayProvider({
  streamers,
  children,
}: {
  streamers: Streamer[];
  children: ReactNode;
}) {
  const firstStreamerId = streamers[0]?.id ?? "str-seed-sower";
  const [store, setStore] = useState<PlayStore>(() =>
    defaultPlayStore(firstStreamerId),
  );
  const [ready, setReady] = useState(false);
  const storeRef = useRef(store);
  storeRef.current = store;

  const streamerKey = streamers.map((item) => item.id).join(",");

  useEffect(() => {
    const loaded = loadPlayStore(firstStreamerId);
    const ids = streamerKey.split(",").filter(Boolean);
    if (!ids.includes(loaded.actingStreamerId) && ids[0]) {
      loaded.actingStreamerId = ids[0];
    }
    storeRef.current = loaded;
    setStore(loaded);
    setReady(true);
  }, [firstStreamerId, streamerKey]);

  useEffect(() => {
    if (!ready) return;
    savePlayStore(store);
  }, [ready, store]);

  const commitOrder = useCallback(
    (draft: Omit<
      PlayOrder,
      | "id"
      | "createdAt"
      | "updatedAt"
      | "status"
      | "viewerId"
      | "funds"
      | "acceptBy"
      | "startBy"
      | "cancelReason"
    >) => {
      const check = assertOrderAllowed({
        kind: draft.kind,
        title: draft.title,
        game: draft.game,
        details: draft.details,
        seed: draft.seed,
      });
      if (!check.ok) return check;

      const prev = storeRef.current;
      if (prev.tickets < draft.priceTickets) {
        return { ok: false as const, reason: "tickets_insufficient" };
      }
      if (
        heldCountForStreamer(prev.orders, draft.streamerId) >=
        MAX_HELD_PER_STREAMER
      ) {
        return {
          ok: false as const,
          reason: "queue_full",
        };
      }

      const stamp = nowIso();
      const order: PlayOrder = {
        ...draft,
        id: crypto.randomUUID(),
        viewerId: prev.viewerId,
        status: "pending_accept",
        funds: "held",
        acceptBy: new Date(Date.now() + ACCEPT_SLA_MS).toISOString(),
        createdAt: stamp,
        updatedAt: stamp,
      };
      const next = {
        ...prev,
        tickets: prev.tickets - draft.priceTickets,
        orders: [order, ...prev.orders],
      };
      storeRef.current = next;
      setStore(next);
      return { ok: true as const };
    },
    [],
  );

  const placeListedOrder = useCallback(
    (input: PlaceListedInput) => {
      return commitOrder({
        goodsId: input.goods.id,
        isPrivate: false,
        streamerId: input.goods.streamerId,
        kind: input.goods.kind,
        title: input.goods.title,
        game: input.goods.game,
        seed: input.seed?.trim() || undefined,
        details: input.details.trim(),
        priceTickets: input.goods.priceTickets,
      });
    },
    [commitOrder],
  );

  const placePrivateOrder = useCallback(
    (input: PlacePrivateInput) => {
      if (!input.streamer.acceptsPrivateOrders) {
        return { ok: false as const, reason: "private_disabled" };
      }
      const price = kindPrice(input.streamer, input.game, input.kind);
      if (price == null) {
        return { ok: false as const, reason: "kind_not_offered" };
      }
      return commitOrder({
        goodsId: null,
        isPrivate: true,
        streamerId: input.streamer.id,
        kind: input.kind,
        title: input.title.trim() || `私单 · ${input.game}`,
        game: input.game.trim(),
        seed: input.seed?.trim() || undefined,
        details: input.details.trim(),
        priceTickets: price,
      });
    },
    [commitOrder],
  );

  const actOnOrder = useCallback(
    (orderId: string, action: OrderAction, as: "viewer" | "streamer") => {
      const prev = storeRef.current;
      const order = prev.orders.find((item) => item.id === orderId);
      if (!order) return { ok: false as const, reason: "order_not_found" };
      if (as === "viewer" && action !== "cancel") {
        return { ok: false as const, reason: "viewer_cancel_only" };
      }
      if (as === "viewer" && order.viewerId !== prev.viewerId) {
        return { ok: false as const, reason: "not_own_order" };
      }
      if (as === "streamer" && order.streamerId !== prev.actingStreamerId) {
        return { ok: false as const, reason: "wrong_streamer" };
      }

      const result = applyOrderAction(prev, orderId, action, as);
      if (!result.ok) return result;
      storeRef.current = result.next;
      setStore(result.next);
      return { ok: true as const };
    },
    [],
  );

  const expireOverdue = useCallback(() => {
    const prev = storeRef.current;
    const now = Date.now();
    const due = prev.orders.filter((order) => overdueAction(order, now));
    if (due.length === 0) return;

    let next = prev;
    for (const order of due) {
      const result = applyOrderAction(next, order.id, "cancel", "system");
      if (result.ok) next = result.next;
    }
    storeRef.current = next;
    setStore(next);
  }, []);

  const goOfflineAndRefund = useCallback(() => {
    const prev = storeRef.current;
    const waiting = prev.orders.filter(
      (order) =>
        order.streamerId === prev.actingStreamerId &&
        order.funds === "held" &&
        (order.status === "pending_accept" || order.status === "accepted"),
    );
    if (waiting.length === 0) {
      return { ok: false as const, reason: "no_held_queue" };
    }

    let next = prev;
    for (const order of waiting) {
      const result = applyOrderAction(next, order.id, "cancel", "system", {
        cancelReason: "offline",
      });
      if (result.ok) next = result.next;
    }
    storeRef.current = next;
    setStore(next);
    return { ok: true as const, refunded: waiting.length };
  }, []);

  const redeemTickets = useCallback(() => {
    const prev = storeRef.current;
    if (prev.tickets >= MAX_TICKETS) {
      return { ok: false as const, reason: "tickets_capped" };
    }
    const next = {
      ...prev,
      tickets: Math.min(MAX_TICKETS, prev.tickets + REDEEM_AMOUNT),
    };
    storeRef.current = next;
    setStore(next);
    return { ok: true as const };
  }, []);

  const setActingStreamerId = useCallback((id: string) => {
    const next = { ...storeRef.current, actingStreamerId: id };
    storeRef.current = next;
    setStore(next);
  }, []);

  useEffect(() => {
    if (!ready) return;
    expireOverdue();
    const timer = window.setInterval(expireOverdue, 5000);
    return () => window.clearInterval(timer);
  }, [ready, expireOverdue]);

  const value = useMemo<PlayContextValue>(
    () => ({
      ready,
      store,
      placeListedOrder,
      placePrivateOrder,
      actOnOrder,
      redeemTickets,
      setActingStreamerId,
      goOfflineAndRefund,
    }),
    [
      ready,
      store,
      placeListedOrder,
      placePrivateOrder,
      actOnOrder,
      redeemTickets,
      setActingStreamerId,
      goOfflineAndRefund,
    ],
  );

  return <PlayContext.Provider value={value}>{children}</PlayContext.Provider>;
}

export function usePlay() {
  const ctx = useContext(PlayContext);
  if (!ctx) {
    throw new Error("usePlay must be used within PlayProvider");
  }
  return ctx;
}
