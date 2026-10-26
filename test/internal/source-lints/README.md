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

`cargo` in the workflow is the runner's stable toolchain (the step sets
`RUSTUP_TOOLCHAIN`), not the nightly that `rust-toolchain.toml` pins, and
there is no `vendor/`. A test can ask cargo about a crate outside the
workspace, as `workspace-lints.test.ts` does. It cannot build the workspace.
A test must not run the `cargo` on `PATH`: it is a rustup proxy, and a proxy
downloads the toolchain, components and targets that the machine lacks.
`workspace-lints.test.ts` shows how to get the cargo of an installed toolchain.

The workflow only triggers for the `paths:` listed in it. A lint that reads
files outside those paths (for example `packages/bun-types/bun.d.ts` or the
docs) needs them added there, or a change to those files is only checked by
whichever later PR happens to trigger the workflow.

To run locally: `bun test test/internal/source-lints/`.
