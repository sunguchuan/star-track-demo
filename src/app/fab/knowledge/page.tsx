import { KnowledgeLab } from "@/components/knowledge-lab";
import { SiteHeader } from "@/components/site-header";
import { isCloudConfigured } from "@/lib/ai/router";
import { isRerankEnabled } from "@/lib/ai/tools/knowledge";
import { brandTitle, getRequestDictionary } from "@/lib/i18n/request-locale";
import { KB_LANGS, loadCorpus, localizeDoc, type KbLang } from "@/lib/rag/corpus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getRequestDictionary();
  return {
    title: brandTitle(t, t.fabKnowledge.title),
    description: t.fabKnowledge.intro,
  };
}

export default function FabKnowledgePage() {
  const corpus = loadCorpus();
  return (
    <>
      <SiteHeader />
      <KnowledgeLab
        docs={corpus.docs.map((d) => ({
          id: d.id,
          type: d.type,
          codes: d.codes,
          localized: Object.fromEntries(KB_LANGS.map((lang) => [lang, localizeDoc(corpus, d, lang)])) as Record<
            KbLang,
            { title: string; headings: string[] }
          >,
        }))}
        sectionCount={corpus.sections.size}
        chunkCount={corpus.chunks.length}
        rerankAvailable={isCloudConfigured() && isRerankEnabled()}
      />
    </>
  );
}
