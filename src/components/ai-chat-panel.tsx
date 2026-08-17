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
import type {
  AiStrategy,
  AiTaskType,
  StreamEvent,
} from "@/lib/ai/types";

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

type Meta = {
  via: "local" | "cloud";
  model: string;
  reason: string;
};

type UiError = {
  message: string;
  hint?: string;
  code?: string;
  retryable?: boolean;
};

export function AiChatPanel() {
  const { t } = useLocale();
  const copy = t.aiPage;
  const [hydrated, setHydrated] = useState(false);
  const [store, setStore] = useState<NotesStore | null>(null);
  const [taskType, setTaskType] = useState<AiTaskType>("summarize");
  const [strategy, setStrategy] = useState<AiStrategy>("auto");
  const [output, setOutput] = useState("");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const skipPersist = useRef(true);

  useEffect(() => {
    const loaded = loadNotesStore();
    setStore(loaded);
    const active = loaded.notes.find((n) => n.id === loaded.activeId);
    setOutput(active?.lastOutput ?? "");
    setHydrated(true);
  }, []);

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
    setOutput(next.lastOutput ?? "");
    setMeta(null);
    setError(null);
  }

  function addNote() {
    const note = createNote({ title: copy.newNoteTitle, body: "" });
    patchStore((prev) => ({
      ...prev,
      activeId: note.id,
      notes: [note, ...prev.notes],
    }));
    setOutput("");
    setMeta(null);
    setError(null);
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
      setOutput("");
      setMeta(null);
      setError(null);
      return;
    }

    const remaining = store.notes.filter((n) => n.id !== activeNote.id);
    patchStore(() => ({
      version: 1,
      activeId: remaining[0].id,
      notes: remaining,
    }));
    setOutput(remaining[0].lastOutput ?? "");
    setMeta(null);
    setError(null);
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

  /**
   * UI → Gateway: POST /api/ai/chat, then consume SSE
   * (meta shows route → delta drives typewriter → error/done)
   */
  async function run(nextStrategy: AiStrategy = strategy) {
    if (!activeNote?.body.trim() || loading) return;

    const noteId = activeNote.id;
    const input = activeNote.body;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setOutput("");
    setMeta(null);
    setError(null);

    let assembled = "";

    const saveOutput = (text: string) => {
      patchStore((prev) => ({
        ...prev,
        notes: prev.notes.map((n) =>
          n.id === noteId
            ? {
                ...n,
                lastOutput: text,
                updatedAt: new Date().toISOString(),
              }
            : n,
        ),
      }));
    };

    try {
      // Call AI Gateway (server routes + talks to Ollama/cloud)
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input,
          taskType,
          strategy: nextStrategy,
        }),
        signal: ac.signal,
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? `${copy.requestFailed} (${res.status})`);
      }

      if (!res.body) {
        throw new Error(copy.noStream);
      }

      // Parse SSE and update UI from data: events
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;

          let event: StreamEvent;
          try {
            event = JSON.parse(line.slice(5).trim()) as StreamEvent;
          } catch {
            continue;
          }

          if (event.type === "meta") {
            setMeta({
              via: event.via,
              model: event.model,
              reason: event.reason,
            });
          } else if (event.type === "delta") {
            if (assembled.length === 0) {
              setError(null);
            }
            assembled += event.text;
            setOutput(assembled);
          } else if (event.type === "error") {
            setError({
              message: event.message,
              hint: event.hint,
              code: event.code,
              retryable: event.retryable,
            });
          }
        }
      }

      if (assembled) {
        saveOutput(assembled);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        if (assembled) saveOutput(assembled);
        return;
      }
      const message = err instanceof Error ? err.message : copy.requestFailed;
      setError({
        message,
        hint:
          /fetch|network|Failed to fetch/i.test(message)
            ? copy.networkHint
            : copy.retryHint,
        retryable: true,
      });
    } finally {
      setLoading(false);
    }
  }

  function retryLocal() {
    setStrategy("only-local");
    void run("only-local");
  }

  function stop() {
    abortRef.current?.abort();
    setLoading(false);
  }

  if (!hydrated || !store || !activeNote) {
    return (
      <p className="text-sm text-zinc-500">{copy.loading}</p>
    );
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
        <p className="text-xs text-zinc-500">
          {copy.persistHint}
        </p>
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
          disabled={loading || !activeNote.body.trim()}
          className="rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? copy.generating : copy.generate}
        </button>
        {loading && (
          <button
            type="button"
            onClick={stop}
            className="rounded-xl border border-violet-200 bg-white px-4 py-2 text-sm text-violet-800"
          >
            {copy.stop}
          </button>
        )}
      </div>

      {(meta || error || output || loading) && (
        <section className="rounded-xl border border-violet-100 bg-white/80 p-4">
          {meta && (
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
              <span
                className={`rounded-full px-2 py-0.5 font-medium ${
                  meta.via === "local"
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-sky-100 text-sky-800"
                }`}
              >
                via: {meta.via === "local" ? copy.viaLocal : copy.viaCloud}
              </span>
              <span className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-800">
                {meta.model}
              </span>
              <span className="text-zinc-500">{meta.reason}</span>
            </div>
          )}

          {error && (
            <div className="mb-2 space-y-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              <p className="font-medium">{error.message}</p>
              {error.hint && (
                <p className="text-xs text-red-600/90">{error.hint}</p>
              )}
              {(error.code === "quota_exhausted" ||
                error.code === "rate_limited" ||
                error.code === "auth" ||
                error.code === "model_unavailable") &&
                strategy !== "only-local" &&
                !loading && (
                  <button
                    type="button"
                    onClick={retryLocal}
                    className="rounded-md bg-white px-2.5 py-1 text-xs font-medium text-violet-800 ring-1 ring-violet-200 hover:bg-violet-50"
                  >
                    {copy.retryLocal}
                  </button>
                )}
            </div>
          )}

          <div className="min-h-24 whitespace-pre-wrap text-sm leading-relaxed text-violet-950">
            {output || (loading ? "…" : "")}
            {loading && (
              <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-violet-500 align-middle" />
            )}
          </div>
        </section>
      )}
    </div>
  );
}
