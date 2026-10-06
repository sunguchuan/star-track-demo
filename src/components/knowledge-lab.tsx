"use client";

/**
 * Retrieval lab: one query → POST /api/fab/knowledge → BM25 / vector / RRF / rerank rankings
 * side by side, plus the sections the agent would receive. Hovering a row highlights the same
 * section in every stage, so it is visible how fusion and reranking move it.
 */
import Link from "next/link";
import { useState } from "react";
import { useLocale } from "@/lib/i18n/locale-context";
import type { KbDocType, KbLang } from "@/lib/rag/corpus";

type DocSummary = {
  id: string;
  type: KbDocType;
  codes: string[];
  localized: Record<KbLang, { title: string; headings: string[] }>;
};

type StageRow = { sectionId: string; docId: string; heading: string; score: number };

type Hit = {
  sectionId: string;
  docId: string;
  docTitle: string;
  heading: string;
  text: string;
  matchedBy: string[];
  fusedRank: number;
  relevance: number | null;
  translated: boolean;
};

type SearchResponse = {
  language: KbLang;
  filterRelaxed: boolean;
  mode: "bm25" | "vector" | "hybrid";
  embedModel: string | null;
  vectorError: string | null;
  rerankModel: string | null;
  rerankError: string | null;
  similarityFloor: number | null;
  minRelevance: number;
  stages: { bm25: StageRow[]; vector: StageRow[]; fused: StageRow[]; rerank: StageRow[] | null };
  hits: Hit[];
  ms: number;
};

type StageKey = keyof SearchResponse["stages"];

const STAGES: StageKey[] = ["bm25", "vector", "fused", "rerank"];
const ROWS_PER_STAGE = 8;

function formatScore(stage: StageKey, score: number): string {
  if (stage === "rerank") return `${score}/3`;
  if (stage === "fused") return score.toFixed(4);
  if (stage === "vector") return score.toFixed(3);
  return score.toFixed(2);
}

type Props = {
  docs: DocSummary[];
  sectionCount: number;
  chunkCount: number;
  rerankAvailable: boolean;
};

export function KnowledgeLab({ docs, sectionCount, chunkCount, rerankAvailable }: Props) {
  const { t, locale } = useLocale();
  const copy = t.fabKnowledge;
  const [query, setQuery] = useState("");
  const [docType, setDocType] = useState<"" | KbDocType>("");
  const [alertCode, setAlertCode] = useState("");
  const [rerank, setRerank] = useState(rerankAvailable);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const alertCodes = [...new Set(docs.flatMap((d) => d.codes))].sort();
  const finalIds = new Set(result?.hits.map((h) => h.sectionId));

  async function search(text = query) {
    const q = text.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/fab/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, docType: docType || undefined, alertCode: alertCode || undefined, rerank }),
      });
      const data = (await res.json()) as SearchResponse | { error: string };
      if (!res.ok || "error" in data) {
        setError("error" in data ? data.error : `HTTP ${res.status}`);
        setResult(null);
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 pb-12 pt-6">
      <Link href="/fab" className="mb-4 inline-flex text-sm text-violet-700 hover:underline">
        {copy.back}
      </Link>
      <h1 className="text-2xl font-bold text-violet-950">{copy.title}</h1>
      <p className="mt-1 max-w-3xl text-sm leading-relaxed text-zinc-600">{copy.intro}</p>

      <section className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm text-zinc-600">
        <span>
          <b className="tabular-nums text-violet-950">{docs.length}</b> {copy.corpusDocs}
        </span>
        <span>
          <b className="tabular-nums text-violet-950">{sectionCount}</b> {copy.corpusSections}
        </span>
        <span>
          <b className="tabular-nums text-violet-950">{chunkCount}</b> {copy.corpusChunks}
        </span>
      </section>
      <details className="mt-2 text-xs text-zinc-600">
        <summary className="cursor-pointer text-violet-700">{copy.corpusList}</summary>
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {docs.map((d) => (
            <li key={d.id} className="rounded-lg border border-violet-100 bg-white px-2.5 py-1.5">
              <span className="font-mono text-violet-900">{d.id}</span>{" "}
              <span className="text-zinc-400">· {copy.docTypes[d.type]}</span>
              <p className="text-zinc-700">{d.localized[locale].title}</p>
              <p className="text-[11px] text-zinc-400">{d.localized[locale].headings.join(" / ")}</p>
            </li>
          ))}
        </ul>
      </details>

      <section className="mt-5 rounded-2xl border border-violet-200 bg-gradient-to-b from-violet-50 to-white p-4 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {copy.examples.map((example) => (
            <button
              key={example}
              type="button"
              disabled={loading}
              onClick={() => {
                setQuery(example);
                void search(example);
              }}
              className="rounded-full bg-white px-3 py-1 text-left text-xs text-violet-900 ring-1 ring-violet-200 hover:bg-violet-50 disabled:opacity-50"
            >
              {example}
            </button>
          ))}
        </div>
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <label htmlFor="kb-query" className="sr-only">
            {copy.queryLabel}
          </label>
          <input
            id="kb-query"
            value={query}
            maxLength={300}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={copy.placeholder}
            className="flex-1 rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm text-violet-950 shadow-sm outline-none ring-violet-400 focus:ring-2"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? copy.searching : copy.search}
          </button>
        </form>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-600">
          <label className="flex items-center gap-1.5">
            {copy.filterType}
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value as "" | KbDocType)}
              className="rounded-md border border-violet-200 bg-white px-1.5 py-1"
            >
              <option value="">{copy.filterAny}</option>
              {(Object.keys(copy.docTypes) as KbDocType[]).map((type) => (
                <option key={type} value={type}>
                  {copy.docTypes[type]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            {copy.filterCode}
            <select
              value={alertCode}
              onChange={(e) => setAlertCode(e.target.value)}
              className="rounded-md border border-violet-200 bg-white px-1.5 py-1 font-mono"
            >
              <option value="">{copy.filterAny}</option>
              {alertCodes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          <label className={`flex items-center gap-1.5 ${rerankAvailable ? "" : "opacity-50"}`}>
            <input
              type="checkbox"
              checked={rerank}
              disabled={!rerankAvailable}
              onChange={(e) => setRerank(e.target.checked)}
            />
            {copy.rerank}
          </label>
        </div>
      </section>

      {error && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {copy.error}: {error}
        </p>
      )}

      {result && (
        <>
          <p className="mt-4 text-xs text-zinc-500">
            {result.mode} · {copy.embedModel}: {result.embedModel ?? "—"}
            {result.rerankModel && ` · rerank: ${result.rerankModel}`} · {copy.latency} {result.ms} ms ·{" "}
            {copy.resultLanguage}: {copy.languageNames[result.language]}
          </p>
          {(result.vectorError || result.rerankError || result.filterRelaxed) && (
            <ul className="mt-2 space-y-1 text-xs text-amber-900">
              {result.vectorError && <li>{copy.noVector}{result.vectorError}</li>}
              {result.rerankError && <li>{copy.rerankFailed}{result.rerankError}</li>}
              {result.filterRelaxed && <li>{copy.filterRelaxed}</li>}
            </ul>
          )}

          <section className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {STAGES.map((stage) => {
              const rows = result.stages[stage];
              return (
                <div key={stage} className="rounded-xl border border-violet-100 bg-white p-3 shadow-sm">
                  <h2 className="text-sm font-semibold text-violet-950">{copy.stages[stage]}</h2>
                  <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">{copy.stageHints[stage]}</p>
                  {rows == null ? (
                    <p className="mt-3 text-xs text-zinc-400">
                      {copy.notReranked}
                      {result.similarityFloor != null && ` ${copy.floor} ${result.similarityFloor}`}
                    </p>
                  ) : rows.length === 0 ? (
                    <p className="mt-3 text-xs text-zinc-400">{copy.empty}</p>
                  ) : (
                    <ol className="mt-2 space-y-1">
                      {rows.slice(0, ROWS_PER_STAGE).map((row, i) => {
                        const dropped = stage === "rerank" && row.score < result.minRelevance;
                        return (
                          <li
                            key={row.sectionId}
                            onMouseEnter={() => setHovered(row.sectionId)}
                            onMouseLeave={() => setHovered(null)}
                            className={`flex gap-1.5 rounded-md px-1.5 py-1 text-[11px] leading-snug ${
                              hovered === row.sectionId
                                ? "bg-fuchsia-100"
                                : finalIds.has(row.sectionId)
                                  ? "bg-violet-50"
                                  : ""
                            } ${dropped ? "opacity-40" : ""}`}
                          >
                            <span className="w-4 shrink-0 tabular-nums text-zinc-400">{i + 1}</span>
                            <span className="min-w-0 flex-1">
                              <span className="font-mono text-violet-900">{row.docId}</span>
                              <span className="block truncate text-zinc-600">{row.heading}</span>
                            </span>
                            <span className="shrink-0 tabular-nums text-zinc-500">{formatScore(stage, row.score)}</span>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </div>
              );
            })}
          </section>

          <section className="mt-5">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-violet-700">{copy.final}</h2>
            {result.hits.length === 0 ? (
              <p className="rounded-xl border border-violet-100 bg-white px-3 py-2 text-sm text-zinc-600">
                {result.stages.rerank ? copy.abstained : copy.empty}
              </p>
            ) : (
              <ul className="space-y-2">
                {result.hits.map((hit) => (
                  <li key={hit.sectionId} className="rounded-xl border border-violet-100 bg-white p-3 shadow-sm">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded bg-violet-100 px-1.5 py-0.5 font-mono text-violet-900">{hit.docId}</span>
                      <span className="font-medium text-violet-950">
                        {hit.docTitle} › {hit.heading}
                      </span>
                      <span className="text-zinc-400">
                        {hit.matchedBy.join(" + ")} · RRF #{hit.fusedRank}
                        {hit.relevance != null && ` · ${hit.relevance}/3`}
                      </span>
                      {hit.translated && (
                        <span
                          title={`${copy.translatedHint} ${hit.sectionId.slice(hit.sectionId.indexOf("#") + 1)}`}
                          className="cursor-help rounded border border-zinc-200 px-1 text-[10px] text-zinc-500"
                        >
                          {copy.translated}
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-zinc-700">{hit.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
