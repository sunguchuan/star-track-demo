import { SiteHeader } from "@/components/site-header";
import { formatDate } from "@/lib/format";
import { getPendingInboxItems, getInbox } from "@/lib/inbox";
import Link from "next/link";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "待审核动态 | 星迹 Demo",
  description: "RSS 拉取候选动态，人工审核后录入明星 JSON",
};

export default function InboxPage() {
  const inbox = getInbox();
  const pending = getPendingInboxItems();

  const byStar = pending.reduce<
    Record<string, typeof pending>
  >((acc, item) => {
    if (!acc[item.starSlug]) acc[item.starSlug] = [];
    acc[item.starSlug].push(item);
    return acc;
  }, {});

  return (
    <>
      <SiteHeader />
      <main className="mx-auto min-h-screen max-w-lg px-4 pb-12 pt-6">
        <Link
          href="/"
          className="mb-4 inline-flex text-sm text-violet-700 hover:underline"
        >
          ← 返回首页
        </Link>

        <h1 className="text-2xl font-bold text-violet-950">待审核动态</h1>
        <p className="mt-1 text-sm text-zinc-600">
          由 <code className="rounded bg-violet-50 px-1 text-xs">npm run sync:inbox</code>{" "}
          从 RSS 拉取。确认后再写入对应明星的 <code className="rounded bg-violet-50 px-1 text-xs">events</code>。
        </p>

        {inbox.updatedAt && (
          <p className="mt-2 text-xs text-violet-600/80">
            上次同步：{new Date(inbox.updatedAt).toLocaleString("zh-CN")}
          </p>
        )}

        {pending.length === 0 ? (
          <p className="mt-8 rounded-xl border border-dashed border-violet-200 bg-violet-50/50 px-4 py-10 text-center text-sm text-violet-700/80">
            暂无待审核条目。在项目根目录运行{" "}
            <code className="text-violet-900">npm run sync:inbox</code>。
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
                    艺人页 →
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
                          {formatDate(item.publishedAt)}
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
                        打开原文核对 ↗
                      </a>
                      <p className="mt-3 rounded-lg bg-white/70 px-2 py-1.5 text-[11px] leading-relaxed text-zinc-500">
                        通过后：复制到{" "}
                        <code>content/stars/{slug}.json</code> 的 events，再将本条
                        status 改为 <code>merged</code> 或删除。
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        <section className="mt-10 rounded-xl border border-violet-100 bg-violet-50/50 p-4 text-xs leading-relaxed text-zinc-600">
          <h2 className="font-semibold text-violet-900">维护流程</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-4">
            <li>配置 <code>content/rss-feeds.json</code>（微博 UID / RSSHub 地址）</li>
            <li>运行 <code>npm run sync:inbox</code></li>
            <li>本页核对 → 写入明星 JSON → 标记 merged</li>
            <li>
              <code>git commit</code> 后推送，站点才会更新已发布的 events
            </li>
          </ol>
        </section>
      </main>
    </>
  );
}
