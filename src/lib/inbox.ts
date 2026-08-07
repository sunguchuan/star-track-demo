import { readFileSync } from "fs";
import { join } from "path";
import type { InboxFile, InboxItem } from "./types";

const INBOX_PATH = join(process.cwd(), "content/inbox/pending.json");

export function getInbox(): InboxFile {
  try {
    const raw = readFileSync(INBOX_PATH, "utf-8");
    return JSON.parse(raw) as InboxFile;
  } catch {
    return { updatedAt: null, items: [] };
  }
}

export function getPendingInboxItems(): InboxItem[] {
  return getInbox()
    .items.filter((item) => item.status === "pending")
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export function getPendingInboxCount(): number {
  return getPendingInboxItems().length;
}
