import { notFound } from "next/navigation";
import { AiTraceContent } from "@/components/ai-trace-content";
import { SiteHeader } from "@/components/site-header";
import { getLangfuseTraceUrl, isLangfuseEnabled } from "@/lib/ai/langfuse-config";
import { getRunTrace } from "@/lib/ai/runs";
import { brandTitle, getRequestDictionary } from "@/lib/i18n/request-locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getRequestDictionary();
  return {
    title: brandTitle(t, t.aiTrace.title),
    description: t.aiTrace.intro,
  };
}

export default async function AiRunTracePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const trace = getRunTrace(id);
  if (!trace) notFound();

  return (
    <>
      <SiteHeader />
      <AiTraceContent
        run={trace.run}
        spans={trace.spans}
        langfuseEnabled={isLangfuseEnabled()}
        langfuseUrl={trace.spans.length > 0 ? getLangfuseTraceUrl(id.replace(/-/g, "")) : null}
      />
    </>
  );
}
