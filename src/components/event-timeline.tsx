import type { FeedItem, StarEvent } from "@/lib/types";
import { EventCard } from "./event-card";

type TimelineEvent = StarEvent & { starSlug?: string; starName?: string };

export function EventTimeline({
  events,
  showStar = false,
}: {
  events: TimelineEvent[] | FeedItem[];
  showStar?: boolean;
}) {
  const sorted = [...events].sort((a, b) => b.date.localeCompare(a.date));

  if (sorted.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-violet-200 bg-violet-50/50 px-4 py-8 text-center text-sm text-violet-700/70">
        暂无动态，请在 content/stars 对应 JSON 中补充 events。
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {sorted.map((event) => (
        <EventCard key={event.id} event={event} showStar={showStar} />
      ))}
    </ul>
  );
}
