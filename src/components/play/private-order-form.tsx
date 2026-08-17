"use client";

import { gameLabel, kindLabel, streamerDisplayName } from "@/lib/play/labels";
import { playErrorText } from "@/lib/play/errors";
import { usePlay } from "@/lib/play/play-context";
import { kindPrice, offeredGames, offeredKinds } from "@/lib/play/pricing";
import type { PlayKind, Streamer } from "@/lib/play/types";
import { useLocale } from "@/lib/i18n/locale-context";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";

export function PrivateOrderForm({
  streamers,
  streamerId,
  game,
  kind,
  onStreamerIdChange,
  onGameChange,
  onKindChange,
}: {
  streamers: Streamer[];
  streamerId: string;
  game: string;
  kind: PlayKind;
  onStreamerIdChange: (id: string) => void;
  onGameChange: (game: string) => void;
  onKindChange: (kind: PlayKind) => void;
}) {
  const { locale, t } = useLocale();
  const copy = t.play;
  const router = useRouter();
  const { placePrivateOrder } = usePlay();
  const openStreamers = useMemo(
    () => streamers.filter((item) => item.acceptsPrivateOrders),
    [streamers],
  );

  const streamer = openStreamers.find((item) => item.id === streamerId);
  const games = streamer ? offeredGames(streamer) : [];
  const kinds = streamer ? offeredKinds(streamer, game) : [];
  const price = streamer ? kindPrice(streamer, game, kind) : undefined;

  useEffect(() => {
    if (games.length > 0 && !games.includes(game) && games[0]) {
      onGameChange(games[0]);
    }
  }, [game, games, onGameChange]);

  useEffect(() => {
    if (kinds.length > 0 && !kinds.includes(kind) && kinds[0]) {
      onKindChange(kinds[0]);
    }
  }, [kind, kinds, onKindChange]);

  const [seed, setSeed] = useState("");
  const [details, setDetails] = useState("");
  const [error, setError] = useState<string | null>(null);

  function selectStreamer(id: string) {
    onStreamerIdChange(id);
    const next = openStreamers.find((item) => item.id === id);
    const nextGames = next ? offeredGames(next) : [];
    const nextGame = nextGames[0] ?? "";
    onGameChange(nextGame);
    const nextKinds = next ? offeredKinds(next, nextGame) : [];
    if (nextKinds[0]) {
      onKindChange(nextKinds[0]);
    }
  }

  function selectGame(nextGame: string) {
    onGameChange(nextGame);
    const nextKinds = streamer ? offeredKinds(streamer, nextGame) : [];
    if (nextKinds[0] && !nextKinds.includes(kind)) {
      onKindChange(nextKinds[0]);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!streamer) return;
    const result = placePrivateOrder({
      streamer,
      kind,
      game,
      title: `${kindLabel(kind, locale)} · ${gameLabel(game, locale)}`,
      seed,
      details,
    });
    if (!result.ok) {
      setError(playErrorText(t, result.reason));
      return;
    }
    router.push("/play/orders");
  }

  if (openStreamers.length === 0) return null;

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-2xl border border-violet-100 bg-white p-4"
    >
      <h2 className="font-semibold text-violet-950">{copy.privateTitle}</h2>
      <p className="text-xs leading-relaxed text-zinc-500">
        {copy.privateHint}
      </p>

      <label className="block text-sm">
        <span className="mb-1 block text-violet-900">{copy.streamerLabel}</span>
        <select
          value={streamerId}
          onChange={(event) => selectStreamer(event.target.value)}
          className="w-full rounded-xl border border-violet-100 bg-white px-3 py-2 text-sm"
        >
          {openStreamers.map((item) => (
            <option key={item.id} value={item.id}>
              {streamerDisplayName(item.id, locale, item.name)}
              {item.live ? ` · ${copy.live}` : ""}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        <span className="mb-1 block text-violet-900">{copy.gameLabel}</span>
        <select
          value={games.includes(game) ? game : (games[0] ?? "")}
          onChange={(event) => selectGame(event.target.value)}
          required
          disabled={games.length === 0}
          className="w-full rounded-xl border border-violet-100 bg-white px-3 py-2 text-sm"
        >
          {games.map((item) => (
            <option key={item} value={item}>
              {gameLabel(item, locale)}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        <span className="mb-1 block text-violet-900">{copy.kindLabel}</span>
        <select
          value={kinds.includes(kind) ? kind : (kinds[0] ?? kind)}
          onChange={(event) => onKindChange(event.target.value as PlayKind)}
          disabled={kinds.length === 0}
          className="w-full rounded-xl border border-violet-100 bg-white px-3 py-2 text-sm"
        >
          {kinds.map((item) => (
            <option key={item} value={item}>
              {kindLabel(item, locale)} · {kindPrice(streamer!, game, item)}{" "}
              {copy.ticketUnit}
            </option>
          ))}
        </select>
      </label>

      {kind === "seed" && (
        <label className="block text-sm">
          <span className="mb-1 block text-violet-900">{copy.seedLabel}</span>
          <input
            value={seed}
            onChange={(event) => setSeed(event.target.value)}
            required
            placeholder={copy.seedPlaceholder}
            className="w-full rounded-xl border border-violet-100 px-3 py-2 text-sm outline-none focus:border-violet-400"
          />
        </label>
      )}

      <label className="block text-sm">
        <span className="mb-1 block text-violet-900">{copy.noteLabel}</span>
        <textarea
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          required={kind !== "seed"}
          rows={2}
          placeholder={copy.notePlaceholder}
          className="w-full rounded-xl border border-violet-100 px-3 py-2 text-sm outline-none focus:border-violet-400"
        />
      </label>

      {error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={price == null || games.length === 0}
        className="w-full rounded-xl bg-violet-700 py-2.5 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-50"
      >
        {copy.placePrivate}
        {price != null ? ` · ${price} ${copy.ticketUnit}` : ""}
      </button>
    </form>
  );
}
