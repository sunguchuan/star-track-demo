import type { StarSources } from "./types";

export const SOURCE_LINK_LABELS: Record<
  keyof Omit<StarSources, "maintainerNotes">,
  string
> = {
  weibo: "个人微博",
  studioWeibo: "工作室微博",
  douban: "豆瓣",
  neteaseMusic: "网易云音乐",
  qqMusic: "QQ 音乐",
  bilibili: "哔哩哔哩",
};

export function getSourceEntries(
  sources: StarSources | undefined,
): { key: keyof typeof SOURCE_LINK_LABELS; label: string; url: string }[] {
  if (!sources) return [];

  return (
    Object.keys(SOURCE_LINK_LABELS) as (keyof typeof SOURCE_LINK_LABELS)[]
  )
    .filter((key) => {
      const url = sources[key];
      return typeof url === "string" && url.trim().length > 0;
    })
    .map((key) => ({
      key,
      label: SOURCE_LINK_LABELS[key],
      url: sources[key]!.trim(),
    }));
}
