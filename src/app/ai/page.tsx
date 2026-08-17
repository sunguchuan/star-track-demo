import { AiPageContent } from "@/components/ai-page-content";
import { SiteHeader } from "@/components/site-header";
import { brandTitle, getRequestDictionary } from "@/lib/i18n/request-locale";

export async function generateMetadata() {
  const t = await getRequestDictionary();
  return {
    title: brandTitle(t, t.aiPage.title),
    description: `${t.aiPage.introPrefix} Ollama${t.aiPage.introSuffix}`,
  };
}

export default function AiPage() {
  return (
    <>
      <SiteHeader />
      <AiPageContent />
    </>
  );
}
