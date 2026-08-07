/**
 * 从 RSS 拉取候选动态，写入 content/inbox/pending.json（待人工审核后录入 stars JSON）
 *
 * 用法: npm run sync:inbox
 */
import { createHash } from "crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import Parser from "rss-parser";

const ROOT = process.cwd();
const RSS_CONFIG_PATH = join(ROOT, "content/rss-feeds.json");
const STARS_DIR = join(ROOT, "content/stars");
const INBOX_DIR = join(ROOT, "content/inbox");
const INBOX_PATH = join(INBOX_DIR, "pending.json");

const parser = new Parser({
  timeout: 20000,
  headers: {
    "User-Agent": "StarTrackDemo/1.0 (RSS inbox sync)",
  },
});

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf-8"));
}

function loadStarNames() {
  const names = new Map();
  if (!existsSync(STARS_DIR)) return names;
  for (const file of readdirSync(STARS_DIR)) {
    if (!file.endsWith(".json") || file.startsWith("_")) continue;
    const star = JSON.parse(readFileSync(join(STARS_DIR, file), "utf-8"));
    names.set(star.slug, star.stageName ?? star.name);
  }
  return names;
}

function itemId(starSlug, link) {
  return createHash("sha256").update(`${starSlug}::${link}`).digest("hex").slice(0, 16);
}

function toDateString(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function stripHtml(text) {
  return (text ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFeedUrl(config, feed) {
  if (feed.url) return feed.url;
  if (feed.weiboUid) {
    const base = (config.rsshubBase ?? "https://rsshub.app").replace(/\/$/, "");
    return `${base}/weibo/user/${feed.weiboUid}`;
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchFeed(url) {
  return parser.parseURL(url);
}

async function main() {
  const config = loadJson(RSS_CONFIG_PATH, null);
  if (!config?.feeds?.length) {
    console.error("未找到 content/rss-feeds.json 或 feeds 为空");
    process.exit(1);
  }

  const starNames = loadStarNames();
  const inbox = loadJson(INBOX_PATH, { updatedAt: null, items: [] });
  const knownIds = new Set(inbox.items.map((i) => i.id));

  let added = 0;
  let errors = 0;
  const fetchedAt = new Date().toISOString();

  const enabledFeeds = config.feeds.filter((f) => f.enabled !== false);

  for (const feed of enabledFeeds) {
    const url = buildFeedUrl(config, feed);
    const starName = starNames.get(feed.starSlug);

    if (!url) {
      console.warn(`跳过 ${feed.starSlug} / ${feed.label}：未配置 url 或 weiboUid`);
      continue;
    }
    if (!starName) {
      console.warn(`跳过 ${feed.starSlug}：content/stars 中无对应艺人`);
      continue;
    }

    process.stdout.write(`拉取 ${starName} · ${feed.label} … `);

    try {
      const rss = await fetchFeed(url);
      let feedAdded = 0;

      for (const entry of rss.items ?? []) {
        const link = entry.link || entry.guid;
        if (!link) continue;

        const id = itemId(feed.starSlug, link);
        if (knownIds.has(id)) continue;

        const title = (entry.title || "（无标题）").trim();
        const summary = stripHtml(entry.contentSnippet || entry.content || entry.summary || title).slice(0, 280);

        inbox.items.push({
          id,
          starSlug: feed.starSlug,
          starName,
          feedLabel: feed.label,
          title,
          link,
          publishedAt: toDateString(entry.isoDate || entry.pubDate),
          summary,
          status: "pending",
          fetchedAt,
        });

        knownIds.add(id);
        added += 1;
        feedAdded += 1;
      }

      console.log(`+${feedAdded} 条`);
    } catch (err) {
      errors += 1;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`失败: ${msg}`);
    }

    await sleep(1200);
  }

  inbox.items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  inbox.updatedAt = fetchedAt;

  if (!existsSync(INBOX_DIR)) mkdirSync(INBOX_DIR, { recursive: true });
  writeFileSync(INBOX_PATH, `${JSON.stringify(inbox, null, 2)}\n`, "utf-8");

  const pending = inbox.items.filter((i) => i.status === "pending").length;

  console.log("\n完成");
  console.log(`  新增候选: ${added}`);
  console.log(`  待审核合计: ${pending}`);
  console.log(`  拉取失败: ${errors}`);
  console.log(`  输出: content/inbox/pending.json`);
  console.log("\n下一步: 打开 /inbox 审核，或编辑 stars JSON 后把条目标为 merged/skipped");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
