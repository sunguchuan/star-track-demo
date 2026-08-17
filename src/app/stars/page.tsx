import { SiteHeader } from "@/components/site-header";
import { StarsIndexContent } from "@/components/stars-index-content";
import { getAllStars } from "@/lib/stars";
import { brandTitle, getRequestDictionary } from "@/lib/i18n/request-locale";

export async function generateMetadata() {
  const t = await getRequestDictionary();
  return {
    title: brandTitle(t, t.starsPage.title),
    description: `${t.starsPage.countPrefix} ${t.starsPage.countSuffix}`,
  };
}

export default function StarsIndexPage() {
  const stars = getAllStars();

  return (
    <>
      <SiteHeader />
      <StarsIndexContent stars={stars} />
    </>
  );
}
