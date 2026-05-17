import { RecentFeedSection } from "@/components/recent-feed-section";
import { SiteHeader } from "@/components/site-header";
import { StarAvatarStrip } from "@/components/star-avatar-strip";
import { getAllStars, getRecentFeed } from "@/lib/stars";
import Link from "next/link";

export default function HomePage() {
  const stars = getAllStars();
  const feed = getRecentFeed(10);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto min-h-screen max-w-lg px-4 pb-12 pt-6">
        <section className="mb-5">
          <h1 className="text-2xl font-bold tracking-tight text-violet-950">
            内娱艺人动态
          </h1>
          <div className="mt-1 flex items-baseline justify-between gap-3">
            <p className="text-sm text-zinc-600">
              共收录{" "}
              <span className="font-medium text-violet-800">{stars.length}</span>{" "}
              位艺人
            </p>
            <Link
              href="/stars"
              className="shrink-0 text-sm font-medium text-violet-700 hover:text-violet-900 hover:underline"
            >
              全部明星 →
            </Link>
          </div>
          <div className="mt-4">
            <StarAvatarStrip stars={stars} />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-violet-700">
            最近更新
          </h2>
          <RecentFeedSection events={feed} />
        </section>
      </main>
    </>
  );
}
