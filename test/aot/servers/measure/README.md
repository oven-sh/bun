# Measuring the servers

Eight small servers with the same eight routes (`../app`, `../tanstack`; the routes and their answers are in `../answers.ts`): Bun.serve, Hono, Elysia,
node:http, Koa, TanStack Start, Express and Fastify. `measure.py` builds each of them with every Bun it is given, loads them side by side and writes
one line of JSON for each server, route and build. Every response is compared with the expected one, byte for byte.

## Compiled ahead of time against the JIT, in one command

    test/aot/servers/measure/against-the-jit.sh <bun with --aot> <released bun> [cores] [folder]

    test/aot/servers/measure/against-the-jit.sh ./build/release/bun ~/.bun/bin/bun 0-15

All columns are single-file executables of the same sources: `bun build --compile --aot` by the first Bun, `bun build --compile` by the second, which runs
them with its JIT, and `bun build --compile` by the first Bun again. That third column has the runtime, the built-in modules and the native code of the compiled one, so
what separates the two is the compiler alone; against another Bun the table also shows every difference between the two builds (link-time optimization, a faster `node:http`).
It prints, and leaves in `<folder>/table.md`:

- the count: ahead | level (within 2%) | behind, a row being one server and one measure;
- requests per second with the server pinned to one core, and to four;
- p50 and p99 latency at a fixed rate;
- CPU seconds for 100,000 requests;
- instructions, cycles, L1 instruction-cache misses and mispredicted branches per request: where two servers execute the same number of instructions and one serves fewer requests,
  the difference is usually code that has to be fetched again for every request;
- peak RSS and peak private memory under load;
- the time to the first correct response, and the size of the executable;
- requests per second for every route, worst first.

It needs Linux, `python3`, `perf` (with `kernel.perf_event_paranoid` at 2 or below), `taskset`, `cc`, and network access once, for `bun install` (`--modules` of `measure.py` takes an
installed `node_modules` instead, `MODULES=` of the script). The cores must be a multiple of eight, consecutive and idle. With sixteen of them it takes about three and a half hours: every
server, route and column is started twice and warmed each time. `QUICK=1` (one start, two rounds of one-second windows) takes about fifty minutes and scatters by up to 4% a row; thirty-two cores
halve either, and `SERVERS=express,fastify` or `ROUTES=text,json` measure a part.

## What makes the numbers fair

- **Warm-up.** Every process is loaded with at least 200,000 requests of its route, and on until the instructions per request of three windows in a row agree within 2%,
  before anything is recorded. That is what the JIT needs to reach its last tier; a compiled server is steady from the first window.
- **Side by side.** The processes of all columns are started, warmed and paused; then each in turn is resumed, loaded and paused again, so the columns
  are measured seconds apart. The order rotates. A job is repeated with fresh processes (`--starts`), because where a process's pages lie moves its
  cycles per request by up to 4%.
- **One core, four cores.** A server is pinned with `taskset` and told how many cores it has. Its JavaScript runs on one thread either way; with four cores the
  collector's helpers and the JIT's compiler threads have somewhere else to run. The client has three cores of its own.
- **Closed and open loop.** Requests per second come from a closed loop of 64 connections that keeps the server saturated. Latency comes from an open loop: every column is sent
  requests at one fixed rate, half of what the slowest column served, and a request's latency counts from the moment it was due, so a stall is charged to every request
  that it delayed.
- **Idle cores.** `measure.py` compares what the kernel charged to a lane's cores with what it charged to the server and the client. A row during which anything else ran there
  is marked void, and the table says how many are. Instructions, memory and sizes hold on a busy machine; requests per second, latency and CPU time do not.

## From exec to the millionth request, thread by thread

    python3 test/aot/servers/measure/cost_by_request.py --column aot=<bun with --aot>:--aot --column own=<the same bun> --column released=<released bun> \
        --servers express,fastify --routes text --cores 0-7 --work <a folder> --out rows.jsonl
    python3 test/aot/servers/measure/cost_by_request.py --table rows.jsonl

The table above compares servers that are warm. This one shows what it costs to get there, and who pays. A JIT compiles on threads of its own while the server answers. With a spare core
to run on, that work does not lower requests per second at all, but it is CPU time like any other.

- **Windows by request number.** A process is sent exactly as many requests as bring it to 1,000, 3,000, 10,000 .. 1,000,000 (`--marks`), and its counters are read at each mark. Every number is there
  for the window between two marks and as a sum from exec. The first window is exec to the first correct response.
- **Every thread by itself.** `count_threads.c` starts the server and opens a set of counters on each thread before the thread runs its first instruction: user and kernel instructions, user and kernel cycles,
  time on a core. Nothing is sampled or estimated, threads that end keep their counts, and the threads add up to the process. The tables group them by the names they give themselves: the thread that runs
  JavaScript, the JIT's compiler threads, the collector's threads, everything else. Kernel counts need `kernel.perf_event_paranoid` at 1 or below; the tables leave them out elsewhere.
- **One core, four cores.** As above. On one core the compiler threads take time from the thread that answers; on four they do not, and only CPU time and instructions show them.
- **Break-even.** The request at which a JIT's sum from exec, over all threads, falls below the compiled server's: by instructions and by CPU time.
- **Is the JIT ever done?** The last table has the CPU time of the compiler threads in the last window, per request and per second. `--run-env own:BUN_JSC_reportCompileTimes=1 --log dfg='using DFG' --log ftl='using FTL'`
  counts the functions compiled in every window, and `BUN_JSC_printEachOSRExit=1` with `--log exits='Speculation failure'` the times optimized code was left for slower code. Those two print a lot: take no timings from such a run.
- **What holds on a busy machine.** Instructions. CPU time and cycles need idle cores, and idle neighbors: give `--cores` a whole group of cores that share a last-level cache. Every table has the spread between
  the starts and ends with the share of the server's cores that went to somebody else, and a break-even that the spread does not decide is marked `~`. `--plain` reads CPU time alone, with no counters
  and no `count_threads`: counters are saved and restored at every context switch, and this shows what that costs.
- **One route or all of them.** A process serves one route of `--routes`. With `--in-turn` it serves all of them, a request of each in turn: more code is warm at once, which is closer to a real server.

Three columns, three starts, one route, both pinnings: six minutes a server on eight cores.

## The small rows

    python3 test/aot/perf/against_the_jit.py <bun with --aot> <released bun> [--cores 0-15]

holds every everyday idiom of `../../perf/idioms` (typed and untyped) and every single operation of `../../perf/operations` against the JIT, by instructions and by CPU time, and lists the
rows that lose, worst first. Two minutes on sixteen cores.

## More

`measure.py --help` and the text at its top: any number of columns, other servers (`../effect`, the API servers, the Go and Rust twins under `../go` and `../rust`), hardware events, code layouts,
a soak mode, and cycles by the layer that owns the code. `compare.py` compares two columns pair by pair with an error bar; `layouts.py` averages over code layouts.
