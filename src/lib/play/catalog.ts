import { readFileSync } from "fs";
import { join } from "path";
import { findPolicyViolation, isPlayKind } from "./policy";
import type { Goods, PlayCatalog, Streamer } from "./types";

const CATALOG_PATH = join(process.cwd(), "content/play/catalog.json");

function readCatalogFile(): PlayCatalog {
  const raw = readFileSync(CATALOG_PATH, "utf-8");
  return JSON.parse(raw) as PlayCatalog;
}

export function getPlayCatalog(): PlayCatalog {
  const catalog = readCatalogFile();
  const streamers = catalog.streamers.filter(
    (s) => s.id && s.slug && Array.isArray(s.offers) && s.offers.length > 0,
  );
  const allowedStreamerIds = new Set(streamers.map((s) => s.id));

  const goods = catalog.goods.filter((item) => {
    if (!item.listed || !allowedStreamerIds.has(item.streamerId)) return false;
    if (!isPlayKind(item.kind)) return false;
    return !findPolicyViolation(item.title, item.game, item.details);
  });

  return { streamers, goods };
}

export function getPlayStreamers(): Streamer[] {
  return getPlayCatalog().streamers;
}

export function getListedGoods(): Goods[] {
  return getPlayCatalog().goods;
}

export function getGoodsById(id: string): Goods | undefined {
  return getListedGoods().find((item) => item.id === id);
}

export function getStreamerById(id: string): Streamer | undefined {
  return getPlayStreamers().find((streamer) => streamer.id === id);
}

export function getGoodsForStreamer(streamerId: string): Goods[] {
  return getListedGoods().filter((item) => item.streamerId === streamerId);
}
