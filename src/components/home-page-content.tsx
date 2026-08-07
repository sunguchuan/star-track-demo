"use client";

import { RecentFeedSection } from "@/components/recent-feed-section";
import { SiteHeader } from "@/components/site-header";
import { StarAvatarStrip } from "@/components/star-avatar-strip";
import { useLocale } from "@/lib/i18n/locale-context";
import type { FeedItem, Star } from "@/lib/types";
import Link from "next/link";

export function HomePageContent({
  stars,
  feed,
}: {
  stars: Star[];
  feed: FeedItem[];
}) {
  const { t } = useLocale();

  return (
    <>
      <SiteHeader />
      <main className="mx-auto min-h-screen max-w-lg px-4 pb-12 pt-6">
        <section className="mb-5">
          <h1 className="text-2xl font-bold tracking-tight text-violet-950">
            {t.home.title}
          </h1>
          <div className="mt-1 flex items-baseline justify-between gap-3">
            <p className="text-sm text-zinc-600">
              {t.home.catalogPrefix}{" "}
              <span className="font-medium text-violet-800">{stars.length}</span>{" "}
              {t.home.catalogSuffix}
            </p>
            <Link
              href="/stars"
              className="shrink-0 text-sm font-medium text-violet-700 hover:text-violet-900 hover:underline"
            >
              {t.home.allStars}
            </Link>
          </div>
          <div className="mt-4">
            <StarAvatarStrip stars={stars} />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-violet-700">
            {t.home.recentUpdates}
          </h2>
          <RecentFeedSection events={feed} />
        </section>
      </main>
    </>
  );
}
