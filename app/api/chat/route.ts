import { anthropic } from '@ai-sdk/anthropic';
import { convertToModelMessages, streamText, type UIMessage } from 'ai';
import { hybridSearch } from '@/lib/search';

export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  const q = messages.at(-1)?.parts.find((p) => p.type === 'text')?.text ?? '';
  const hits = await hybridSearch(q);

  const result = streamText({
    model: anthropic('claude-sonnet-5'),
    system:
      `Answer using ONLY the agenda items below. Every claim cites its item.\n` +
      `Never state a date or deadline that is not verbatim in the context.\n` +
      `If nothing matches, say so and name what was searched.\n\n` +
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
