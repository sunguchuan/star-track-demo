"use client";

import {
  cancelReasonLabel,
  fundsLabel,
  gameLabel,
  goodsTitle,
  kindLabel,
  orderDisplayTitle,
  slaRemainingLabel,
  statusLabel,
  streamerBio,
  streamerDisplayName,
} from "@/lib/play/labels";
import { streamerCanAbort } from "@/lib/play/order-machine";
import { usePlay } from "@/lib/play/play-context";
import type { FundsStatus, Goods, OrderStatus, PlayOrder, Streamer } from "@/lib/play/types";
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

export function StudioBoard({
  streamers,
  goods,
}: {
  streamers: Streamer[];
  goods: Goods[];
}) {
  const { locale, t } = useLocale();
  const copy = t.play;
  const { ready, store, actOnOrder, setActingStreamerId, goOfflineAndRefund } =
    usePlay();
  const mine = store.orders.filter(
    (order) => order.streamerId === store.actingStreamerId,
  );
  const myGoods = goods.filter(
    (item) => item.streamerId === store.actingStreamerId,
  );
  const current = streamers.find((item) => item.id === store.actingStreamerId);

  if (!ready) {
    return <p className="text-sm text-zinc-500">{copy.loading}</p>;
  }

  return (
    <div className="space-y-6">
      <label className="block text-sm">
        <span className="mb-1 block text-violet-900">{copy.actingAs}</span>
        <select
          value={store.actingStreamerId}
          onChange={(event) => setActingStreamerId(event.target.value)}
          className="w-full rounded-xl border border-violet-100 bg-white px-3 py-2 text-sm"
        >
          {streamers.map((item) => (
            <option key={item.id} value={item.id}>
              {streamerDisplayName(item.id, locale, item.name)}
            </option>
          ))}
        </select>
      </label>

      {current && (
        <p className="text-sm text-zinc-600">
          {streamerBio(current.id, locale, current.bio)}{" "}
          {current.live ? copy.live : copy.offline}
        </p>
      )}

      <button
        type="button"
        onClick={() => goOfflineAndRefund()}
        className="w-full rounded-xl border border-amber-200 bg-amber-50 py-2 text-sm text-amber-900 hover:bg-amber-100"
      >
        {copy.goOffline}
      </button>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-violet-800">
          {copy.myGoods}
        </h2>
        <ul className="space-y-2">
          {myGoods.map((item) => (
            <li
              key={item.id}
              className="rounded-xl border border-violet-100 bg-white px-3 py-2 text-sm"
            >
              <span className="mr-2 rounded-full bg-violet-50 px-2 py-0.5 text-xs text-violet-800">
                {kindLabel(item.kind, locale)}
              </span>
              {goodsTitle(item.id, locale, item.title)}
              <span className="ml-2 text-xs text-zinc-500">
                {item.priceTickets} {copy.ticketUnit}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-violet-800">
          {copy.incomingOrders}
        </h2>
        {mine.length === 0 ? (
          <p className="rounded-xl border border-dashed border-violet-200 px-4 py-8 text-center text-sm text-violet-700/80">
            {copy.emptyStudio}
          </p>
        ) : (
          <ul className="space-y-3">
            {mine.map((order) => {
              const wait = slaText(order, locale);
              const reason = cancelReasonLabel(order.cancelReason, locale);
              return (
                <li
                  key={order.id}
                  className="rounded-2xl border border-violet-100 bg-white p-4"
                >
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span
                      className={`rounded-full px-2 py-0.5 ${STATUS_CLASS[order.status]}`}
                    >
                      {statusLabel(order.status, locale)}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 ${FUNDS_CLASS[order.funds]}`}
                    >
                      {fundsLabel(order.funds, locale)}
                    </span>
                    <span className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-800">
                      {kindLabel(order.kind, locale)}
                    </span>
                  </div>
                  <h3 className="mt-2 font-medium text-violet-950">
                    {orderDisplayTitle(order, locale)}
                  </h3>
                  <p className="mt-1 text-sm text-zinc-600">
                    {gameLabel(order.game, locale)}
                    {order.seed ? ` · ${order.seed}` : ""}
                  </p>
                  {order.details && (
                    <p className="mt-2 text-sm text-zinc-600">{order.details}</p>
                  )}
                  {wait && <p className="mt-2 text-xs text-amber-800">{wait}</p>}
                  {reason && <p className="mt-1 text-xs text-zinc-500">{reason}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {order.status === "pending_accept" && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            actOnOrder(order.id, "accept", "streamer")
                          }
                          className="rounded-lg bg-violet-700 px-3 py-1.5 text-xs text-white"
                        >
                          {copy.accept}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            actOnOrder(order.id, "reject", "streamer")
                          }
                          className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-700"
                        >
                          {copy.reject}
                        </button>
                      </>
                    )}
                    {order.status === "accepted" && (
                      <button
                        type="button"
                        onClick={() => actOnOrder(order.id, "start", "streamer")}
                        className="rounded-lg bg-violet-700 px-3 py-1.5 text-xs text-white"
                      >
                        {copy.startFulfill}
                      </button>
                    )}
                    {order.status === "in_progress" && (
                      <button
                        type="button"
                        onClick={() =>
                          actOnOrder(order.id, "complete", "streamer")
                        }
                        className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs text-white"
                      >
                        {copy.complete}
                      </button>
                    )}
                    {streamerCanAbort(order) && (
                      <button
                        type="button"
                        onClick={() => actOnOrder(order.id, "cancel", "streamer")}
                        className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-700"
                      >
                        {copy.abortOrder}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
