/** Local notes persistence (browser localStorage) — decoupled from model calls; survives refresh */
export type StoredNote = {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
  lastOutput?: string;
};

export type NotesStore = {
  version: 1;
  activeId: string;
  notes: StoredNote[];
};

export const NOTES_STORAGE_KEY = "startrail-ai-notes-v1";

const SAMPLE_BODY =
  "周杰伦新专辑《最伟大的作品》融合了复古与现代元素，口碑与销量双丰收。";

export function createNote(partial?: Partial<StoredNote>): StoredNote {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: partial?.title?.trim() || "未命名笔记",
    body: partial?.body ?? "",
    updatedAt: now,
    lastOutput: partial?.lastOutput,
  };
}

export function defaultNotesStore(): NotesStore {
  const note = createNote({
    title: "示例笔记",
    body: SAMPLE_BODY,
  });
  return { version: 1, activeId: note.id, notes: [note] };
}

export function loadNotesStore(): NotesStore {
  if (typeof window === "undefined") {
    return defaultNotesStore();
  }

  try {
    const raw = localStorage.getItem(NOTES_STORAGE_KEY);
    if (!raw) return defaultNotesStore();

    const parsed = JSON.parse(raw) as NotesStore;
    if (
      parsed?.version !== 1 ||
      !Array.isArray(parsed.notes) ||
      parsed.notes.length === 0 ||
      typeof parsed.activeId !== "string"
    ) {
      return defaultNotesStore();
    }

    const activeExists = parsed.notes.some((n) => n.id === parsed.activeId);
    return {
      version: 1,
      activeId: activeExists ? parsed.activeId : parsed.notes[0].id,
      notes: parsed.notes.map((n) => ({
        id: String(n.id),
        title: String(n.title || "未命名笔记"),
        body: String(n.body ?? ""),
        updatedAt: String(n.updatedAt || new Date().toISOString()),
        lastOutput:
          typeof n.lastOutput === "string" ? n.lastOutput : undefined,
      })),
    };
  } catch {
    return defaultNotesStore();
  }
}

export function saveNotesStore(store: NotesStore): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(store));
}

export function titleFromBody(body: string): string {
  const line = body
    .trim()
    .split(/\r?\n/)
    .find((l) => l.trim())
    ?.trim();
  if (!line) return "未命名笔记";
  return line.length > 24 ? `${line.slice(0, 24)}…` : line;
}
