# AGENTS.md

Behavioral guidelines for Codex when working in this repository. Merge with task-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them; don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No flexibility or configurability that was not requested.
- No error handling for impossible scenarios.
- If 200 lines could be 50, rewrite it.

Ask: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own changes.**

When editing existing code:

- Do not improve adjacent code, comments, or formatting unless required.
- Do not refactor things that are not broken.
- Match existing style, even if you would write it differently.
- If unrelated dead code is noticed, mention it; do not delete it.

When your changes create orphans:

- Remove imports, variables, or functions that your changes made unused.
- Do not remove pre-existing dead code unless asked.

Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" means write tests for invalid inputs, then make them pass.
- "Fix the bug" means reproduce it, then make the fix pass verification.
- "Refactor X" means ensure behavior is preserved before and after.

For multi-step tasks, state a brief plan:

```text
1. [Step] - verify: [check]
2. [Step] - verify: [check]
3. [Step] - verify: [check]
```

Strong success criteria let the agent work independently. Weak criteria require clarification.

## Project Notes

- This is a Node.js Stremio addon with a Vercel serverless entrypoint in `api/index.js`.
- Keep work local unless the user explicitly asks to commit, push, deploy, upload, or publish.
- Prefer focused edits in `addon.js`, `api/index.js`, `server.js`, and `public/configure.html`.
- Do not add new dependencies unless they are clearly necessary.
- Be careful with Vercel function timeouts and external scraping calls.
- Verify syntax after JavaScript changes with:

```powershell
node --check addon.js
node --check api/index.js
node --check server.js
```

These guidelines are working if diffs stay small, unnecessary rewrites are avoided, and clarification happens before risky implementation choices.
