import { formatMonthLabel } from "./format";
import type { FeedItem } from "./types";

export interface FeedMonthGroup {
  monthKey: string;
  anchorId: string;
  label: string;
  events: FeedItem[];
}

export function groupFeedByMonth(events: FeedItem[]): FeedMonthGroup[] {
  const sorted = [...events].sort((a, b) => b.date.localeCompare(a.date));
  const map = new Map<string, FeedItem[]>();

  for (const event of sorted) {
    const monthKey = event.date.slice(0, 7);
    const list = map.get(monthKey) ?? [];
    list.push(event);
    map.set(monthKey, list);
  }

  return [...map.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([monthKey, monthEvents]) => ({
      monthKey,
      anchorId: `feed-${monthKey}`,
      label: formatMonthLabel(monthKey),
      events: monthEvents,
    }));
}
