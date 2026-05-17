const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const workTypeLabels: Record<string, string> = {
  film: "影视",
  music: "音乐",
  variety: "综艺",
  stage: "舞台",
};

const eventTypeLabels: Record<string, string> = {
  announcement: "官宣",
  award: "获奖",
  activity: "活动",
  release: "发布",
  other: "动态",
};

export function formatDate(date: string): string {
  return dateFormatter.format(new Date(date));
}

/** @param monthKey `YYYY-MM` */
export function formatMonthLabel(monthKey: string): string {
  const { year, month } = parseMonthKey(monthKey);
  return `${year}年${month}月`;
}

/** @param monthKey `YYYY-MM` */
export function parseMonthKey(monthKey: string): { year: number; month: number } {
  const [year, month] = monthKey.split("-").map(Number);
  return { year, month };
}

export function formatWorkType(type: string): string {
  return workTypeLabels[type] ?? type;
}

export function formatEventType(type: string): string {
  return eventTypeLabels[type] ?? type;
}
