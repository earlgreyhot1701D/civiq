// Gemini embeddings, 768-d. Free tier. OPTIONAL — with no key, search runs
// lexical-only and degrades cleanly (HANDOFF §5).
//
// Asymmetric taskType: documents and questions are different kinds of text, so
// they are not encoded with the same setting. 768 dims is Matryoshka truncation
// from 3072; the model re-normalizes, so cosine still works.
import { google } from '@ai-sdk/google';
import { embed, embedMany } from 'ai';

export const EMBED_MODEL = 'gemini-embedding-2';
export const DIMS = 768;

export const embeddingsEnabled = () => Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);

const opts = (taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY') => ({
  google: { outputDimensionality: DIMS, taskType },
});

/** INGEST side — items being stored. */
export async function embedDocuments(values: string[]): Promise<number[][]> {
  if (!embeddingsEnabled() || values.length === 0) return [];
  const { embeddings } = await embedMany({
    model: google.textEmbeddingModel(EMBED_MODEL),
    values,
    providerOptions: opts('RETRIEVAL_DOCUMENT'),
  });
  return embeddings;
}

/** QUERY side — the resident's question. Different taskType on purpose. */
export async function embedQuery(query: string): Promise<number[] | null> {
  if (!embeddingsEnabled()) return null;
  try {
    const { embedding } = await embed({
      model: google.textEmbeddingModel(EMBED_MODEL),
      value: query,
      providerOptions: opts('RETRIEVAL_QUERY'),
    });
    return embedding;
  } catch {
    // An embedding hiccup must not take search down. Fall back to lexical.
    return null;
  }
}
