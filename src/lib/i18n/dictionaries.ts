export type Locale = "zh" | "en";

export const LOCALES: Locale[] = ["zh", "en"];

export const LOCALE_STORAGE_KEY = "startrail-locale";

export const dictionaries = {
  zh: {
    brand: "星迹 Demo",
    brandMark: "星",
    nav: {
      home: "首页",
      stars: "明星",
      inbox: "待审",
      ai: "AI",
      about: "关于",
    },
    langToggle: {
      aria: "切换语言",
      zh: "中文",
      en: "EN",
    },
    home: {
      title: "内娱艺人动态",
      catalogPrefix: "共收录",
      catalogSuffix: "位艺人",
      allStars: "全部明星 →",
      recentUpdates: "最近更新",
      feedAria: "最近更新时间线",
      emptyFeed: "暂无动态，请在 content/stars 对应 JSON 中补充 events。",
      avatarStripAria: "快速进入艺人主页",
      monthSuffix: "月",
      eventCountSuffix: "条",
      sourcePrefix: "来源：",
    },
    eventType: {
      announcement: "官宣",
      award: "获奖",
      activity: "活动",
      release: "发布",
      other: "动态",
    },
  },
  en: {
    brand: "Star Trail Demo",
    brandMark: "S",
    nav: {
      home: "Home",
      stars: "Stars",
      inbox: "Inbox",
      ai: "AI",
      about: "About",
    },
    langToggle: {
      aria: "Switch language",
      zh: "中文",
      en: "EN",
    },
    home: {
      title: "C-pop artist updates",
      catalogPrefix: "Featuring",
      catalogSuffix: "artists",
      allStars: "All stars →",
      recentUpdates: "Latest updates",
      feedAria: "Latest updates timeline",
      emptyFeed:
        "No updates yet. Add events in the matching content/stars JSON files.",
      avatarStripAria: "Quick links to artist pages",
      monthSuffix: "",
      eventCountSuffix: "",
      sourcePrefix: "Source: ",
    },
    eventType: {
      announcement: "Announcement",
      award: "Award",
      activity: "Event",
      release: "Release",
      other: "Update",
    },
  },
} as const;

export type Dictionary = (typeof dictionaries)[Locale];

export function isLocale(value: unknown): value is Locale {
  return value === "zh" || value === "en";
}
