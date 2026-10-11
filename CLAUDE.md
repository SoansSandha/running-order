# CLAUDE.md

## Git workflow

`master` is what ships. `develop` is where finished work collects. All
work happens on short-lived branches cut from `develop`.

```
<type>/<name> ──PR──▶ develop ──PR──▶ master
```

These rules override any skill, plan, or default that says otherwise.

### Starting work

1. `git fetch origin`, then cut the branch from the latest `develop`:
   `git switch -c <type>/<name> origin/develop` (use local `develop` if
   `origin/develop` doesn't exist yet). Cut from `master` only when the
   user explicitly says so.
2. Already on a feature branch? If the new work belongs to it, stay. If
   it's unrelated, ask: new branch, or this one.
3. Uncommitted or staged changes in the tree when a new branch is needed?
   Stop and ask. Staged work follows you across `git switch`, so never
   carry it, stash it, or discard it silently.
4. Never work directly on `develop` or `master`.

### Branch names

`<type>/<name>`: lowercase, kebab-case, under 50 characters, naming the
outcome rather than the activity.

| Type | For |
|---|---|
| `feat/` | Behaviour a user can see or use |
| `fix/` | A bug fix |
| `refactor/` | A code change with no behaviour change |
| `perf/` | A speed or memory improvement |
| `test/` | Tests only |
| `docs/` | Documentation only |
| `chore/` | Tooling, config, dependencies, build |

Examples: `feat/youtube-match-tray`, `fix/reorder-skips-last-track`,
`chore/upgrade-vite`. With a Linear issue, lead with its key:
`fix/RB-142-reorder-skips-last-track`.

### While coding: stage, never commit

- Stage by path: `git add <paths>`. Never `git add -A` or `git add .`.
  Never stage `proxy/browser.json`, `.env*`, `.local/`, or anything
  holding credentials.
- No commit, push, merge, rebase, or PR until the user says so.
- A plan or skill step that says "commit" means "stage". Plans written
  for this repo say "Stage", not "Commit". Implementer subagents stage
  and never commit.
- To review one task in isolation without commits, snapshot the index
  before and after it with `git write-tree`, then `git diff <before> <after>`.
- Done with a feature? Run lint and tests, stage, and tell the user it's
  ready to commit. Never merge locally (this replaces the
  finishing-a-development-branch menu).

### On "commit and push"

"Commit" alone means commit and don't push.

1. Run `npm run lint` and `npm test`. On failure, report it and stop,
   unless the user says to commit anyway.
2. Read `git diff --cached`. Only staged work is committed; name any
   unstaged changes left behind.
3. Commit one logical change per commit. Several features or fixes that
   separate cleanly by file get one commit each. If they're tangled in
   the same files, make one commit whose body lists each change.
4. If `origin/develop` doesn't exist, push it first: `git push -u origin develop`.
5. `git push -u origin <branch>`. If the push is rejected, stop and
   report. Never force-push.
6. Check for an open PR from this branch. If there's none, open one into
   `develop`. If there is one, the push has updated it; edit its
   description if the new commits widen its scope.

### Commit messages

[Conventional Commits](https://www.conventionalcommits.org). Someone
reading `git log` alone should know what changed and why.

```
<type>(<scope>): <imperative summary, under 72 chars, no period>

<What changed and why, wrapped at 72. One bullet per change when there
are several. Lead with behaviour the user will notice; add anything a
reviewer must know (migrations, new env vars, follow-ups).>
```

- `type` is the same set as branch types (`feat`, `fix`, `refactor`,
  `perf`, `test`, `docs`, `chore`).
- `scope` is the area touched: `ui`, `match`, `plan`, `sort`, `csv`,
  `auth`, `spotify`, `youtube`, `proxy`. Leave it out if it spans many.
- Keep the Co-Authored-By trailer.

```
feat(match): let "Pick another" replace a proposed match

Picking a different result now replaces the proposal instead of
adding a second row beside it. A pasted link pairs only into a tray
that is still open, so a late paste can't land on a closed row.
```

### Pull requests

- Feature branches go into `develop`. `develop` goes into `master` only,
  and only when the user asks for a release PR.
- Title: the same format as a commit summary. A single-commit branch
  reuses its subject.
- Body:

  ```
  ## Summary
  What this does and why, in 1–3 sentences.

  ## Changes
  - One bullet per notable change

  ## Testing
  - Commands run and their results, plus any manual checks
  ```

- Never merge, approve, or delete branches unless told to.
- PRs use the GitHub CLI (`gh`). If it's missing or signed out, push
  anyway, give the user
  `https://github.com/SoansSandha/running-order/compare/develop...<branch>?expand=1`,
  and say `gh` needs setting up.

### Never

- Commit or push to `develop` or `master` directly, unless the user
  explicitly says to for that change. GitHub requires a PR for both, but
  admins can bypass it, and Claude pushes as an admin, so GitHub won't
  stop a direct push. This rule has to.
- Force-push, `reset --hard`, or rewrite history that has been pushed.
- Skip hooks (`--no-verify`).
