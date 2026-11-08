# test/internal/source-lints/

Tests in this directory are source-tree lints (grep `src/**` for anti-patterns)
and build-script unit tests that never touch the built `bun` binary. They run
on GitHub Actions via `.github/workflows/source-lints.yml` against a released
bun, and are excluded from the Buildkite test shards (`.buildkite/ci.ts`), so
they report in seconds instead of waiting ~25 min for `build-bun`.

**Criterion:** a `test/internal/` test belongs here if it does **not** import
`bun:internal-for-testing`, does **not** spawn `bunExe()`, and does **not**
call `Bun.build`/`Bun.Transpiler`. Tests that exercise any code compiled into
the bun binary stay in `test/internal/` so the Buildkite lanes run them against
the build under test.

The workflow runs on a bare checkout (no `bun install`), so tests here may
only import built-ins, relative paths, and `harness` (resolved via
`test/tsconfig.json` paths).

The workflow only triggers for the `paths:` listed in it. A lint that reads
files outside those paths (for example `packages/bun-types/bun.d.ts`) needs
them added there, or a change to those files is only checked by whichever
later PR happens to trigger the workflow.

`docs/**` is listed for `compiler-docs-links.test.ts`, which judges the links
from and to `docs/compiler`, and the Compiler tab and the redirects of
`docs/docs.json`. A pull request that changes only docs gets no Buildkite
pipeline (`isDocsOnlyChange()` in `scripts/buildkite.ts`), so no test outside
this directory reads its pages.

To run locally: `bun test test/internal/source-lints/`.
