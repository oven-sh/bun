# test/internal/source-lints/

Tests in this directory are source-tree lints (queries over `src/**` for
anti-patterns) and build-script unit tests that never touch the built `bun`
binary. They run on GitHub Actions via `.github/workflows/source-lints.yml`
against a released bun, and are excluded from the Buildkite test shards
(`.buildkite/ci.mjs`), so they report in seconds instead of waiting ~25 min for
`build-bun`.

**Criterion:** a `test/internal/` test belongs here if it does **not** import
`bun:internal-for-testing`, does **not** spawn `bunExe()`, and does **not**
call `Bun.build`/`Bun.Transpiler`. Tests that exercise any code compiled into
the bun binary stay in `test/internal/` so the Buildkite lanes run them against
the build under test.

The workflow runs on a bare checkout (no `bun install`), so tests here may
only import built-ins, relative paths, and `harness` (resolved via
`test/tsconfig.json` paths).

The workflow only triggers for the `paths:` listed in it. A lint that reads
files outside those paths (for example `packages/bun-types/bun.d.ts` or the
docs) needs them added there, or a change to those files is only checked by
whichever later PR happens to trigger the workflow.

To run locally: `bun test test/internal/source-lints/`.

## Rust lints

Lints over the Rust sources query a parsed AST, not the source text. The
parser lives in `scripts/rust-parser/` (`index.ts` is the API, `ast.ts` the
node types); `rust-sources.ts` in this directory hands out every tracked `.rs`
file under `src/`, parsed once per process and shared by all lints:

```ts
import { pathEndsWith } from "../../../scripts/rust-parser/index.ts";
import { rustSources } from "./rust-sources.ts";

for (const src of rustSources({ scope: ["src/jsc/"] })) {
  for (const call of src.file.find("Call")) {
    if (pathEndsWith(call.callee, "heap::take")) {
      offenders.push(`${src.file.location(call)}: ${src.file.text(call)}`);
    }
  }
}
```

Write the query as a pure function of a `RustFile`, then feed it snippets
through `parseRustFragment` in a self-test so the intent is executable (see
`self-receiver-reclaim.test.ts`). To see how the parser reads a construct:

```sh
bun scripts/rust-parser/debug.ts expr 'unsafe { heap::take(self) }.foo()'
bun scripts/rust-parser/debug.ts file src/jsc/VirtualMachine.rs
```

`rust-parser.test.ts` checks that every tracked `.rs` file parses. When it
fails after a language feature lands in the tree, the parser needs to learn the
construct; the other lints fail with the same `RustParseError` until it does.
