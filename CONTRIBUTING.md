# Contributing

Small team, simple rules.

## Before you push

1. **Build must pass:**

   ```bash
   npm run build
   ```

2. **Run golden queries** if you touched anything in the retrieval path
   (`lib/search.ts`, `lib/rrf.ts`, `lib/bridge.ts`, `lib/lexical.ts`,
   `lib/topics.ts`):

   ```bash
   npm run golden
   ```

   All 17 cases must pass. If a case flips, figure out why before pushing —
   the calibration is tight and a regression usually means something real moved.

3. **Lint:**

   ```bash
   npm run lint
   ```

## Branch workflow

Work on `main` for now. If a change is risky or multi-day, branch off and merge
when green.

## What not to do

- Don't add a model call where a regex works. Dates, item numbers, and page
  ranges are always deterministic — guardrail #1.
- Don't add per-body counts or rankings — guardrail #2.
- Don't add any code path that sends email to a government address — guardrail #3.
- Don't bridge a word unless you have read every item the target terms return
  and confirmed they are genuinely relevant. See the rules at the top of
  `lib/bridge.ts`.
