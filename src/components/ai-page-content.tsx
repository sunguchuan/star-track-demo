"use client";

import { AiChatPanel } from "@/components/ai-chat-panel";
import { useLocale } from "@/lib/i18n/locale-context";
import Link from "next/link";

export function AiPageContent() {
  const { t } = useLocale();

  return (
    <main className="mx-auto min-h-screen max-w-lg px-4 pb-12 pt-6">
      <Link
        href="/"
        className="mb-4 inline-flex text-sm text-violet-700 hover:underline"
      >
        {t.common.backHome}
      </Link>

      <h1 className="text-2xl font-bold text-violet-950">{t.aiPage.title}</h1>
      <p className="mt-1 text-sm text-zinc-600">
        {t.aiPage.introPrefix}{" "}
        <code className="rounded bg-violet-50 px-1 text-xs">gemma4</code>
        {t.aiPage.introSuffix}
      </p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <Link
          href="/ai/runs"
          className="inline-flex text-xs font-medium text-violet-700 hover:underline"
        >
          {t.aiPage.viewRuns}
        </Link>
        <Link
          href="/fab"
          className="inline-flex text-xs font-medium text-violet-700 hover:underline"
        >
          {t.aiPage.fabInvestigateLink}
        </Link>
      </div>

      <div className="mt-6">
        <AiChatPanel />
      </div>
    </main>
  );
}
