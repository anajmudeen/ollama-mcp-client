# Parenthetical inline math normalization

Date: 2026-09-30

## Problem

OpenAI and other models often emit inline math with parentheses instead of dollar delimiters, for example `(\gcd(24,34)=2)`. The chat renderer uses `remark-math` + KaTeX, which only treats `$…$`, `$$…$$`, `\(...\)`, and `\[…\]` as math. Parentheses alone leave `\gcd` as plain text, so the expression does not render. The same content renders correctly when written as `$\gcd(24,34)=2$`.

Related prior work normalizes model-specific **display** math (`[ … ]`, bare `\begin{array}…`) in `normalizeMarkdown` before `MarkdownContent` runs `react-markdown`. Parenthetical inline math is not covered yet.

## Goal

When assistant markdown contains `( … )` that clearly encodes LaTeX inline math, rewrite it to `$…$` during `normalizeMarkdown` so KaTeX renders it, without breaking links, code fences, or normal English parentheses.

## Scope (detection rule B)

Convert a parenthesis pair when **all** of the following hold:

1. The inner text contains at least one LaTeX command: `/\\[a-zA-Z@]+/`.
2. The inner text does **not** look like a Windows path (guard: reject if body matches a drive-letter path pattern such as `[A-Za-z]:\\`).
3. The match is not inside fenced code, inline code, existing `$…$`, or `$$…$$`.
4. The opening `(` is not part of a markdown link destination immediately after `]` (i.e. skip `](…)`).

**Out of scope for this change:**

- `(y)` or `(x,y)` without a backslash command.
- Telegram `markdownToTelegramHtml` (no `normalizeMarkdown` today).
- Bracket + `\begin{array}` double-`$$` bug (separate fix).
- Unsupported LaTeX beyond KaTeX’s capabilities.

## Non-goals

- Teaching models to emit correct `$…$` (normalization only).
- Full LaTeX parser or command allowlist (heuristic + path guard only).

## Architecture

```
Assistant message text
        │
        ▼
normalizeMarkdown (existing: dedent, lists, latex env, bracket display)
        │
        ▼
convertParentheticalInlineMath  ◄── new step (mapOutsideCode)
        │
        ▼
normalizeBracketDisplayMath → sanitizeMathCurrency
        │
        ▼
MarkdownContent → remark-math → rehype-katex
```

### New module

`src/renderer/src/lib/parentheticalInlineMath.ts`

- **`convertParentheticalInlineMath(segment: string): string`**  
  Scan `segment` for `(` … `)` with balanced nesting (so `\gcd(24,34)` inside `(\gcd(24,34)=2)` works).
- For each candidate, if `looksLikeParentheticalMath(body)` → replace with `$${body.trim()}$` (outer parens removed).
- **`looksLikeParentheticalMath(body)`**  
  - True if `/\\[a-zA-Z@]+/.test(body)`.  
  - False if path-like: e.g. `/[A-Za-z]:\\/.test(body)`.

### Integration

In `normalizeMarkdown.ts`, after `latexFixed` and **before** `normalizeBracketDisplayMath`:

```ts
const parenFixed = mapOutsideCode(latexFixed, convertParentheticalInlineMath)
return sanitizeMathCurrency(normalizeBracketDisplayMath(parenFixed))
```

Reuse `mapOutsideCode` from `linkNumericCitations` (same as bracket/env passes).

### Skip logic inside scanner

While locating candidates, do not start a match when:

- Inside `$$…$$` or `$…$` (track toggles with escape-aware scan, same idea as `latexEnvironmentMath.isInsideDisplayMath`).
- Immediately preceded by `]` (markdown link `](url)` — optional: only skip if inner looks like URL).
- Inside code (handled by `mapOutsideCode` wrapper).

### Optional fallback (YAGNI unless trivial)

`rehypeKatexInHtml` already runs `convertBracketDisplayMath` on text nodes. Only add `convertParentheticalInlineMath` there if implementation shows paragraph text still escaping the normalize pass; not required for the primary OpenAI gcd case.

## Rewrite examples

| Input | Output |
| --- | --- |
| `(\gcd(24,34)=2)` | `$\gcd(24,34)=2$` |
| `So (\frac{1}{2}) is half.` | `So $\frac{1}{2}$ is half.` |
| `(Fig. 2)` | unchanged |
| `` `(x=1)` `` in inline code | unchanged |
| `[docs](https://x.com)` | unchanged |
| `(C:\Users\foo)` | unchanged (path guard) |

## Error handling

- Malformed/unclosed `(` → leave text unchanged (no partial rewrites).
- KaTeX errors after rewrite → existing `throwOnError: false` behavior in `MarkdownContent` (colored/error text unchanged).

## Testing

Extend `scripts/test-normalize-markdown.mjs`:

1. `(\gcd(24,34)=2)` → `$\gcd(24,34)=2$`
2. Nested parens in command args (gcd example).
3. `(Fig. 2)` unchanged.
4. Fenced code containing `(\foo)` unchanged.
5. `(C:\test\path)` unchanged.
6. Already wrapped `$(\gcd(1,2))$` or adjacent `$…$` — no double-wrapping / broken delimiters.

Manual: reload chat UI, compare OpenAI-style parenthesis output to `$\gcd(24,34)=2$`.

## Success criteria

- `(\gcd(24,34)=2)` in assistant messages renders equivalently to `$\gcd(24,34)=2$` in the Electron chat UI.
- No regressions on link syntax, numeric citations `[1]`, or bracket display math tests already in `test-normalize-markdown.mjs`.
