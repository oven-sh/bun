# Measuring the servers

`measure.py` builds the servers in `../app` and `../tanstack` with every Bun you give it, loads them side by side, and writes one line of JSON for each server, route and build. There are nine servers with the same eight routes: Bun.serve, Hono, Elysia, node:http, Koa, TanStack Start, Express, Fastify, and Fastify with schemas. `../answers.ts` has the routes. Every response is compared with the expected one, byte for byte.

You need Linux, `python3`, `perf` (with `kernel.perf_event_paranoid` at 2 or below), `taskset` and `cc`. The first run needs the network for `bun install`, unless `--modules` (`MODULES=` for the scripts) names an installed `node_modules`.

## Compiled ahead of time against the JIT

```sh
test/aot/servers/measure/against-the-jit.sh <bun with --aot> <released bun> [cores] [folder]
test/aot/servers/measure/against-the-jit.sh ./build/release/bun ~/.bun/bin/bun 0-15
```

Each server is built three times: with `--compile --aot` by the first Bun, with `--compile` by the second, and with `--compile` by the first again. The third column has the runtime of the first, so only the compiler separates those two.

The script prints its tables and leaves them in `<folder>/table.md`. First comes how many rows are ahead, level (within 2%) or behind. Then come requests per second on one core and on four, latency at a fixed rate, CPU time, instructions and instruction-cache misses per request, memory, the time to the first response, the size of the executable, and requests per second for every route.

The cores must be consecutive, idle and a multiple of eight. Sixteen cores take about four hours. `QUICK=1` takes about an hour and scatters more. `SERVERS=express,fastify` and `ROUTES=text,json` measure a part.

`against-the-jit-quick.sh` takes the same arguments and measures requests per second alone, in minutes. Its cores must be a multiple of four.

## On a busy machine

A row is marked void if anything else ran on its cores, and the tables say how many rows are. Instructions, memory and sizes hold on a busy machine. Requests per second, latency and CPU time do not.

## The other tools

| Tool | What it does |
| --- | --- |
| `measure.py`, `compare.py` | Any columns, servers and routes. `compare.py rows.jsonl <column> <column>` compares two columns with an error bar. |
| `requests_a_second.py` | Requests per second from the start of a process to its millionth request, with nothing attached to it. |
| `cost_by_request.py` | Instructions, cycles and CPU time by request number and by thread, from exec on. It shows what a JIT's compiler threads cost. |
| `stubs_by_request.py` | The property accesses by name that one request of a warm server sends through a stub, each with the check that failed. |
| `layers.py` | Charges profile samples to the layer that owns the code, for `measure.py --layers`. |
| `load.c`, `count_threads.c`, `count_sites.c` | The load generator and the counters that the scripts compile and start. |

The text at the top of each file has its commands and explains its method.

The Go and Rust servers that those texts mention are not in this repository. Leave `go` and `rust` out of `--servers`, and pass `--natives ""` to `requests_a_second.py`.
