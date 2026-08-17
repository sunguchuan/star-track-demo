import { SiteHeader } from "@/components/site-header";
import { AboutPageContent } from "@/components/about-page-content";
import { brandTitle, getRequestDictionary } from "@/lib/i18n/request-locale";

export async function generateMetadata() {
  const t = await getRequestDictionary();
  return {
    title: brandTitle(t, t.about.title),
    description: t.about.kicker,
  };
}

export default function AboutPage() {
  return (
    <>
      <SiteHeader />
      <AboutPageContent />
    </>
  );
}
