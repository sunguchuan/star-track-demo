"use client";

import { PlayMarketplace } from "@/components/play/play-marketplace";
import { PrivateOrderForm } from "@/components/play/private-order-form";
import { gameLabel, kindLabel, streamerDisplayName } from "@/lib/play/labels";
import { featuredShortcut, offeredGames } from "@/lib/play/pricing";
import type { Goods, PlayKind, Streamer } from "@/lib/play/types";
import { useLocale } from "@/lib/i18n/locale-context";
import { useMemo, useState } from "react";

export function PlayHall({
  streamers,
  goods,
}: {
  streamers: Streamer[];
  goods: Goods[];
}) {
  const { locale, t } = useLocale();
  const copy = t.play;
  const featured = useMemo(
    () => featuredShortcut(streamers, goods),
    [streamers, goods],
  );

  const firstStreamer = featured?.streamer ?? streamers[0];
  const [streamerId, setStreamerId] = useState(firstStreamer?.id ?? "");
  const [game, setGame] = useState(
    featured?.game ?? (firstStreamer ? offeredGames(firstStreamer)[0] : "") ?? "",
  );
  const [kind, setKind] = useState<PlayKind>(featured?.kind ?? "seed");

  function useFeatured() {
    if (!featured) return;
    setStreamerId(featured.streamer.id);
    setGame(featured.game);
    setKind(featured.kind);
  }

  const pinned =
    featured &&
    featured.streamer.id === streamerId &&
    featured.game === game &&
    featured.kind === kind;

  return (
    <div className="space-y-5">
      <p className="text-xs leading-relaxed text-violet-800/80">
        {copy.policyBanner}
      </p>

      {featured && (
        <button
          type="button"
          onClick={useFeatured}
          className={`w-full rounded-2xl border px-4 py-3 text-left ${
            pinned
              ? "border-violet-400 bg-violet-50"
              : "border-violet-100 bg-white hover:border-violet-200"
          }`}
        >
          <p className="text-[11px] font-medium uppercase tracking-wide text-violet-600">
            {copy.hotPin}
          </p>
          <p className="mt-1 text-sm font-semibold text-violet-950">
            {kindLabel(featured.kind, locale)} · {gameLabel(featured.game, locale)}{" "}
            ·{" "}
            {streamerDisplayName(
              featured.streamer.id,
              locale,
              featured.streamer.name,
            )}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {featured.price} {copy.ticketUnit}
            {featured.streamer.live ? ` · ${copy.live}` : ""}
            {pinned ? ` · ${copy.hotPinned}` : ` · ${copy.hotAction}`}
          </p>
        </button>
      )}

      <PrivateOrderForm
        streamers={streamers}
        streamerId={streamerId}
        game={game}
        kind={kind}
        onStreamerIdChange={setStreamerId}
        onGameChange={setGame}
        onKindChange={setKind}
      />

      <PlayMarketplace streamers={streamers} goods={goods} />
    </div>
  );
}
