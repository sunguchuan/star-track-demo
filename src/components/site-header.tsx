"use client";

import { LanguageToggle } from "@/components/language-toggle";
import { useLocale } from "@/lib/i18n/locale-context";
import Link from "next/link";

export function SiteHeader() {
  const { t } = useLocale();

  return (
    <header className="sticky top-0 z-50 border-b border-violet-100/80 bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-lg items-center justify-between gap-3 px-4">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 font-semibold text-violet-950"
        >
          <span
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-500 text-sm text-white"
            aria-hidden
          >
            {t.brandMark}
          </span>
          <span className="truncate">{t.brand}</span>
        </Link>
        <div className="flex min-w-0 items-center gap-3">
          <nav className="flex items-center gap-3 overflow-x-auto text-sm [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Link
              href="/"
              className="shrink-0 text-violet-900/70 transition-colors hover:text-violet-900"
            >
              {t.nav.home}
            </Link>
            <Link
              href="/stars"
              className="shrink-0 text-violet-900/70 transition-colors hover:text-violet-900"
            >
              {t.nav.stars}
            </Link>
            <Link
              href="/inbox"
              className="shrink-0 text-violet-900/70 transition-colors hover:text-violet-900"
            >
              {t.nav.inbox}
            </Link>
            <Link
              href="/ai"
              className="shrink-0 text-violet-900/70 transition-colors hover:text-violet-900"
            >
              {t.nav.ai}
            </Link>
            <Link
              href="/about"
              className="shrink-0 text-violet-900/70 transition-colors hover:text-violet-900"
            >
              {t.nav.about}
            </Link>
          </nav>
          <LanguageToggle />
        </div>
      </div>
    </header>
  );
}
