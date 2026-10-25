# What does a typed file in a package buy?

A package can ship its JavaScript once more with the type annotations left in (`index.aot.ts`, behind the `"aot"` export condition; see `docs/bundler/aot-libraries.mdx`).
`bun compile` then compiles the package from that file. This folder measures what that is worth: the same program, the same answer, with the package as npm ships it and with its `.aot.ts` file.

    bun test/aot/typed-packages/measure/measure.ts --bun <bun with --aot> --released <a released bun> \
        --modules <an installed node_modules> --work <a folder> --cores 0,8 --out rows.jsonl

    bun test/aot/typed-packages/measure/measure.ts --table rows.jsonl

It needs Linux, `perf` (with `kernel.perf_event_paranoid` at 2 or below), `taskset` and `mkfifo`. Nothing is installed or fetched: `--modules` (any number of them, the first wins) names folders that
hold the packages of `package.json` here, installed. `--typed-modules` (any number) names folders of packages whose `package.json` has the `"aot"` condition. `--rows` and `--columns` measure a part, `--build-only` and `--no-build` split the builds from the measuring.

## Rows

`rows.ts` is the table. A row is a program under `programs/`, its workloads, and where the types of its packages come from.

| Row | The program | The typed files |
|---|---|---|
| `orders` | `total(json)`: `JSON.parse`, then a loop over 10, 1,000 or 100,000 lines | `packages/orders/index.aot.ts` |
| `react-to-string`, `react-to-readable-stream` | a shop's list of 240 products (nested components, three contexts, keys, `useId`, `memo`, conditional parts; 330 KB of HTML) and an article of 60 sections (115 KB, mostly text) | `react` and `react-dom` out of `--typed-modules`; without them the row has no typed column |
| `react-to-pipeable-stream` | the same pages through `react-dom/server.node` | none exists: the row has no typed column |
| `react-reconciler` | a terminal program on a host config of its own: 30 messages, a store that 75 selectors read through `useSyncExternalStore`, contexts, `memo`, memo caches as the React Compiler writes them, reducers, effects. A turn is three or four commits: a spinner's frame, a word more of a text, a key. `reconciled` stops where the host is told; `painted` also lays the nodes out, writes 300 rows and a patch against the last frame | `react` and `react-reconciler` out of `--typed-modules` |
| `seroval` | loader data with dates, maps, sets, shared references: `serialize`, and `toJSON` + `fromJSON` | `seroval` out of `--typed-modules` |
| `base64-js` | 48 KB of bytes to text and back; the loops over the bytes are in functions that the package does not export | `packages/base64-js/index.aot.ts`: the installed file with annotations added by hand and its three `exports.x =` lines written as one `export`, laid over a copy of the installed package with a `package.json` that names it |
| `zod` | an order of 25 items against a schema with nested objects, a discriminated union, formats, defaults, a refinement and a transform; once valid, once with eight issues | the TypeScript sources zod ships, `--conditions=@zod/source` |
| `hono`, `elysia` | eight requests through `app.fetch`: text, JSON, parameters, a body, HTML, two 404s, two middlewares | `bun compile --library` over the framework's own sources (`--sources hono=<folder>`) |

## Columns

| Column | The package | Built with |
|---|---|---|
| `as-installed` | as npm ships it | `bun compile` |
| `rebuilt` | what `bun compile --library` writes from the package's sources, without the `.aot.ts` files and the condition | `bun compile` |
| `typed` | with its `.aot.ts` file | `bun compile` |
| `erased` | with its `.aot.ts` file | `bun compile --aot-erase-types`: the same text, no types |
| `jit` | as npm ships it | `bun compile --no-aot`: the same Bun, its JIT |
| `released` | as npm ships it | `bun build --compile --production` by `--released` |
| `typed-by-ceiling-bun`, `no-tests-in-packages`, `no-tests-anywhere` | with its `.aot.ts` file | `--ceiling <bun>`, see below |

A `typed` build whose `--aot-report` counts no file under an `"aot"` condition (`statistics.TypedVersionsUsed`) stops the run: such a cell would be a second `as-installed`.

## What a cell is

- **One process a start, one core.** It is pinned with `taskset` and told that it has one core. `--starts` (3) fresh processes a cell; the columns of a workload run in turn on the same core, and the order rotates.
- **Warm.** `turns.ts` runs the workload for `--warm-up-milliseconds` (3,000) and at least `--warm-up-turns` (50), so that a JIT has reached its last tier, then waits.
- **Counted exactly.** `perf stat` starts the process with its counters off. They are switched on for the `--windows` (5) of `--window-milliseconds` (400) and off again: user instructions, user cycles and CPU time of all threads, the collector's included.
- **By the clock.** The program times each window itself. A start gives the mean of its windows, collections included, a cell the median start; `starts .. apart` is printed where they differ by over 3%.
- **As a request.** The React programs go through the event loop once a turn, as a request to a server does: the collector's timers and the sweeper run from there. Without it a loop of renders holds three times the memory.
- **The same answer.** The sha256 of the first and of the last answer of every process. A column with another answer than the first column's is void.
- **Nobody else on the core.** What the kernel charged to the core less what it charged to the process. A start with over 1% of guests is repeated, up to three times, and says who was there; one that is still disturbed is dropped, and a cell without three clean starts is void. Instructions, memory and sizes hold on a busy machine; times do not.
- **Memory.** `VmHWM`, and `Private_Dirty` of `smaps_rollup` behind the last window. The other programs do not return to the event loop between turns: theirs is a batch's memory, not a server's.
- **Code.** `codeBytes` of `--aot-report`: the machine code of the whole program, Bun's own modules included.

## The ceiling

How much could types ever buy here? `ceiling/without-tests-that-never-fail.patch` is a change to the code generator (`Source/JavaScriptCore/aot/codegen`) for measuring alone. It is unsound and must never be in a Bun that anybody uses.
With a Bun built from it as `--ceiling`, `measure.ts` builds the typed program with `--aot-count-branches`, runs every workload, and builds it again with the counts: a test of a value's type, or of an object's state
(is the slot filled, is the object frozen, has it the fields it was born with, is the built-in untouched ..), that passed every time is not generated. Bounds and holes of arrays stay. On these workloads the answers are right by construction.

- `no-tests-in-packages`: only tests in the code of the row's packages. This is what perfect knowledge of every value in the package would remove.
- `no-tests-anywhere`: also in the program and in Bun's own modules.
- `typed-by-ceiling-bun`: the `typed` column once more, built by that Bun. The two columns above are compared with this one.

It removes the tests and the code behind them. It does not show what a compiler that knew as much earlier could do besides: inline more, keep numbers unboxed, leave out the generic copy of a function.
The build prints, for each kind of test, how many places there are, how many never failed, how many always failed, and how often they ran.

## Rows that other tools measure

- **A program that is all TypeScript.** What are the types of 300,000 typed lines worth? The TypeScript compiler, built from its own sources, checks the `effect` package; once as it is and once with `--aot-erase-types`.
  The whole process is timed, start to exit, on eight cores, the columns in turn.

      bun build --compile --aot [--aot-erase-types] --production --format=esm src/tsc/tsc.ts --outfile tsc      in a checkout of TypeScript
      perf stat -e task-clock,cycles:u,instructions:u,duration_time ./tsc -p <effect>/tsconfig.json --pretty false

## Why a typed file buys little, or costs

    bun compile --aot-count-arrivals --aot-count-branches ..      BUN_JSC_aotCountsPath=<file> BUN_DESTRUCT_VM_ON_EXIT=1 ./program <workload> 0 100 1 0 < /dev/null
    bun compile --aot-log-type-mismatches ..                      ./program <workload> 0 100 1 0 < /dev/null 2> log

The last four arguments are those of `turns.ts`: no warm-up by time, 100 turns, one window of one turn. The first file has a line for every runtime operation that was called and for everything that arrived at an operation
which looks a name up at run time; compare the two builds. The log has a line for every value that did not have its declared type: `argument`, `property`, `element`, `call-result`, `return`, `cast`, with the type that was expected.
A type that fails there every time is one that no code of the program creates: an interface over objects that a plain function builds.
