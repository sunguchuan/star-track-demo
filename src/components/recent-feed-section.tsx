"use client";

import { parseMonthKey } from "@/lib/format";
import { groupFeedByMonth } from "@/lib/feed";
import {
  formatEventCount,
  formatMonthNavLabel,
} from "@/lib/i18n/format";
import { useLocale } from "@/lib/i18n/locale-context";
import type { FeedItem } from "@/lib/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EventCard } from "./event-card";

export function RecentFeedSection({ events }: { events: FeedItem[] }) {
  const { locale, t } = useLocale();
  const groups = useMemo(() => groupFeedByMonth(events), [events]);
  const [activeMonth, setActiveMonth] = useState(() => groups[0]?.monthKey ?? "");

  const scrollToMonth = useCallback((anchorId: string, monthKey: string) => {
    setActiveMonth(monthKey);
    document.getElementById(anchorId)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, []);

  useEffect(() => {
    if (groups.length === 0) return;
    if (!groups.some((g) => g.monthKey === activeMonth)) {
      setActiveMonth(groups[0].monthKey);
    }
  }, [groups, activeMonth]);

  useEffect(() => {
    if (groups.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const top = visible[0];
        if (top?.target.id) {
          const monthKey = top.target.id.replace("feed-", "");
          setActiveMonth(monthKey);
        }
      },
      { rootMargin: "-35% 0px -45% 0px", threshold: [0, 0.2, 0.5, 1] },
    );

    for (const group of groups) {
      const el = document.getElementById(group.anchorId);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [groups]);

  if (groups.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-violet-200 bg-violet-50/50 px-4 py-8 text-center text-sm text-violet-700/70">
        {t.home.emptyFeed}
      </p>
    );
  }

  return (
    <div className="relative" role="feed" aria-label={t.home.feedAria}>
      <div
        className="pointer-events-none absolute bottom-4 left-[4.25rem] top-2 w-px bg-violet-200"
        aria-hidden
      />

      <div className="space-y-0">
        {groups.map((group, index) => {
          const { year, month } = parseMonthKey(group.monthKey);
          const monthLabel = formatMonthNavLabel(year, month, locale);
          const isActive = activeMonth === group.monthKey;
          const isLast = index === groups.length - 1;

          return (
            <div
              key={group.monthKey}
              id={group.anchorId}
              className="relative flex scroll-mt-28 gap-3"
            >
              <nav
                className="w-[4.25rem] shrink-0"
                aria-label={
                  locale === "zh"
                    ? `${year}年${month}月`
                    : monthLabel.month + " " + year
                }
              >
                <button
                  type="button"
                  onClick={() => scrollToMonth(group.anchorId, group.monthKey)}
                  aria-current={isActive ? "true" : undefined}
                  className={`relative w-full pr-3 text-right transition-colors ${
                    isActive
                      ? "text-violet-900"
                      : "text-violet-500 hover:text-violet-700"
                  }`}
                >
                  <span
                    className={`absolute right-0 top-2 z-10 h-2.5 w-2.5 translate-x-1/2 rounded-full border-2 transition-colors ${
                      isActive
                        ? "border-violet-600 bg-violet-600"
                        : "border-violet-300 bg-white"
                    }`}
                    aria-hidden
                  />
                  <p className="text-[11px] leading-tight tabular-nums">
                    {monthLabel.year}
                  </p>
                  <p className="text-sm font-semibold leading-tight">
                    {monthLabel.month}
                  </p>
                  <p
                    className={`mt-0.5 text-[10px] tabular-nums ${
                      isActive ? "text-violet-600" : "text-violet-400"
                    }`}
                  >
                    {formatEventCount(group.events.length, locale)}
                  </p>
                </button>
              </nav>

              <ul
                className={`min-w-0 flex-1 space-y-3 ${isLast ? "pb-0" : "pb-8"}`}
              >
                {group.events.map((event) => (
                  <EventCard key={event.id} event={event} showStar />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
