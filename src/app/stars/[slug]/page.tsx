import { SiteHeader } from "@/components/site-header";
import { StarPageContent } from "@/components/star-page-content";
import { getAllStarSlugs, getStarBySlug } from "@/lib/stars";
import { brandTitle, getRequestDictionary } from "@/lib/i18n/request-locale";
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
  const t = await getRequestDictionary();
  const star = getStarBySlug(slug);
  if (!star) return { title: t.starsPage.emptyWorks };
  return {
    title: brandTitle(t, star.name),
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
      <StarPageContent star={star} />
    </>
  );
}
