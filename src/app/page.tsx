import { RecentFeedSection } from "@/components/recent-feed-section";
import { SiteHeader } from "@/components/site-header";
import { StarCard } from "@/components/star-card";
import { getAllStars, getRecentFeed } from "@/lib/stars";

export default function HomePage() {
  const stars = getAllStars();
  const feed = getRecentFeed(10);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto min-h-screen max-w-lg px-4 pb-12 pt-6">
        <section className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-violet-950">
            内娱艺人资料
          </h1>
          <p className="mt-1 text-sm leading-relaxed text-zinc-600">
            基本档案 + 动态时间线，Demo 内测版。数据可在{" "}
            <code className="rounded bg-violet-50 px-1 text-violet-800">
              content/stars/
            </code>{" "}
            中编辑。
          </p>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-violet-700">
            明星
          </h2>
          <ul className="space-y-3">
            {stars.map((star) => (
              <li key={star.id}>
                <StarCard star={star} />
              </li>
            ))}
          </ul>
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
