/**
 * Retrieval metrics over ranked section IDs with binary relevance labels.
 * - Hit@k: any relevant section in the top k.
 * - Recall@k: share of the relevant sections found in the top k.
 * - MRR: 1 / rank of the first relevant section (0 if none in the top k).
 * - nDCG@k: rank-discounted gain, normalized by the best possible ordering.
 */

export function hitAt(ranked: string[], relevant: string[], k: number): number {
  return ranked.slice(0, k).some((id) => relevant.includes(id)) ? 1 : 0;
}

export function recallAt(ranked: string[], relevant: string[], k: number): number {
  if (relevant.length === 0) return 0;
  const top = new Set(ranked.slice(0, k));
  return relevant.filter((id) => top.has(id)).length / relevant.length;
}

export function reciprocalRank(ranked: string[], relevant: string[], k = 10): number {
  const index = ranked.slice(0, k).findIndex((id) => relevant.includes(id));
  return index < 0 ? 0 : 1 / (index + 1);
}

export function ndcgAt(ranked: string[], relevant: string[], k: number): number {
  const dcg = ranked
    .slice(0, k)
    .reduce((sum, id, i) => sum + (relevant.includes(id) ? 1 / Math.log2(i + 2) : 0), 0);
  let ideal = 0;
  for (let i = 0; i < Math.min(k, relevant.length); i++) ideal += 1 / Math.log2(i + 2);
  return ideal === 0 ? 0 : dcg / ideal;
}

/** recall8 matches RERANK_CANDIDATES: what a first stage hands to the reranker. */
export type QueryScores = {
  hit1: number;
  recall3: number;
  recall5: number;
  recall8: number;
  mrr: number;
  ndcg5: number;
};

export function scoreRanking(ranked: string[], relevant: string[]): QueryScores {
  return {
    hit1: hitAt(ranked, relevant, 1),
    recall3: recallAt(ranked, relevant, 3),
    recall5: recallAt(ranked, relevant, 5),
    recall8: recallAt(ranked, relevant, 8),
    mrr: reciprocalRank(ranked, relevant),
    ndcg5: ndcgAt(ranked, relevant, 5),
  };
}

export function meanScores(rows: QueryScores[]): QueryScores {
  const n = rows.length || 1;
  const mean = (key: keyof QueryScores) => rows.reduce((s, r) => s + r[key], 0) / n;
  return {
    hit1: mean("hit1"),
    recall3: mean("recall3"),
    recall5: mean("recall5"),
    recall8: mean("recall8"),
    mrr: mean("mrr"),
    ndcg5: mean("ndcg5"),
  };
}
