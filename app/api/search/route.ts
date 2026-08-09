// Receipts endpoint. The chat stream explains; this returns the structured
// records the UI renders as citations, so the receipt never depends on the model.
//
// Two modes, deliberately separate. A typed question goes through hybridSearch and
// is adjudicated by the dense floor. A topic button goes through topicSearch, which
// is a curated lexical filter — see the header of lib/topics.ts for why routing a
// category name through the floor returned nothing for "downtown and the
// waterfront". `total` is only meaningful for topics, where the shown page is a
// ranked subset of a larger matching set that the UI states plainly.
import { hybridSearch } from '@/lib/search';
import { topicSearch } from '@/lib/topics';

export async function POST(req: Request) {
  try {
    const { q, topic } = (await req.json()) as { q?: string; topic?: string };

    if (topic) {
      const { hits, total } = await topicSearch(String(topic));
      return Response.json({ hits, total });
    }

    const hits = await hybridSearch(String(q ?? ''), 6);
    return Response.json({ hits, total: hits.length });
  } catch (err) {
    return Response.json({ hits: [], total: 0, error: (err as Error).message }, { status: 500 });
  }
}
