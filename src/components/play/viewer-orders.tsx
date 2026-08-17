"use client";

import {
  cancelReasonLabel,
  fundsLabel,
  kindLabel,
  orderDisplayTitle,
  slaRemainingLabel,
  statusLabel,
  streamerDisplayName,
  gameLabel,
} from "@/lib/play/labels";
import { viewerCanCancel } from "@/lib/play/order-machine";
import { usePlay } from "@/lib/play/play-context";
import type { FundsStatus, OrderStatus, PlayOrder, Streamer } from "@/lib/play/types";
import { useLocale } from "@/lib/i18n/locale-context";

const STATUS_CLASS: Record<OrderStatus, string> = {
  pending_accept: "bg-amber-50 text-amber-800",
  accepted: "bg-sky-50 text-sky-800",
  in_progress: "bg-violet-50 text-violet-800",
  completed: "bg-emerald-50 text-emerald-800",
  cancelled: "bg-zinc-100 text-zinc-600",
  rejected: "bg-rose-50 text-rose-800",
};

const FUNDS_CLASS: Record<FundsStatus, string> = {
  held: "bg-amber-50 text-amber-900",
  refunded: "bg-zinc-100 text-zinc-600",
  released: "bg-emerald-50 text-emerald-800",
};

function slaText(order: PlayOrder, locale: "zh" | "en"): string | null {
  if (order.funds !== "held") return null;
  if (order.status === "pending_accept") {
    return slaRemainingLabel(order.acceptBy, locale);
  }
  if (order.status === "accepted" && order.startBy) {
    return slaRemainingLabel(order.startBy, locale);
  }
  return null;
}

export function ViewerOrders({ streamers }: { streamers: Streamer[] }) {
  const { locale, t } = useLocale();
  const copy = t.play;
  const { ready, store, actOnOrder } = usePlay();
  const names = new Map(
    streamers.map((item) => [
      item.id,
      streamerDisplayName(item.id, locale, item.name),
    ]),
  );

  if (!ready) {
    return <p className="text-sm text-zinc-500">{copy.loading}</p>;
  }

  if (store.orders.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-violet-200 px-4 py-8 text-center text-sm text-violet-700/80">
        {copy.emptyOrders}
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {store.orders.map((order) => {
        const wait = slaText(order, locale);
        const reason = cancelReasonLabel(order.cancelReason, locale);
        return (
          <li
            key={order.id}
            className="rounded-2xl border border-violet-100 bg-white p-4"
          >
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span
                className={`rounded-full px-2 py-0.5 ${STATUS_CLASS[order.status]}`}
              >
                {statusLabel(order.status, locale)}
              </span>
              <span className={`rounded-full px-2 py-0.5 ${FUNDS_CLASS[order.funds]}`}>
                {fundsLabel(order.funds, locale)}
              </span>
              <span className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-800">
                {kindLabel(order.kind, locale)}
              </span>
              {order.isPrivate && (
                <span className="rounded-full bg-fuchsia-50 px-2 py-0.5 text-fuchsia-800">
                  {copy.privateTag}
                </span>
              )}
            </div>
            <h2 className="mt-2 font-semibold text-violet-950">
              {orderDisplayTitle(order, locale)}
            </h2>
            <p className="mt-1 text-sm text-zinc-600">
              {names.get(order.streamerId) ?? order.streamerId} ·{" "}
              {gameLabel(order.game, locale)}
            </p>
            {order.seed && (
              <p className="mt-1 font-mono text-xs text-zinc-500">
                {copy.seedLabel}: {order.seed}
              </p>
            )}
            {order.details && (
              <p className="mt-2 text-sm text-zinc-600">{order.details}</p>
            )}
            <p className="mt-2 text-xs text-zinc-500">
              {order.priceTickets} {copy.ticketUnit}
            </p>
            {wait && (
              <p className="mt-1 text-xs text-amber-800">{wait}</p>
            )}
            {reason && (
              <p className="mt-1 text-xs text-zinc-500">{reason}</p>
            )}
            {viewerCanCancel(order) && (
              <button
                type="button"
                onClick={() => actOnOrder(order.id, "cancel", "viewer")}
                className="mt-3 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
              >
                {copy.cancelOrder}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
