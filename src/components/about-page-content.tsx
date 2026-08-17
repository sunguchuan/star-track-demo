"use client";

import { useLocale } from "@/lib/i18n/locale-context";
import Link from "next/link";

export function AboutPageContent() {
  const { t } = useLocale();

  return (
    <main className="mx-auto min-h-screen max-w-lg px-4 pb-12 pt-6">
      <Link
        href="/"
        className="mb-4 inline-flex text-sm text-violet-700 hover:underline"
      >
        {t.common.backHome}
      </Link>

      <h1 className="text-2xl font-bold text-violet-950">{t.about.title}</h1>
      <p className="mt-2 text-sm text-violet-700/80">{t.about.kicker}</p>

      <div className="mt-6 space-y-4 text-sm leading-relaxed text-zinc-700">
        <p>{t.about.p1}</p>
        <p>{t.about.p2}</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>{t.about.li1}</li>
          <li>{t.about.li2}</li>
          <li>{t.about.li3}</li>
          <li>{t.about.li4}</li>
          <li>{t.about.li5}</li>
        </ul>
        <p className="rounded-xl bg-violet-50 px-4 py-3 text-violet-900">
          {t.about.dataNotePrefix} <code>content/stars/*.json</code>{" "}
          {t.about.dataNoteSuffix}
        </p>
      </div>
    </main>
  );
}
