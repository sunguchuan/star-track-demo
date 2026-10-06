/**
 * BM25 keyword retrieval, the lexical half of hybrid search. It is exact where embeddings
 * are fuzzy: alert codes, document IDs, parameter names (CF4/O2) and numbers.
 *
 * Tokenizer for mixed Chinese / English text without a dictionary:
 * - ASCII words keep hyphenated codes whole ("etch-rf-drift") and also index their parts;
 * - CJK runs become overlapping bigrams ("湿法清洁" → 湿法 法清 清洁), the usual
 *   dictionary-free choice for Chinese full-text search.
 */

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "in", "is", "it",
  "of", "on", "or", "the", "to", "what", "when", "with", "after", "must", "does", "do",
]);

const TOKEN = /[a-z0-9]+(?:[-_./][a-z0-9]+)*|[\u3400-\u9fff\uf900-\ufaff]+/g;

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const [token] of text.normalize("NFKC").toLowerCase().matchAll(TOKEN)) {
    if (/^[a-z0-9]/.test(token)) {
      if (!STOPWORDS.has(token)) tokens.push(token);
      const parts = token.split(/[-_./]/);
      if (parts.length > 1) {
        for (const part of parts) if (part && !STOPWORDS.has(part)) tokens.push(part);
      }
      continue;
    }
    if (token.length === 1) {
      tokens.push(token);
      continue;
    }
    for (let i = 0; i < token.length - 1; i++) tokens.push(token.slice(i, i + 2));
  }
  return tokens;
}

export type Bm25Hit = { id: string; score: number };

type Posting = { id: string; tf: Map<string, number>; length: number };

export class Bm25Index {
  private readonly postings: Posting[];
  private readonly df = new Map<string, number>();
  private readonly avgLength: number;
  private readonly k1: number;
  private readonly b: number;

  constructor(docs: { id: string; text: string }[], k1 = 1.2, b = 0.75) {
    this.k1 = k1;
    this.b = b;
    this.postings = docs.map((doc) => {
      const tf = new Map<string, number>();
      const tokens = tokenize(doc.text);
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      return { id: doc.id, tf, length: tokens.length };
    });
    const total = this.postings.reduce((sum, p) => sum + p.length, 0);
    this.avgLength = this.postings.length ? total / this.postings.length : 0;
  }

  /** Probabilistic IDF (+1 inside the log keeps it positive for very common terms). */
  private idf(term: string): number {
    const n = this.postings.length;
    const df = this.df.get(term) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  /**
   * `minShouldMatch` (share of the query's distinct tokens a chunk must contain, like
   * Elasticsearch's minimum_should_match) drops chunks that only share a generic word or two
   * with the query — the noise that otherwise leaks into rank fusion.
   */
  search(
    query: string,
    limit: number,
    filter?: (id: string) => boolean,
    minShouldMatch = 0,
  ): Bm25Hit[] {
    const queryTokens = [...new Set(tokenize(query))];
    const terms = queryTokens.filter((t) => this.df.has(t));
    if (terms.length === 0) return [];
    const required = Math.max(1, Math.ceil(minShouldMatch * queryTokens.length));
    const hits: Bm25Hit[] = [];
    for (const p of this.postings) {
      if (filter && !filter(p.id)) continue;
      let score = 0;
      let matched = 0;
      for (const term of terms) {
        const tf = p.tf.get(term);
        if (!tf) continue;
        matched += 1;
        const norm = this.k1 * (1 - this.b + (this.b * p.length) / (this.avgLength || 1));
        score += this.idf(term) * ((tf * (this.k1 + 1)) / (tf + norm));
      }
      if (matched >= required && score > 0) hits.push({ id: p.id, score });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
