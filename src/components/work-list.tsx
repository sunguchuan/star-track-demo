import { formatWorkType } from "@/lib/format";
import type { Work } from "@/lib/types";

export function WorkList({ works }: { works: Work[] }) {
  const sorted = [...works].sort((a, b) => b.year - a.year);

  if (sorted.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-violet-200 bg-violet-50/50 px-4 py-8 text-center text-sm text-violet-700/70">
        暂无作品记录。
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {sorted.map((work) => (
        <li
          key={work.id}
          className="flex items-start justify-between gap-3 rounded-xl border border-violet-100 bg-white p-4 shadow-sm"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-fuchsia-50 px-2 py-0.5 text-xs text-fuchsia-800">
                {formatWorkType(work.type)}
              </span>
              <span className="text-xs text-zinc-500">{work.year}</span>
            </div>
            <h3 className="mt-1 font-medium text-violet-950">{work.title}</h3>
            {work.roleOrTrack && (
              <p className="mt-0.5 text-sm text-zinc-600">{work.roleOrTrack}</p>
            )}
          </div>
          {work.platformUrl && (
            <a
              href={work.platformUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-xs font-medium text-violet-700 hover:underline"
            >
              链接 ↗
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
