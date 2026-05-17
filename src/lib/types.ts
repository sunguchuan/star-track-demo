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

export interface Star {
  id: string;
  slug: string;
  name: string;
  stageName?: string;
  birthDate: string;
  birthplace?: string;
  bio: string;
  tags: string[];
  works: Work[];
  events: StarEvent[];
}

export interface FeedItem extends StarEvent {
  starSlug: string;
  starName: string;
}
