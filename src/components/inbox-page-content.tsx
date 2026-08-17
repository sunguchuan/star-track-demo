"use client";

import { formatDateLocalized } from "@/lib/i18n/format";
import { useLocale } from "@/lib/i18n/locale-context";
import type { InboxFile, InboxItem } from "@/lib/types";
import Link from "next/link";

export function InboxPageContent({
  inbox,
  pending,
}: {
  inbox: InboxFile;
  pending: InboxItem[];
}) {
  const { locale, t } = useLocale();
  const copy = t.inboxPage;

  const byStar = pending.reduce<Record<string, InboxItem[]>>((acc, item) => {
    if (!acc[item.starSlug]) acc[item.starSlug] = [];
    acc[item.starSlug].push(item);
    return acc;
  }, {});

  return (
    <main className="mx-auto min-h-screen max-w-lg px-4 pb-12 pt-6">
      <Link
        href="/"
        className="mb-4 inline-flex text-sm text-violet-700 hover:underline"
      >
        {t.common.backHome}
      </Link>

      <h1 className="text-2xl font-bold text-violet-950">{copy.title}</h1>
      <p className="mt-1 text-sm text-zinc-600">
        {copy.introPrefix}{" "}
        <code className="rounded bg-violet-50 px-1 text-xs">
          npm run sync:inbox
        </code>{" "}
        {copy.introMid}{" "}
        <code className="rounded bg-violet-50 px-1 text-xs">events</code>
        {copy.introSuffix}
      </p>

      {inbox.updatedAt && (
        <p className="mt-2 text-xs text-violet-600/80">
          {copy.lastSync}
          {new Date(inbox.updatedAt).toLocaleString(
            locale === "zh" ? "zh-CN" : "en-US",
          )}
        </p>
      )}

      {pending.length === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed border-violet-200 bg-violet-50/50 px-4 py-10 text-center text-sm text-violet-700/80">
          {copy.emptyPrefix}{" "}
          <code className="text-violet-900">npm run sync:inbox</code>
        </p>
      ) : (
        <div className="mt-6 space-y-8">
          {Object.entries(byStar).map(([slug, items]) => (
            <section key={slug}>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="font-semibold text-violet-950">
                  {items[0].starName}
                </h2>
                <Link
                  href={`/stars/${slug}`}
                  className="text-xs font-medium text-violet-700 hover:underline"
                >
                  {copy.starPage}
                </Link>
              </div>
              <ul className="space-y-3">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className="rounded-xl border border-amber-100 bg-amber-50/30 p-4"
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-full bg-violet-100 px-2 py-0.5 text-violet-800">
                        {item.feedLabel}
                      </span>
                      <time className="text-violet-700">
                        {formatDateLocalized(item.publishedAt, locale)}
                      </time>
                      <span className="text-zinc-400">id: {item.id}</span>
                    </div>
                    <h3 className="font-medium text-violet-950">{item.title}</h3>
                    {item.summary && (
                      <p className="mt-1 line-clamp-3 text-sm text-zinc-600">
                        {item.summary}
                      </p>
                    )}
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex text-xs font-medium text-violet-700 hover:underline"
                    >
                      {copy.openSource}
                    </a>
                    <p className="mt-3 rounded-lg bg-white/70 px-2 py-1.5 text-[11px] leading-relaxed text-zinc-500">
                      {copy.mergeHintPrefix}{" "}
                      <code>content/stars/{slug}.json</code>{" "}
                      {copy.mergeHintSuffix}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <section className="mt-10 rounded-xl border border-violet-100 bg-violet-50/50 p-4 text-xs leading-relaxed text-zinc-600">
        <h2 className="font-semibold text-violet-900">{copy.workflowTitle}</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-4">
          <li>{copy.step1}</li>
          <li>{copy.step2}</li>
          <li>{copy.step3}</li>
          <li>{copy.step4}</li>
        </ol>
      </section>
    </main>
  );
}
