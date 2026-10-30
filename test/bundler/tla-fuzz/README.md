# Top-level await fuzzer

Compares how a random ES module graph with top-level await evaluates natively, in a reference model of ECMA-262, and
after bundling. The results and the design they led to are in
[`src/bundler/linker_context/top-level-await.md`](../../../src/bundler/linker_context/top-level-await.md).

| file              | what it is                                                                                                                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gen.mjs`         | Seeded graph generator. A profile picks what the graphs contain (below).                                                                                                                                          |
| `runner.mjs`      | Installs the tracing globals, `import()`s one file, prints the trace as JSON when the process exits. Runs under Node and Bun.                                                                                     |
| `spec-model.mjs`  | `Evaluate`, `InnerModuleEvaluation`, `ExecuteAsyncModule`, `GatherAvailableAncestors`, `AsyncModuleExecutionFulfilled` / `Rejected` and `ContinueDynamicImport`, written out step by step from the specification. |
| `plan-linker.mjs` | Prototype linker in JavaScript: everything in the design document, including the parts that `bun build` does not have yet (flat entry point, flat chains, fail-fast, code splitting).                             |
| `variants.mjs`    | One function per thing to compare: engines, the model, the prototype, `bun build`, other bundlers.                                                                                                                |
| `fuzz.mjs`        | The driver.                                                                                                                                                                                                       |
| `show.mjs`        | Prints the traces of one kept graph side by side.                                                                                                                                                                 |
| `stats.mjs`       | How many modules need a wrapper, on graphs of 300 modules.                                                                                                                                                        |
| `size.mjs`        | Size of the prototype's run-time (needs esbuild).                                                                                                                                                                 |
| `check.ts`        | One graph, `bun build` against the model. `bundler_tla.test.ts` runs a few seeds through it.                                                                                                                      |
| `test262.mjs`     | Runs the top-level await tests of a test262 checkout unbundled and bundled.                                                                                                                                       |

## Running it

```sh
# <bun> is the build under test; the first variant is the reference
BUN_BUILD_BIN=<bun> node fuzz.mjs --profile=cyc --from=1 --count=500 --variants=node,bun,spec,bunbuild

# look at a graph that differed (they are kept in $TMPDIR/tla-fuzz, or --work=<dir>)
node show.mjs /tmp/tla-fuzz/cyc-17 node,bunbuild        # add "fine" to see every promise job
```

Options: `--profile`, `--from`, `--count`, `--variants=a,b,c`, `--ref=<variant>`, `--conc=<processes>`, `--keep` (keep
every graph), `--level=order|coarse|exact|boundary` (what counts as "bad"), `--shift` (histogram of how many promise
jobs later than the reference the importer of the program sees it settle), `--agree=a,b,c` (skip graphs on which these
variants disagree with the reference), `--maxN=<modules>`.

`BUN_BIN` is the Bun that runs the `bun` variant, `BUN_BUILD_BIN` the one behind `bunbuild` and `bunsplit`,
`BUN_OLD_BIN` the one behind `bunold`. All default to `bun`. `name@bun` runs the output of a variant under Bun instead
of Node.

The other bundlers are not dependencies of this repository. Install the ones to compare against somewhere Node finds
them from this directory, e.g. `npm i --no-save esbuild rollup rolldown webpack @rspack/core`. A variant whose bundler
is missing is counted under `buildfail`.

## Profiles

| profile | graphs                                                                                                                             |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `dag`   | no cycles, no errors; modules await a few promise jobs                                                                             |
| `cyc`   | plus import cycles and self imports                                                                                                |
| `err`   | plus modules that throw                                                                                                            |
| `err2`  | more throws, and a module may throw ahead of its first `await`                                                                     |
| `inert` | like `err`, and almost half of the modules only declare things                                                                     |
| `time`  | plus modules that sleep on a virtual clock (macrotasks)                                                                            |
| `sig`   | a module may await a signal that another module fires at the end of its body: shows deadlocks that bundling introduces             |
| `dyn`   | `import()` of anything, including ancestors and the module itself; sleeps only, because the host decides how long `import()` takes |

## Reading the table

Each module logs every step, with the values it sees in the modules it imports. A ticker logs a line per promise job,
and probes log from promise jobs that modules queue.

- `order`: the steps of the modules are in the same order, and the program settles the same way.
- `coarse`: and every step saw the same values.
- `exact`: and every step, probe and clock tick happened in the same promise job.
- `bound.`: and the file that `import()`s the program saw it settle in the same promise job. The design document shows
  why a bundle cannot always have this.
- `hang`: the reference settles and the variant does not.

In the profile `dyn`, pass `--agree=node,bun,spec --level=coarse`: how long `import()` takes differs between hosts, and
on about a quarter of the graphs that changes the outcome, so there is nothing to compare against.
