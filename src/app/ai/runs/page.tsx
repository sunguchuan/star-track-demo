import { AiRunsContent } from "@/components/ai-runs-content";
import { SiteHeader } from "@/components/site-header";
import { getCloudPrice } from "@/lib/ai/pricing";
import { getRunStats, listRuns } from "@/lib/ai/runs";
import { brandTitle, getRequestDictionary } from "@/lib/i18n/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getRequestDictionary();
  return {
    title: brandTitle(t, t.aiRuns.title),
    description: t.aiRuns.intro,
  };
}

export default function AiRunsPage() {
  return (
    <>
      <SiteHeader />
      <AiRunsContent
        stats={getRunStats()}
        runs={listRuns(25)}
        price={getCloudPrice()}
      />
    </>
  );
}
