<!--
  PROJECT CLAUDE.md TEMPLATE — copy to <new-project>/CLAUDE.md and fill in.
  Pairs with the global file at ~/.claude/CLAUDE.md (see docs/global-CLAUDE.md).
  Rule of thumb: if a line would still be true in six months without edits,
  it can live here. If not, it belongs in the DB, SESSION_LOG.md, or docs/.
-->

# <Project Name> — Project Context

## What This Is

Two or three sentences: what the project does, who uses it, where it's deployed.
Include scale assumptions that change decisions (single user? paying clients?).

## Commands

```bash
npm install        # install dependencies
npm run dev        # local development
npm test           # test suite — must pass before pushing
npm run build      # production build
```

State explicitly what does NOT exist ("no lint config; tsc --noEmit is the
correctness check") — absence is information Claude can't infer.

## Environment Variables

Point to `.env.example` and list only the variables whose *purpose* isn't
obvious from the name. Never put real values here.

## Architecture

The highest-value section. For each major piece, document the **invariant and
the why**, not a prose tour of the code:

- Request/data flow in one compact diagram or list
- Constraints that cause *silent failure* if violated (bundling rules, runtime
  library paths, auth boundaries, caching requirements)
- Decisions that should not be re-litigated, with a one-line rationale
- Format migrations and how old data is handled

## Database

Table names with one-line purposes. Schema file location and how to apply it.
No column-by-column dumps — that's what the schema file is for.

## Testing

Which stack, how to run it, and the risk tier of each surface (see global
CLAUDE.md risk table). Name the spec file pattern new tests should copy.

## Deployment

Where it deploys, what's non-obvious about the build, and any post-deploy
manual step (token capture, migrations). Link the full walkthrough doc.

## Pointers

- Tasks/status: <where volatile state actually lives — DB, tracker>
- Lessons: `docs/lessons-learned.md`
- Session history: `SESSION_LOG.md`
