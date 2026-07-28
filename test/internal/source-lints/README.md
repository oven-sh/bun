# test/internal/source-lints/

Source-tree lints (grep `src/**` for anti-patterns) and build-script unit
tests. These never touch the built `bun` binary, so they run on GitHub Actions
via `.github/workflows/source-lints.yml` against a released bun and are
excluded from the Buildkite test shards (`.buildkite/ci.mjs`).

**Criterion:** a test belongs here if it does **not** exercise behavior
compiled into the bun binary: no `bun:internal-for-testing`, no
`Bun.build`/`Bun.Transpiler`, and no `bunExe()` spawns that assert on the
binary's own output (using it as a JS host for a devDependency CLI is fine).
Tests that do exercise compiled-in code stay in `test/internal/` so the
Buildkite lanes run them against the build under test.

To run locally: `bun test test/internal/source-lints/`.
