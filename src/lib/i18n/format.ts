import type { Locale } from "./dictionaries";
import { dictionaries } from "./dictionaries";

export function formatDateLocalized(date: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(date));
}

export function formatEventTypeLocalized(
  type: string,
  locale: Locale,
): string {
  const labels = dictionaries[locale].eventType as Record<string, string>;
  return labels[type] ?? type;
}

export function formatMonthNavLabel(
  year: number,
  month: number,
  locale: Locale,
): { year: string; month: string } {
  if (locale === "en") {
    const monthName = new Intl.DateTimeFormat("en-US", { month: "short" }).format(
      new Date(Date.UTC(year, month - 1, 1)),
    );
    return { year: String(year), month: monthName };
  }
  return { year: String(year), month: `${month}月` };
}

export function formatWorkTypeLocalized(
  type: string,
  locale: Locale,
): string {
  const labels = dictionaries[locale].starsPage.workType as Record<
    string,
    string
  >;
  return labels[type] ?? type;
}

export function formatEventCount(count: number, locale: Locale): string {
  if (locale === "en") {
    return count === 1 ? "1 item" : `${count} items`;
  }
  return `${count} 条`;
}
