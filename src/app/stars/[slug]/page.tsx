import { StarDetailTabs } from "@/components/star-detail-tabs";
import { SiteHeader } from "@/components/site-header";
import { StarAvatar } from "@/components/star-avatar";
import { formatDate } from "@/lib/format";
import { getAllStarSlugs, getStarBySlug } from "@/lib/stars";
import Link from "next/link";
import { notFound } from "next/navigation";

export function generateStaticParams() {
  return getAllStarSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const star = getStarBySlug(slug);
  if (!star) return { title: "未找到" };
  return {
    title: `${star.name} | 星迹 Demo`,
    description: star.bio.slice(0, 120),
  };
}

export default async function StarPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const star = getStarBySlug(slug);
  if (!star) notFound();

  return (
    <>
      <SiteHeader />
      <main className="mx-auto min-h-screen max-w-lg px-4 pb-12 pt-4">
        <Link
          href="/"
          className="mb-4 inline-flex text-sm text-violet-700 hover:underline"
        >
          ← 返回首页
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
              <dt className="text-zinc-500">生日</dt>
              <dd className="font-medium text-violet-950">
                {formatDate(star.birthDate)}
              </dd>
            </div>
            {star.birthplace && (
              <div>
                <dt className="text-zinc-500">籍贯</dt>
                <dd className="font-medium text-violet-950">{star.birthplace}</dd>
              </div>
            )}
          </dl>
          <p className="mt-4 text-sm leading-relaxed text-zinc-600">{star.bio}</p>
        </section>

        <StarDetailTabs star={star} />
      </main>
    </>
  );
}
