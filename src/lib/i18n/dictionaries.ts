import en from "./messages/en.json";
import zh from "./messages/zh.json";

export type Locale = "zh" | "en";

export const LOCALES: Locale[] = ["zh", "en"];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_STORAGE_KEY = "startrail-locale-v2";

export const dictionaries = {
  zh,
  en,
} as const satisfies Record<Locale, typeof zh>;

export type Dictionary = (typeof dictionaries)[Locale];

export function isLocale(value: unknown): value is Locale {
  return value === "zh" || value === "en";
}

export function isChineseLanguageTag(tag: string): boolean {
  const normalized = tag.trim().toLowerCase().replace(/_/g, "-");
  return normalized === "zh" || normalized.startsWith("zh-");
}

/** First tag in Accept-Language; anything non-Chinese falls back to English. */
export function localeFromAcceptLanguage(
  header: string | null | undefined,
): Locale {
  if (!header) return DEFAULT_LOCALE;
  const first = header.split(",")[0]?.trim().split(";")[0] ?? "";
  return isChineseLanguageTag(first) ? "zh" : DEFAULT_LOCALE;
}

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}

/** Read a nested message by key path, e.g. `play.errors.queue_full`. */
export function getMessage(
  dict: Dictionary,
  path: string,
  vars?: Record<string, string | number>,
): string {
  const parts = path.split(".");
  let current: unknown = dict;
  for (const part of parts) {
    if (typeof current !== "object" || current === null || !(part in current)) {
      return path;
    }
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current !== "string") return path;
  if (!vars) return current;
  return current.replace(/\{(\w+)\}/g, (_, name: string) =>
    name in vars ? String(vars[name]) : `{${name}}`,
  );
}
