// Shared lexical retrieval: build an OR-of-terms tsquery, and run it.
//
// Used by two callers that are not variations on a theme — a topic (a curated
// category) and the vocabulary bridge (a curated synonym set) — but which need
// exactly the same query. Extracted so search.ts does not grow a second copy; it
// is at its 150-line ceiling.
//
// phraseto_tsquery, NOT the replace('&','|') trick in search.ts. That trick
// DECOMPOSES phrases: "design review" contributes a bare `review` matching almost
// every item, and "conditional use" contributes `use`. Measured — it inflated one
// topic to 219 of 707 items.
import { dbConfigured, NO_DB, sql } from './db';
import type { Hit } from './search';

/**
 * A tsquery OR-ing every term, phrases preserved. Only tsquery-NORMALIZED text is
 * concatenated — the terms stay bound parameters and never leave phraseto_tsquery,
 * which is what makes this injection-safe. Terms that lex to nothing (all
 * stopwords) are dropped rather than left to break the syntax. `<->` binds tighter
 * than `|`, and each branch is parenthesised anyway.
 *
 * An empty term list yields NULL, and `tsv @@ NULL` is NULL rather than true, so a
 * caller that passes nothing matches nothing instead of everything.
 */
export const orTsquery = (terms: string[]) => sql`(
  select string_agg('(' || phraseto_tsquery('english', term)::text || ')', ' | ')
  from unnest(${terms}::text[]) term
  where phraseto_tsquery('english', term)::text <> ''
)::tsquery`;

/** How many items match any of these terms. Used as floor evidence. */
export async function lexicalCount(terms: string[]): Promise<number> {
  if (!terms.length || !dbConfigured) return 0;
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from retrievable_items where tsv @@ ${orTsquery(terms)}`;
  return row?.n ?? 0;
}

/** `total` is the whole matching set; `hits` is the ranked page actually shown. */
export type LexicalResult = { hits: Hit[]; total: number };

export async function lexicalSearch(terms: string[], limit = 12): Promise<LexicalResult> {
  if (!terms.length) return { hits: [], total: 0 };
  if (!dbConfigured) throw new Error(NO_DB);

  const tq = orTsquery(terms);

  const [count] = await sql<{ n: number }[]>`
    select count(*)::int as n from retrievable_items where tsv @@ ${tq}`;

  // Newest meeting breaks rank ties: of two equally-matching items, the one on an
  // upcoming agenda is the one a resident can still act on.
  const hits = await sql<Hit[]>`
    select i.id, i.item_number, i.plain_text, i.raw_text, i.page_start, i.page_end,
           d.meeting_date, d.url, b.name as body,
           ts_rank_cd(i.tsv, ${tq}) as score
    from retrievable_items i
    join documents d on d.id = i.document_id
    join bodies    b on b.id = d.body_id
    where i.tsv @@ ${tq}
    order by score desc, d.meeting_date desc
    limit ${limit}`;

  return { hits, total: count?.n ?? 0 };
}
