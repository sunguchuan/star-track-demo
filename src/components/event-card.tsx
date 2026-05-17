import { formatDate, formatEventType } from "@/lib/format";
import type { FeedItem, StarEvent } from "@/lib/types";
import Link from "next/link";

type EventCardData = StarEvent & { starSlug?: string; starName?: string };

export function EventCard({
  event,
  showStar = false,
}: {
  event: EventCardData | FeedItem;
  showStar?: boolean;
}) {
  return (
    <li className="rounded-xl border border-violet-100 bg-white p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <time className="text-xs font-medium text-violet-600">
          {formatDate(event.date)}
        </time>
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-800">
          {formatEventType(event.type)}
        </span>
        {showStar && "starName" in event && event.starName && event.starSlug && (
          <Link
            href={`/stars/${event.starSlug}`}
            className="text-xs font-medium text-fuchsia-700 hover:underline"
          >
            {event.starName}
          </Link>
        )}
      </div>
      <h3 className="font-medium text-violet-950">{event.title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-zinc-600">{event.summary}</p>
      <a
        href={event.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-flex text-xs font-medium text-violet-700 hover:text-violet-900 hover:underline"
      >
        来源：{event.sourceName} ↗
      </a>
    </li>
  );
}
