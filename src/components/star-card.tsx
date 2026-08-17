"use client";

import { useLocale } from "@/lib/i18n/locale-context";
import type { Star } from "@/lib/types";
import Link from "next/link";
import { StarAvatar } from "./star-avatar";

export function StarCard({ star }: { star: Star }) {
  const { t } = useLocale();
  const latestEvent = [...star.events].sort((a, b) =>
    b.date.localeCompare(a.date),
  )[0];

  return (
    <Link
      href={`/stars/${star.slug}`}
      className="block rounded-2xl border border-violet-100 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex gap-4">
        <StarAvatar name={star.name} />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-violet-950">{star.name}</h2>
          {star.stageName && (
            <p className="text-sm text-violet-700/60">{star.stageName}</p>
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
          {latestEvent && (
            <p className="mt-2 line-clamp-2 text-sm text-zinc-600">
              {t.starsPage.latestPrefix}{latestEvent.title}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}
