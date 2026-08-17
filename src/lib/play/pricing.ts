import { PLAY_KINDS, type Goods, type PlayKind, type Streamer } from "./types";

export function offeredGames(streamer: Streamer): string[] {
  return streamer.offers
    .filter((offer) => offeredKinds(streamer, offer.game).length > 0)
    .map((offer) => offer.game);
}

export function kindPrice(
  streamer: Streamer,
  game: string,
  kind: PlayKind,
): number | undefined {
  const offer = streamer.offers.find((item) => item.game === game);
  const price = offer?.kindPrices[kind];
  return typeof price === "number" ? price : undefined;
}

export function offeredKinds(streamer: Streamer, game: string): PlayKind[] {
  return PLAY_KINDS.filter((kind) => kindPrice(streamer, game, kind) != null);
}

export function hottestKind(goods: Goods[]): PlayKind {
  const counts = new Map<PlayKind, number>();
  for (const item of goods) {
    counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  }
  let top: PlayKind = "seed";
  let best = -1;
  for (const kind of PLAY_KINDS) {
    const count = counts.get(kind) ?? 0;
    if (count > best) {
      best = count;
      top = kind;
    }
  }
  return top;
}

export function featuredShortcut(
  streamers: Streamer[],
  goods: Goods[],
): { kind: PlayKind; game: string; streamer: Streamer; price: number } | null {
  const kind = hottestKind(goods);
  const candidates: {
    streamer: Streamer;
    game: string;
    price: number;
  }[] = [];

  for (const streamer of streamers) {
    if (!streamer.acceptsPrivateOrders) continue;
    for (const game of offeredGames(streamer)) {
      const price = kindPrice(streamer, game, kind);
      if (price == null) continue;
      candidates.push({ streamer, game, price });
    }
  }

  const live =
    candidates.find((item) => item.streamer.live) ?? candidates[0];
  if (!live) return null;
  return { kind, streamer: live.streamer, game: live.game, price: live.price };
}
