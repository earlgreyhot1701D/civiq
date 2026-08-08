import { anthropic } from '@ai-sdk/anthropic';
import { convertToModelMessages, streamText, type UIMessage } from 'ai';
import { hybridSearch } from '@/lib/search';

export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  const q = messages.at(-1)?.parts.find((p) => p.type === 'text')?.text ?? '';

  // A search failure must not 500 the route. The model is told what went wrong so
  // it can say where we looked, rather than answering from its own knowledge.
  let hits: Awaited<ReturnType<typeof hybridSearch>> = [];
  let searchError = '';
  try {
    hits = await hybridSearch(q);
  } catch (err) {
    searchError = (err as Error).message;
  }

  const result = streamText({
    model: anthropic('claude-sonnet-5'),
    system:
      `Answer using ONLY the agenda items below. Every claim cites its item.\n` +
      `Never state a date or deadline that is not verbatim in the context.\n` +
      `If nothing matches, say so and name what was searched.\n\n` +
      (searchError
        ? `The agenda index could not be queried (${searchError}). Say exactly that, ` +
          `name https://www.cityofventura.ca.gov/AgendaCenter as where the agendas live, ` +
          `and do not answer from your own knowledge.\n\n`
        : '') +
      hits
        .map(
          (h) =>
            `[${h.body} · ${h.meeting_date} · Item ${h.item_number} · p.${h.page_start}-${h.page_end}]\n` +
            `${h.plain_text}\nSource: ${h.url}`,
        )
        .join('\n\n'),
    // ai@7.0.58 returns Promise<ModelMessage[]> here; HANDOFF §7 omits the await.
    messages: await convertToModelMessages(messages),
  });
  return result.toUIMessageStreamResponse();
}
