import { headers } from "next/headers";
import {
  getDictionary,
  localeFromAcceptLanguage,
  type Dictionary,
  type Locale,
} from "./dictionaries";

export async function getRequestLocale(): Promise<Locale> {
  const headerList = await headers();
  return localeFromAcceptLanguage(headerList.get("accept-language"));
}

export async function getRequestDictionary(): Promise<Dictionary> {
  return getDictionary(await getRequestLocale());
}

export function brandTitle(t: Dictionary, pageTitle: string): string {
  return `${pageTitle} | ${t.brand}`;
}
