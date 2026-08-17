"use client";

import { playErrorText } from "@/lib/play/errors";
import { gameLabel, goodsDetails, goodsTitle, kindLabel, streamerDisplayName } from "@/lib/play/labels";
import { usePlay } from "@/lib/play/play-context";
import type { Goods, Streamer } from "@/lib/play/types";
import { useLocale } from "@/lib/i18n/locale-context";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function GoodsOrderForm({
  goods,
  streamer,
}: {
  goods: Goods;
  streamer: Streamer;
}) {
  const { locale, t } = useLocale();
  const copy = t.play;
  const router = useRouter();
  const { placeListedOrder } = usePlay();
  const [seed, setSeed] = useState("");
  const [details, setDetails] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const result = placeListedOrder({
      goods,
      seed: goods.kind === "seed" ? seed : seed || undefined,
      details,
    });
    if (!result.ok) {
      setError(playErrorText(t, result.reason));
      return;
    }
    router.push("/play/orders");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="rounded-2xl border border-violet-100 bg-white p-4">
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-800">
            {kindLabel(goods.kind, locale)}
          </span>
          <span className="text-zinc-500">
            {streamerDisplayName(streamer.id, locale, streamer.name)}
          </span>
        </div>
        <h2 className="mt-2 text-lg font-semibold text-violet-950">
          {goodsTitle(goods.id, locale, goods.title)}
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          {gameLabel(goods.game, locale)}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-zinc-700">
          {goodsDetails(goods.id, locale, goods.details)}
        </p>
        <p className="mt-3 text-sm font-medium text-violet-800">
          {goods.priceTickets} {copy.ticketUnit}
        </p>
      </div>

      {(goods.kind === "seed" || goods.kind === "challenge") && (
        <label className="block text-sm">
          <span className="mb-1 block text-violet-900">{copy.seedLabel}</span>
          <input
            value={seed}
            onChange={(event) => setSeed(event.target.value)}
            required={goods.kind === "seed"}
            placeholder={copy.seedPlaceholder}
            className="w-full rounded-xl border border-violet-100 bg-white px-3 py-2 text-sm outline-none focus:border-violet-400"
          />
        </label>
      )}

      <label className="block text-sm">
        <span className="mb-1 block text-violet-900">{copy.noteLabel}</span>
        <textarea
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          required={goods.kind !== "seed"}
          rows={4}
          placeholder={copy.notePlaceholder}
          className="w-full rounded-xl border border-violet-100 bg-white px-3 py-2 text-sm outline-none focus:border-violet-400"
        />
      </label>

      <p className="text-xs leading-relaxed text-zinc-500">{copy.noAccountHint}</p>

      {error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      )}

      <button
        type="submit"
        className="w-full rounded-xl bg-violet-700 py-2.5 text-sm font-medium text-white hover:bg-violet-800"
      >
        {copy.placeOrder}
      </button>
    </form>
  );
}
