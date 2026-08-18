---
name: writing-pr-summaries
description: Drafts a pull request summary for the current branch against main (or a named base) from full git history and the complete diff. Use when the user asks for a PR summary, PR description, PR body, pull request write-up, or a markdown summary of the branch vs main.
---

# Writing PR Summaries

Write a paste-ready PR body from git. Do not open a GitHub PR unless the user explicitly asked to create one.

## Output contract

Reply with **one** markdown code fence that contains the entire PR body:

````
```markdown
## Summary
...

## Test plan
...
```
````

No extra commentary inside the fence. One short sentence after the fence is OK (for example, that a PR was not created).

## Gather (always, in parallel)

Default base is `main` unless the user named another branch.

```bash
git status
git rev-parse --abbrev-ref HEAD
git log --oneline BASE..HEAD
git log BASE..HEAD --format='%h %s%n%b'
git diff --stat BASE...HEAD
git diff BASE...HEAD
```

Use `BASE...HEAD` (three dots) so the summary is the branch since it diverged, not a two-dot mix of unrelated main commits.

Read the log **and** the full diff. Cover **every** commit on the branch, not only `HEAD`.

If the working tree is dirty, mention uncommitted work after the fence; do not treat it as part of the PR unless the user said to include it.

## Body shape

```markdown
## Summary

[1–3 sentences: what changed and why, plus commit/file counts if useful.]

### [Feature group]
- User-facing bullets grounded in the diff.

## Test plan
- [ ] Checklist items a reviewer can actually run.
```

Group by user-facing feature, not by file. Skip drive-by file lists. Do not invent behavior that is not in the diff.

## Do not

| Temptation | Instead |
|------------|---------|
| `gh pr create` / open a PR | Summary only |
| Rendered markdown in chat | One `markdown` code fence |
| Latest commit only | Full `BASE..HEAD` history |
| File dump / raw `git diff --stat` as the summary | Grouped bullets |
| Spec language ("non-goals", "success criteria") | Reviewer-facing summary + test plan |
