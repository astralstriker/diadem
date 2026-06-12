---
'@devcraft-ts/diadem': minor
---

v0.4 — `diadem check` for CI, and no more silent heuristic wiring.

Both changes come out of an external source review of the generator; the issues are documented in the README's trade-offs section as well.

- **`diadem check`** — new CLI command for CI: regenerates the manifest/compiled wiring **in memory**, compares it against the committed file, and exits non-zero on drift. Nothing is written, so a PR that changes the service graph without re-running `diadem build` fails fast instead of shipping stale wiring. Honors `--strict` and `--fail-on-cycle`.
- **Heuristic wiring is never silent anymore.** When a constructor parameter's type is not a declared token, the generator falls back to a naming convention (`IFoo` → `Foo`, or a unique `*Service`/`*Repository` containing `Foo`). Previously these guesses were wired with no diagnostic, and multiple candidates were resolved to whichever match the file scan found first — meaning a file rename could silently rewire production. Now:
  - every convention-based wiring emits a warning naming the guessed implementation, and **fails the build under `--strict`** (a guess violates strict's "no runtime surprises" contract);
  - a convention match with **multiple candidates** (e.g. `ILoan` matching both `LoanService` and `LoanRepository`) is never wired — the dependency is left unresolved and reported with the full candidate list;
  - heuristic-wired dependencies are marked `"heuristic": true` in the generated manifest.
- **Known limitation, stated honestly:** graph analysis remains syntactic and name-based — token identity is the token's *name*, so two same-named abstract classes in different packages can collide, and nothing structurally verifies that a class implements its token. An opt-in type-checked pass (`--type-check`) is on the roadmap; until then, keep token names unique across the scanned codebase.
