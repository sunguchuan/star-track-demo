"use client";

import { getSourceEntries } from "@/lib/source-links";
import { useLocale } from "@/lib/i18n/locale-context";
import type { StarSources } from "@/lib/types";

export function StarSourcesPanel({ sources }: { sources?: StarSources }) {
  const { t } = useLocale();
  const entries = getSourceEntries(sources);

  if (entries.length === 0 && !sources?.maintainerNotes) {
    return null;
  }

  return (
    <section className="mb-6 rounded-2xl border border-violet-100 bg-violet-50/40 p-4">
      <h2 className="text-sm font-semibold text-violet-900">
        {t.starsPage.sourcesTitle}
      </h2>
      <p className="mt-0.5 text-xs text-violet-700/70">
        {t.starsPage.sourcesHint}
      </p>

      {entries.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {entries.map(({ key, url }) => (
            <li key={key}>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex rounded-full border border-violet-200 bg-white px-3 py-1.5 text-xs font-medium text-violet-800 transition-colors hover:border-violet-300 hover:bg-violet-50"
              >
                {t.starsPage.sources[key]} ↗
              </a>
            </li>
          ))}
        </ul>
      )}

      {sources?.maintainerNotes && (
        <p className="mt-3 rounded-lg bg-white/80 px-3 py-2 text-xs leading-relaxed text-zinc-600">
          <span className="font-medium text-violet-800">
            {t.starsPage.maintainerNotes}
          </span>
          {sources.maintainerNotes}
        </p>
      )}
    </section>
  );
}
