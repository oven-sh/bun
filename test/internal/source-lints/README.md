# test/internal/source-lints/

Tests in this directory are source-tree lints (grep `src/**` for anti-patterns)
and build-script unit tests that never touch the built `bun` binary. They run
on GitHub Actions via `.github/workflows/source-lints.yml` against a released
bun, and are excluded from the Buildkite test shards (`.buildkite/ci.mjs`), so
they report in seconds instead of waiting ~25 min for `build-bun`.

**Criterion:** a `test/internal/` test belongs here if it does **not** import
`bun:internal-for-testing`, does **not** spawn `bunExe()`, and does **not**
call `Bun.build`/`Bun.Transpiler`. Tests that exercise any code compiled into
the bun binary stay in `test/internal/` so the Buildkite lanes run them against
the build under test.

The workflow runs on a bare checkout (no `bun install`), so tests here may
only import built-ins, relative paths, and `harness` (resolved via
`test/tsconfig.json` paths).

To run locally: `bun test test/internal/source-lints/`.
