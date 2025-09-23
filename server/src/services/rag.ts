type Doc = { id: string; source: string; title?: string; text: string; occurred_at?: number|null };

function tokenize(s: string) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

// Tiny TF-IDF / BM25-esque scoring (heuristic)
export type RagMethod = 'heuristic' | 'hybrid';

export function scoreDocs(query: string, docs: Doc[], method: RagMethod = (process.env.RAG_METHOD as RagMethod) || 'heuristic'):
  Array<Doc & { score: number }>{
  // Placeholder switch for future hybrid retrieval; currently identical behavior
  if (method !== 'heuristic') {
    // TODO: plug embeddings/BM25 hybrid here when deps/network allow
  }
  const qTokens = Array.from(new Set(tokenize(query)));
  if (qTokens.length === 0) return docs.map(d => ({ ...d, score: 0 }));
  const N = docs.length || 1;
  const df = new Map<string, number>();
  const docTokens = docs.map(d => new Set(tokenize(d.text)));
  for (const t of qTokens) {
    let c = 0; for (const set of docTokens) if (set.has(t)) c++;
    df.set(t, c);
  }
  return docs.map((d, i) => {
    const set = docTokens[i];
    let score = 0;
    for (const t of qTokens) {
      const idf = Math.log(1 + (N / (1 + (df.get(t) || 0))));
      if (set.has(t)) score += idf;
    }
    return { ...d, score };
  }).sort((a, b) => b.score - a.score);
}

export function topK<T extends { score: number }>(arr: T[], k = 5) {
  return arr.slice(0, Math.max(0, k));
}
