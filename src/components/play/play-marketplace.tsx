"use client";

import { goodsTitle, kindLabel, streamerDisplayName } from "@/lib/play/labels";
import type { Goods, Streamer } from "@/lib/play/types";
import { useLocale } from "@/lib/i18n/locale-context";
import Link from "next/link";
import { useMemo } from "react";

export function PlayMarketplace({
  streamers,
  goods,
}: {
  streamers: Streamer[];
  goods: Goods[];
}) {
  const { locale, t } = useLocale();
  const copy = t.play;

  const streamerMap = useMemo(
    () => new Map(streamers.map((item) => [item.id, item])),
    [streamers],
  );

  if (goods.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-violet-200 px-4 py-6 text-center text-sm text-violet-700/80">
        {copy.emptyGoods}
      </p>
    );
  }

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-violet-800">
        {copy.listedTitle}
      </h2>
      <ul className="divide-y divide-violet-50 overflow-hidden rounded-xl border border-violet-100 bg-white">
        {goods.map((item) => {
          const streamer = streamerMap.get(item.streamerId);
          return (
            <li key={item.id}>
              <Link
                href={`/play/goods/${item.id}`}
                className="flex items-center gap-3 px-3 py-2.5 hover:bg-violet-50/60"
              >
                <span className="w-16 shrink-0 text-xs text-violet-700">
                  {kindLabel(item.kind, locale)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-violet-950">
                  {goodsTitle(item.id, locale, item.title)}
                  <span className="ml-1.5 text-xs text-zinc-500">
                    {streamer
                      ? streamerDisplayName(streamer.id, locale, streamer.name)
                      : item.streamerId}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-medium text-violet-800">
                  {item.priceTickets}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
