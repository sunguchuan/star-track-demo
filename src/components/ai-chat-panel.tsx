"use client";

/**
 * Hybrid AI chat panel
 * Workflow: edit note → pick task/strategy → POST /api/ai/chat → consume SSE and render
 */
import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/i18n/locale-context";
import {
  createNote,
  loadNotesStore,
  saveNotesStore,
  titleFromBody,
  type NotesStore,
  type StoredNote,
} from "@/lib/ai/notes-storage";
import type { AiStrategy, AiTaskType } from "@/lib/ai/types";
import { useAiStream } from "@/lib/ai/use-ai-stream";
import { AiRunResult } from "@/components/ai-run-result";

/** investigate lives on /fab (FabInvestigatePanel), next to the data it reads. */
const TASK_VALUES: AiTaskType[] = [
  "summarize",
  "polish",
  "continue",
  "translate",
  "tags",
  "analyze",
  "refactor",
  "chat",
];

const CLOUD_TASKS = new Set<AiTaskType>(["analyze", "refactor"]);
const STRATEGY_VALUES: AiStrategy[] = ["auto", "only-local", "only-cloud"];

export function AiChatPanel() {
  const { t } = useLocale();
  const copy = t.aiPage;
  const [hydrated, setHydrated] = useState(false);
  const [store, setStore] = useState<NotesStore | null>(null);
  const [taskType, setTaskType] = useState<AiTaskType>("summarize");
  const [strategy, setStrategy] = useState<AiStrategy>("auto");
  const { state, start, stop, reset, sendFeedback } = useAiStream(copy);
  const skipPersist = useRef(true);

  useEffect(() => {
    const loaded = loadNotesStore();
    setStore(loaded);
    const active = loaded.notes.find((n) => n.id === loaded.activeId);
    reset(active?.lastOutput ?? "");
    setHydrated(true);
  }, [reset]);

  useEffect(() => {
    if (!hydrated || !store) return;
    if (skipPersist.current) {
      skipPersist.current = false;
      return;
    }
    saveNotesStore(store);
  }, [hydrated, store]);

  const activeNote: StoredNote | null =
    store?.notes.find((n) => n.id === store.activeId) ?? null;

  function patchStore(updater: (prev: NotesStore) => NotesStore) {
    setStore((prev) => (prev ? updater(prev) : prev));
  }

  function selectNote(id: string) {
    if (!store || id === store.activeId) return;
    const next = store.notes.find((n) => n.id === id);
    if (!next) return;

    patchStore((prev) => ({ ...prev, activeId: id }));
    reset(next.lastOutput ?? "");
  }

  function addNote() {
    const note = createNote({ title: copy.newNoteTitle, body: "" });
    patchStore((prev) => ({
      ...prev,
      activeId: note.id,
      notes: [note, ...prev.notes],
    }));
    reset();
  }

  function deleteActiveNote() {
    if (!store || !activeNote) return;
    if (store.notes.length <= 1) {
      const fresh = createNote({ title: copy.newNoteTitle, body: "" });
      patchStore(() => ({
        version: 1,
        activeId: fresh.id,
        notes: [fresh],
      }));
      reset();
      return;
    }

    const remaining = store.notes.filter((n) => n.id !== activeNote.id);
    patchStore(() => ({
      version: 1,
      activeId: remaining[0].id,
      notes: remaining,
    }));
    reset(remaining[0].lastOutput ?? "");
  }

  function updateBody(body: string) {
    if (!activeNote) return;
    const autoTitles = new Set([
      copy.untitled,
      copy.newNoteTitle,
      copy.sampleNote,
      "未命名笔记",
      "新笔记",
      "示例笔记",
    ]);
    const title =
      autoTitles.has(activeNote.title) ||
      activeNote.title === titleFromBody(activeNote.body)
        ? titleFromBody(body)
        : activeNote.title;

    patchStore((prev) => ({
      ...prev,
      notes: prev.notes.map((n) =>
        n.id === activeNote.id
          ? { ...n, body, title, updatedAt: new Date().toISOString() }
          : n,
      ),
    }));
  }

  async function run(nextStrategy: AiStrategy = strategy) {
    if (!activeNote?.body.trim() || state.loading) return;

    const noteId = activeNote.id;
    const text = await start({
      input: activeNote.body,
      taskType,
      strategy: nextStrategy,
    });

    if (text) {
      patchStore((prev) => ({
        ...prev,
        notes: prev.notes.map((n) =>
          n.id === noteId
            ? { ...n, lastOutput: text, updatedAt: new Date().toISOString() }
            : n,
        ),
      }));
    }
  }

  function retryLocal() {
    setStrategy("only-local");
    void run("only-local");
  }

  if (!hydrated || !store || !activeNote) {
    return <p className="text-sm text-zinc-500">{copy.loading}</p>;
  }

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-violet-950">{copy.notes}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={addNote}
              className="rounded-lg bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-900 hover:bg-violet-200"
            >
              {copy.newNote}
            </button>
            <button
              type="button"
              onClick={deleteActiveNote}
              className="rounded-lg bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-200"
            >
              {copy.deleteNote}
            </button>
          </div>
        </div>
        <ul className="flex gap-2 overflow-x-auto pb-1">
          {store.notes.map((note) => (
            <li key={note.id} className="shrink-0">
              <button
                type="button"
                onClick={() => selectNote(note.id)}
                className={`max-w-36 truncate rounded-lg px-3 py-1.5 text-left text-xs font-medium transition-colors ${
                  note.id === store.activeId
                    ? "bg-violet-700 text-white"
                    : "bg-white text-violet-900 ring-1 ring-violet-200 hover:bg-violet-50"
                }`}
                title={note.title}
              >
                {note.title}
              </button>
            </li>
          ))}
        </ul>
        <p className="text-xs text-zinc-500">{copy.persistHint}</p>
      </section>

      <section className="space-y-2">
        <label
          htmlFor="ai-note"
          className="text-sm font-medium text-violet-950"
        >
          {copy.noteBody}
        </label>
        <textarea
          id="ai-note"
          value={activeNote.body}
          onChange={(e) => updateBody(e.target.value)}
          rows={6}
          className="w-full resize-y rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm text-violet-950 shadow-sm outline-none ring-violet-400 focus:ring-2"
          placeholder={copy.placeholder}
        />
        <p className="text-xs text-zinc-500">
          {activeNote.body.trim().length} {copy.charUnit}
        </p>
      </section>

      <section className="space-y-2">
        <p className="text-sm font-medium text-violet-950">{copy.taskType}</p>
        <div className="flex flex-wrap gap-2">
          {TASK_VALUES.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setTaskType(value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                taskType === value
                  ? "bg-violet-700 text-white"
                  : "bg-violet-100 text-violet-900 hover:bg-violet-200"
              }`}
            >
              {copy.tasks[value]}
              <span className="ml-1 opacity-70">
                ·{CLOUD_TASKS.has(value) ? copy.hintCloud : copy.hintLocal}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <p className="text-sm font-medium text-violet-950">{copy.strategy}</p>
        <div className="flex flex-wrap gap-2">
          {STRATEGY_VALUES.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setStrategy(value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                strategy === value
                  ? "bg-fuchsia-700 text-white"
                  : "bg-fuchsia-100 text-fuchsia-950 hover:bg-fuchsia-200"
              }`}
            >
              {copy.strategies[value]}
            </button>
          ))}
        </div>
      </section>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void run()}
          disabled={state.loading || !activeNote.body.trim()}
          className="rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state.loading ? copy.generating : copy.generate}
        </button>
        {state.loading && (
          <button
            type="button"
            onClick={stop}
            className="rounded-xl border border-violet-200 bg-white px-4 py-2 text-sm text-violet-800"
          >
            {copy.stop}
          </button>
        )}
      </div>

      <AiRunResult
        state={state}
        copy={copy}
        onRetryLocal={strategy !== "only-local" ? retryLocal : undefined}
        onFeedback={(score) => void sendFeedback(score)}
      />
    </div>
  );
}
