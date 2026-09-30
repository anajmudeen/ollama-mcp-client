# Parenthetical inline math implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite model output like `(\gcd(24,34)=2)` to `$\gcd(24,34)=2$` in `normalizeMarkdown` so KaTeX renders inline math.

**Architecture:** Balanced-paren scanner in `parentheticalInlineMath.ts`, gated by LaTeX-command heuristic and Windows-path guard; wired via `mapOutsideCode` before bracket display math.

**Tech Stack:** TypeScript, existing `normalizeMarkdown` pipeline, `node:test` script via Vite SSR.

## Global Constraints

- Detection rule B: any `( … )` whose body matches `/\\[a-zA-Z@]+/`, excluding `[A-Za-z]:\\` paths.
- Skip code fences, inline code, `$…$`, `$$…$$`, and `](…)` link destinations.
- Chat renderer only (`MarkdownContent`); Telegram out of scope.

---

### Task 1: Parenthetical inline math module

**Files:**
- Create: `src/renderer/src/lib/parentheticalInlineMath.ts`
- Modify: `src/renderer/src/lib/normalizeMarkdown.ts`
- Test: `scripts/test-normalize-markdown.mjs`

**Status:** Implemented.
