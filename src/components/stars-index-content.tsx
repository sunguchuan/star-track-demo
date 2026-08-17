"use client";

import { StarCard } from "@/components/star-card";
import { useLocale } from "@/lib/i18n/locale-context";
import type { Star } from "@/lib/types";
import Link from "next/link";

export function StarsIndexContent({ stars }: { stars: Star[] }) {
  const { t } = useLocale();

  return (
    <main className="mx-auto min-h-screen max-w-lg px-4 pb-12 pt-6">
      <Link
        href="/"
        className="mb-4 inline-flex text-sm text-violet-700 hover:underline"
      >
        {t.common.backHome}
      </Link>

      <h1 className="text-2xl font-bold tracking-tight text-violet-950">
        {t.starsPage.title}
      </h1>
      <p className="mt-1 text-sm text-zinc-600">
        {t.starsPage.countPrefix} {stars.length} {t.starsPage.countSuffix}
      </p>

      <ul className="mt-6 space-y-3">
        {stars.map((star) => (
          <li key={star.id}>
            <StarCard star={star} />
          </li>
        ))}
      </ul>
    </main>
  );
}
