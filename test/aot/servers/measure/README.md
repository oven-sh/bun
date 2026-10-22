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

## The small rows

    python3 test/aot/perf/against_the_jit.py <bun with --aot> <released bun> [--cores 0-15]

holds every everyday idiom of `../../perf/idioms` (typed and untyped) and every single operation of `../../perf/operations` against the JIT, by instructions and by CPU time, and lists the
rows that lose, worst first. Two minutes on sixteen cores.

## More

`measure.py --help` and the text at its top: any number of columns, other servers (`../effect`, the API servers, the Go and Rust twins under `../go` and `../rust`), hardware events, code layouts,
a soak mode, and cycles by the layer that owns the code. `compare.py` compares two columns pair by pair with an error bar; `layouts.py` averages over code layouts.
