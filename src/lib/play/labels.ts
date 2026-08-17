import { dictionaries, getMessage } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/dictionaries";
import type { FundsStatus, OrderStatus, PlayKind, PlayOrder } from "./types";

function lookupOrFallback(locale: Locale, path: string, fallback: string): string {
  const value = getMessage(dictionaries[locale], path);
  return value === path ? fallback : value;
}

export function kindLabel(kind: PlayKind, locale: Locale): string {
  return getMessage(dictionaries[locale], `play.kinds.${kind}`);
}

export function statusLabel(status: OrderStatus, locale: Locale): string {
  return getMessage(dictionaries[locale], `play.statuses.${status}`);
}

export function fundsLabel(funds: FundsStatus, locale: Locale): string {
  return getMessage(dictionaries[locale], `play.funds.${funds}`);
}

export function cancelReasonLabel(
  reason: PlayOrder["cancelReason"],
  locale: Locale,
): string | null {
  if (!reason) return null;
  return getMessage(dictionaries[locale], `play.cancelReasons.${reason}`);
}

export function slaRemainingLabel(deadlineIso: string, locale: Locale): string {
  const minutes = Math.ceil((Date.parse(deadlineIso) - Date.now()) / 60_000);
  const dict = dictionaries[locale];
  if (minutes <= 0) return getMessage(dict, "play.slaDue");
  return getMessage(dict, "play.slaRemaining", { minutes });
}

export function gameLabel(game: string, locale: Locale): string {
  const names = dictionaries[locale].play.games as Record<string, string>;
  return names[game] ?? game;
}

export function streamerDisplayName(
  id: string,
  locale: Locale,
  fallback: string,
): string {
  return lookupOrFallback(locale, `play.streamers.${id}.name`, fallback);
}

export function streamerBio(
  id: string,
  locale: Locale,
  fallback: string,
): string {
  return lookupOrFallback(locale, `play.streamers.${id}.bio`, fallback);
}

export function goodsTitle(
  id: string,
  locale: Locale,
  fallback: string,
): string {
  return lookupOrFallback(locale, `play.goods.${id}.title`, fallback);
}

export function goodsDetails(
  id: string,
  locale: Locale,
  fallback: string,
): string {
  return lookupOrFallback(locale, `play.goods.${id}.details`, fallback);
}

export function orderDisplayTitle(order: PlayOrder, locale: Locale): string {
  if (order.goodsId) {
    return goodsTitle(order.goodsId, locale, order.title);
  }
  return `${kindLabel(order.kind, locale)} · ${gameLabel(order.game, locale)}`;
}
