"use client";

import { useLocale } from "@/lib/i18n/locale-context";

export function LanguageToggle() {
  const { locale, setLocale, t } = useLocale();

  return (
    <div
      className="inline-flex items-center rounded-md border border-violet-200 bg-white p-0.5 text-xs font-medium"
      role="group"
      aria-label={t.langToggle.aria}
    >
      <button
        type="button"
        onClick={() => setLocale("zh")}
        aria-pressed={locale === "zh"}
        className={`rounded px-2 py-1 transition-colors ${
          locale === "zh"
            ? "bg-violet-700 text-white"
            : "text-violet-700 hover:bg-violet-50"
        }`}
      >
        {t.langToggle.zh}
      </button>
      <button
        type="button"
        onClick={() => setLocale("en")}
        aria-pressed={locale === "en"}
        className={`rounded px-2 py-1 transition-colors ${
          locale === "en"
            ? "bg-violet-700 text-white"
            : "text-violet-700 hover:bg-violet-50"
        }`}
      >
        {t.langToggle.en}
      </button>
    </div>
  );
}
