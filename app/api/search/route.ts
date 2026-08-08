// Receipts endpoint. The chat stream explains; this returns the structured
// records the UI renders as citations, so the receipt never depends on the model.
import { hybridSearch } from '@/lib/search';

export async function POST(req: Request) {
  try {
    const { q } = (await req.json()) as { q?: string };
    const hits = await hybridSearch(String(q ?? ''), 6);
    return Response.json({ hits });
  } catch (err) {
    return Response.json({ hits: [], error: (err as Error).message }, { status: 500 });
  }
}
