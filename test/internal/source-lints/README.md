# test/internal/source-lints/

Source-tree lints (grep `src/**` for anti-patterns) and build-script unit
tests. These never touch the built `bun` binary, so they run on GitHub Actions
via `.github/workflows/source-lints.yml` against a released bun and are
excluded from the Buildkite test shards (`.buildkite/ci.mjs`).

**Criterion:** a test belongs here if it does **not** import
`bun:internal-for-testing`, does **not** spawn `bunExe()`, and does **not**
call `Bun.build`/`Bun.Transpiler`. Tests that exercise code compiled into the
bun binary stay in `test/internal/` so the Buildkite lanes run them against
the build under test.

To run locally: `bun test test/internal/source-lints/`.
