export type WorkType = "film" | "music" | "variety" | "stage";

export type EventType =
  | "announcement"
  | "award"
  | "activity"
  | "release"
  | "other";

export type Reliability = "confirmed" | "media";

export interface Work {
  id: string;
  type: WorkType;
  title: string;
  year: number;
  roleOrTrack?: string;
  platformUrl?: string;
}

export interface StarEvent {
  id: string;
  date: string;
  type: EventType;
  title: string;
  summary: string;
  sourceName: string;
  sourceUrl: string;
  reliability?: Reliability;
}

/** 运营用：摘取信息时常用的官方/平台链接（维护时打开，访客也可查阅出处） */
export interface StarSources {
  weibo?: string;
  studioWeibo?: string;
  douban?: string;
  neteaseMusic?: string;
  qqMusic?: string;
  bilibili?: string;
  /** 维护节奏、核对习惯等，仅展示给运营参考 */
  maintainerNotes?: string;
}

export interface Star {
  id: string;
  slug: string;
  name: string;
  stageName?: string;
  birthDate: string;
  birthplace?: string;
  bio: string;
  tags: string[];
  sources?: StarSources;
  works: Work[];
  events: StarEvent[];
}

export interface FeedItem extends StarEvent {
  starSlug: string;
  starName: string;
}

export type InboxItemStatus = "pending" | "merged" | "skipped";

export interface InboxItem {
  id: string;
  starSlug: string;
  starName: string;
  feedLabel: string;
  title: string;
  link: string;
  publishedAt: string;
  summary: string;
  status: InboxItemStatus;
  fetchedAt: string;
}

export interface InboxFile {
  updatedAt: string | null;
  items: InboxItem[];
}
