"use client";

import { StarDetailTabs } from "@/components/star-detail-tabs";
import { StarSourcesPanel } from "@/components/star-sources-panel";
import { StarAvatar } from "@/components/star-avatar";
import { formatDateLocalized } from "@/lib/i18n/format";
import { useLocale } from "@/lib/i18n/locale-context";
import type { Star } from "@/lib/types";
import Link from "next/link";

export function StarPageContent({ star }: { star: Star }) {
  const { locale, t } = useLocale();

  return (
    <main className="mx-auto min-h-screen max-w-lg px-4 pb-12 pt-4">
      <Link
        href="/"
        className="mb-4 inline-flex text-sm text-violet-700 hover:underline"
      >
        {t.common.backHome}
      </Link>

      <section className="mb-6 rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <div className="flex gap-4">
          <StarAvatar name={star.name} size="lg" />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-violet-950">{star.name}</h1>
            {star.stageName && (
              <p className="text-sm text-violet-700/70">{star.stageName}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {star.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-violet-50 px-2 py-0.5 text-xs text-violet-700"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-zinc-500">{t.starsPage.birthday}</dt>
            <dd className="font-medium text-violet-950">
              {formatDateLocalized(star.birthDate, locale)}
            </dd>
          </div>
          {star.birthplace && (
            <div>
              <dt className="text-zinc-500">{t.starsPage.birthplace}</dt>
              <dd className="font-medium text-violet-950">{star.birthplace}</dd>
            </div>
          )}
        </dl>
        <p className="mt-4 text-sm leading-relaxed text-zinc-600">{star.bio}</p>
      </section>

      <StarSourcesPanel sources={star.sources} />
      <StarDetailTabs star={star} />
    </main>
  );
}
