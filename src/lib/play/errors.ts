import type { Dictionary } from "@/lib/i18n/dictionaries";
import { getMessage } from "@/lib/i18n/dictionaries";

export type PlayErrorKey = keyof Dictionary["play"]["errors"];

export function playErrorText(t: Dictionary, key: string): string {
  return getMessage(t, `play.errors.${key}`);
}
