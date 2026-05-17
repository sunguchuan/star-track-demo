import type { Star } from "@/lib/types";
import Link from "next/link";
import { StarAvatar } from "./star-avatar";

export function StarAvatarStrip({ stars }: { stars: Star[] }) {
  return (
    <ul
      className="flex gap-4 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      aria-label="快速进入艺人主页"
    >
      {stars.map((star) => (
        <li key={star.id} className="shrink-0">
          <Link
            href={`/stars/${star.slug}`}
            className="flex w-[4.25rem] flex-col items-center gap-2 transition-opacity hover:opacity-80"
          >
            <div className="rounded-full ring-2 ring-violet-100 ring-offset-2 ring-offset-violet-50/80">
              <StarAvatar name={star.name} size="sm" shape="circle" />
            </div>
            <span className="w-full truncate text-center text-xs font-medium text-violet-950">
              {star.name}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
