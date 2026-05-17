import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import type { FeedItem, Star } from "./types";

const CONTENT_DIR = join(process.cwd(), "content/stars");

function readStarFile(filename: string): Star {
  const raw = readFileSync(join(CONTENT_DIR, filename), "utf-8");
  return JSON.parse(raw) as Star;
}

export function getAllStars(): Star[] {
  const files = readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".json"));
  return files
    .map(readStarFile)
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

export function getStarBySlug(slug: string): Star | undefined {
  return getAllStars().find((star) => star.slug === slug);
}

export function getAllStarSlugs(): string[] {
  return getAllStars().map((star) => star.slug);
}

export function getRecentFeed(limit = 10): FeedItem[] {
  const items: FeedItem[] = [];

  for (const star of getAllStars()) {
    for (const event of star.events) {
      items.push({
        ...event,
        starSlug: star.slug,
        starName: star.stageName ?? star.name,
      });
    }
  }

  return items
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}
