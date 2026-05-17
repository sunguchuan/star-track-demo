"use client";

import { useState } from "react";
import { EventTimeline } from "./event-timeline";
import { WorkList } from "./work-list";
import type { Star } from "@/lib/types";

type Tab = "events" | "works";

export function StarDetailTabs({ star }: { star: Star }) {
  const [tab, setTab] = useState<Tab>("events");

  return (
    <div>
      <div
        className="mb-4 grid grid-cols-2 rounded-xl bg-violet-100/60 p-1"
        role="tablist"
        aria-label="明星详情分类"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "events"}
          onClick={() => setTab("events")}
          className={`rounded-lg py-2 text-sm font-medium transition-colors ${
            tab === "events"
              ? "bg-white text-violet-900 shadow-sm"
              : "text-violet-700/70"
          }`}
        >
          动态
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "works"}
          onClick={() => setTab("works")}
          className={`rounded-lg py-2 text-sm font-medium transition-colors ${
            tab === "works"
              ? "bg-white text-violet-900 shadow-sm"
              : "text-violet-700/70"
          }`}
        >
          作品
        </button>
      </div>
      <div role="tabpanel">
        {tab === "events" ? (
          <EventTimeline events={star.events} />
        ) : (
          <WorkList works={star.works} />
        )}
      </div>
    </div>
  );
}
