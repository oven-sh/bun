#!/usr/bin/env python3
"""Load-tests the servers in ../app and ../tanstack, comparing several builds side by side. Linux only; needs `perf`, `taskset` and `cc`.

    python3 measure.py --column aot=/path/to/bun:--aot --column released=/path/to/released/bun --out rows.jsonl
    python3 compare.py rows.jsonl aot released

Two builds of Bun on the small routes of one server, in about four minutes:

    python3 measure.py --column new=/path/to/new/bun:--aot --column previous=/path/to/previous/bun:--aot --servers tanstack \
        --routes text,json,params,post,async --warm-up 50000 --cores 0-15 --out rows.jsonl

A column is a name, the Bun that builds the executable with `bun build --compile`, and extra flags for that build.
`--run-env aot:NAME=value` sets an environment variable for the servers of one column.
`name=/path/to/bun:--aot@effect-plain` makes a column serve another server's program, so that two programs with the same routes
are measured seconds apart; `*` in that name stands for the server of the job. `name=/path/to/bun:--aot#hand` makes it serve another route: one with the same request and the same answer.
`name=/path/to/node:run` runs the entry point with that executable instead of compiling it.

The three servers under ../effect have routes of their own (`effectRoutes` in ../answers.ts): `effect` is an API written with
Effect, `effect-sources` is the same program with the Effect packages resolved to the TypeScript sources that they ship, and
`effect-plain` has the same routes written by hand on Bun.serve:

    python3 measure.py --servers effect --column aot=/path/to/bun:--aot --column sources=/path/to/bun:--aot@effect-sources \
        --column released=/path/to/released/bun --column node=/usr/local/bin/node:run --column plain=/path/to/bun:--aot@effect-plain --out rows.jsonl

One order, validated by zod and by hand and by two JITs, a valid one and one that is refused (`<route>-refused`, only when named):

    python3 measure.py --servers bun,hono,express --routes post,post-refused --column zod=/path/to/bun:--aot --column hand=/path/to/bun:--aot#hand \
        --column own=/path/to/bun --column released=/path/to/released/bun --out rows.jsonl

A job is one server and one route. Jobs are distributed over lanes. A lane is four consecutive cores: the server is pinned to
the first one and the client (load.c) to the other three. Servers are told they have one core (WTF_numberOfProcessorCores=1).
`--server-cores 4` gives a server four cores, and tells it so: its JavaScript still runs on one thread; the collector's helpers and a
JIT's compiler threads get the others. A lane is then eight cores.
`--rate 0.5` adds an open loop behind the rounds of the closed one: every column is sent requests at one fixed rate, half of what
the slowest column of the job served, for two windows; latency counts from the time a request was due (rate_p50_us, rate_p99_us).

Different runs of the same executable differ by up to 4% in cycles per request on the small routes, while a single process is
stable within 1%: it depends on where its pages end up. One process per column therefore cannot resolve a change below 5%, so
every job is measured `--starts` times, each time with a fresh process for every column.
That holds for the pages of the executable file as well. They stay where they are in the page cache for as long as the file lives,
so all processes of one file share one placement of its code in physical memory: two files with the same bytes have differed by 6%
in cycles per request on Express while three processes of either agreed within 0.5%. Every process therefore runs a copy of its
executable that was made for it, in /dev/shm (nothing is written to a disk), under a path that has the same length for every column:

  1. Each column is started and polled until the first correct response (time to first response is the median of
     `--first-responses` starts). RSS is read at that point. On the POST routes the invalid orders from ../answers.ts are sent.
  2. It is warmed up with at least `--warm-up` requests, until instructions per request of the last three windows are within 2%
     of each other, and then paused with SIGSTOP, once none of its threads has run for 100 ms (behind the collections that follow the load).
  3. For `--rounds` rounds, each column in turn is resumed, loaded and paused again, so all columns are measured seconds apart.
     A round more than 10% below the best round of the same process is treated as disturbed and dropped. Rounds are added, up
     to `--max-rounds`, until every column has three rounds within 3% of its best.

Where the compiled code lies matters as well, and that is fixed when the executable is built: two builds of Bun that make a server
do the same work have differed by 3% in cycles per request on the small routes of `effect`, start after start, because the code of
one lay elsewhere. Two builds compared in one layout each cannot resolve a change below that. `--layouts 5` builds every --aot
column five times, each with other padding around its code (--aot-layout-seed=1 to 5),
as the columns NAME.1 to NAME.5; layouts.py takes the mean over them, and their spread is the error bar:

    python3 measure.py --layouts 5 --starts 2 --column new=/path/to/new/bun:--aot --column previous=/path/to/previous/bun:--aot --servers effect --out rows.jsonl
    python3 layouts.py rows.jsonl new previous

The column order rotates from start to start. Every response is compared with the expected one, byte for byte.
`--servers go,rust` measures ../go (net/http) and ../rust (axum) for comparison. One handler serves their three POST routes: a typed
decoder validates by itself. They are built with `go build` and `cargo build --release` and have a single column, "native".
GOMAXPROCS=1 and SERVER_THREADS=1 in the environment make them run on one thread, like the JavaScript of the other servers.
TanStack Start has two extra routes, the pages / ("static") and /items ("list"). The expected page is whatever the first process
returned, with timestamps removed; under load only the length of a page is compared.

A window runs under `perf stat -p <pid>`, which counts all threads of the server. Hardware counters are saved and restored on
every context switch, which costs a server about 1%, and far more if its threads hand off work on every request. The first
window after SIGCONT also costs a JIT build about 1%. So a round is three windows: one that is discarded, one under
`-e task-clock` alone for requests per second and CPU time, and one under `-e instructions:u,cycles:u,task-clock` for
instructions and cycles.

Each output line is one server, route and column: the median over the starts of each start's median over its rounds, with the
value of every start under "starts". Start i of one column and start i of another were measured back to back, so compare.py
counts in how many of those pairs one column beat the other.

`--soak 5000000` looks for drift instead: memory that keeps growing and requests that get more expensive. One process per server
and column serves that many requests, cycling through all routes. Its line has RSS and private memory after every twentieth of
the run and the instructions per request of every twentieth. A cost that depends on the number of full GCs shows up a hundred
times sooner with `--run-env aot:BUN_JSC_useGenerationalGC=0`, which makes every GC a full one.

Guests. The cores must be free of other work, and on a shared machine they sometimes are not. Every window compares the time the
kernel charged to the lane's four cores (user, nice and system in /proc/stat) with the time it charged to the server and the client. What is
left over ran for somebody else. A round in which that is more than 1% of the server's core, or 3% of the client's cores, is
dropped like a disturbed one; a start without a clean round makes the row void ("void": true, no numbers compared by compare.py).
"guests" is the largest share seen on the server's core in a round that was kept.

`--events ic_cache_fill_l2,l2_cache_req_stat.ic_fill_miss` counts more hardware events, by perf's names, in the window that counts
instructions and cycles. On AMD Zen 4 these two are the lines of code that the first-level cache took from the L2 and the lines that
came from beyond the L2: neither is part of the other, and the lines fetched are their sum. A server whose requests run through more code than that cache holds is bound by them, not by its instructions.

`--layers` shows where the cycles and instructions of a request go. One process per server, route and column is warmed up and
then profiled with `perf record` under the same load. Every sample is charged to the layer that owns the code it fell in (see
layers.py): the compiled application, stubs, Bun's own JavaScript modules, Bun's native code, the engine's C++, ICU, GC, malloc,
libc. Samples in the stubs are also charged to the single stubs. For an --aot column a second profile with call chains says who
asked for the work of every layer: the application's compiled code, Bun's own modules, or nobody (native code on its own).
"sampled" is samples times period over the counted total: well under 1 means the kernel dropped samples, and then threads that
mostly sleep (GC helpers) look larger than they are. Kernel cycles are estimated as user cycles times kernel CPU time over user CPU time, read in a window without hardware
counters. The Buns must not be stripped.
With `--events ex_ret_brn_misp,bp_de_redirect` those events are sampled as well and charged to the same layers: who owns the mispredicted branches of a request, not only its cycles.
`compare.py rows.jsonl aot jit` prints the layers side by side and the difference, largest first.

    requests_per_second, instructions, cycles, cpu_us       per request; instructions and cycles in user mode
    counted_requests_per_second                             throughput while the hardware counters were running
    first_response_ms, ready_rss_mb                         from process start to the first correct response
    peak_rss_mb                                             VmHWM at the end
    private_mb                                              Anonymous minus LazyFree in smaps_rollup, the maximum of samples 50 ms apart
    alive_mb                                                alive after a full collection under load: one start more, not timed, in which every collection is a full one
    idle_anon_mb, load_anon_mb, after_anon_mb               RssAnon after the first response, its maximum under load, and two seconds after the last request
"""
import argparse, fcntl, functools, glob, json, multiprocessing, os, re, resource, shutil, signal, socket, statistics, subprocess, sys, tempfile, threading, time

import layers

HERE = os.path.dirname(os.path.abspath(__file__))
SERVERS = ["bun", "thin", "hono", "elysia", "node", "koa", "express", "fastify", "fastify-schemas", "tanstack"]
API_SERVERS = ["api-bun", "api-thin", "api-hono", "api-elysia", "api-node", "api-express", "api-fastify", "api-koa"]
EFFECT = {"effect": "./bun.ts", "effect-sources": "./bun.ts", "effect-plain": "./plain.ts"}
PAGES = [{"name": "static", "method": "GET", "path": "/", "type": "text/html"}, {"name": "list", "method": "GET", "path": "/items", "type": "text/html"}]
VALIDATING = ("post", "hand")
NATIVE = {"go": ["go", "build", "-o"], "rust": ["cargo", "build", "--release"]}
NATIVE_ROUTES = ("text", "json", "params", "post", "hand", "typed", "async", "stream")
NATIVE_COLUMN = {"name": "native", "run_env": {}}
# The kernel drops samples silently above kernel.perf_event_max_sample_rate, which it lowers by itself under load (seen: 5,300).
SAMPLES_PER_SECOND = 3000
PER_START = ("requests_per_second", "counted_requests_per_second", "instructions", "cycles", "cpu_us", "first_response_ms", "ready_rss_mb", "peak_rss_mb", "private_mb", "idle_anon_mb", "load_anon_mb", "after_anon_mb", "p50_us", "p99_us", "main_cpu_us", "ready_private_mb", "ready_instructions", "rate", "rate_p50_us", "rate_p99_us", "rate_cpu_us")


SYMBOLS_OF = {}


def report_by_address(data, executable):
    """The lines of `perf report --sort dso,symbol`, with the samples in the executable named by address and its own symbol table. The text of an --aot
    executable is mapped in several pieces, each at another distance from its file offset, and `perf report` knows one distance for a file."""
    import bisect, collections
    if executable not in SYMBOLS_OF:
        rows = []
        for line in subprocess.run(["nm", "-C", "--defined-only", executable], capture_output=True, text=True, errors="replace").stdout.split("\n"):
            fields = line.split(" ", 2)
            if len(fields) == 3 and fields[1] in "tTwW":
                rows.append((int(fields[0], 16), fields[2]))
        rows.sort()
        SYMBOLS_OF[executable] = ([row[0] for row in rows], [row[1] for row in rows])
    addresses, names = SYMBOLS_OF[executable]
    counts = collections.Counter()
    for line in subprocess.run(["perf", "script", "-i", data, "-F", "ip,sym,dso"], capture_output=True, text=True, errors="replace").stdout.split("\n"):
        match = re.match(r"\s*([0-9a-f]+) (.*) \((.*)\)$", line)
        if not match:
            continue
        address, symbol, dso = int(match.group(1), 16), match.group(2), match.group(3)
        if "aot-servers-lane" in dso and addresses:
            index = bisect.bisect_right(addresses, address) - 1
            symbol = names[index] if index >= 0 else "[unknown]"
        counts[dso if dso.startswith("/tmp/perf-") else dso.rsplit("/", 1)[-1], symbol] += 1
    return "\n".join("%d %s [.] %s" % (samples, dso, symbol) for (dso, symbol), samples in counts.items())


class MeasurementError(Exception):
    pass


def parse_core_range(text):
    first, _, last = text.partition("-")
    return list(range(int(first), int(last or first) + 1))


USE_ROUTE_BODY = object()


def send_request(port, route, body=USE_ROUTE_BODY):
    """Sends one request on its own connection. Returns the status, the content type and the body."""
    if body is USE_ROUTE_BODY:
        body = route.get("request")
    head = "%s %s HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nConnection: close\r\n" % (route["method"], route["path"], port)
    head += "".join("%s: %s\r\n" % pair for pair in route.get("headers", {}).items())
    data = b"" if body is None else body.encode()
    if body is not None:
        head += "Content-Type: application/json\r\nContent-Length: %d\r\n" % len(data)
    with socket.create_connection(("127.0.0.1", port), timeout=10) as connection:
        connection.sendall(head.encode() + b"\r\n" + data)
        response = b""
        while chunk := connection.recv(65536):
            response += chunk
    head, rest = response.split(b"\r\n\r\n", 1)
    lines = head.decode("latin-1").split("\r\n")
    fields = {line.split(":", 1)[0].lower(): line.split(":", 1)[1].strip() for line in lines[1:]}
    if fields.get("transfer-encoding", "").lower() == "chunked":
        decoded = b""
        while rest:
            size, rest = rest.split(b"\r\n", 1)
            size = int(size.split(b";")[0], 16)
            if size == 0:
                break
            decoded, rest = decoded + rest[:size], rest[size + 2:]
        rest = decoded
    return int(lines[0].split()[1]), fields.get("content-type", "").split(";")[0].strip().lower(), rest


def strip_timestamps(body):
    return re.sub(rb"\b\d{13}\b", b"<time>", body)


def private_mb(pid):
    try:
        text = open("/proc/%d/smaps_rollup" % pid).read()
    except OSError:
        return 0.0
    kb = {name: int(value) for name, value in re.findall(r"^(\w+):\s+(\d+) kB", text, re.M)}
    return (kb.get("Anonymous", 0) - kb.get("LazyFree", 0)) / 1024


def core_ticks(cores):
    """Clock ticks that the kernel charged to user, nice and system time on these cores."""
    wanted = {"cpu%d" % core for core in cores}
    return sum(sum(int(field) for field in line.split()[1:4]) for line in open("/proc/stat") if line.split(" ", 1)[0] in wanted)


def proc_status_mb(pid, name):
    return int(re.search(r"^%s:\s+(\d+)" % name, open("/proc/%d/status" % pid).read(), re.M).group(1)) / 1024


def program_of(column, server):
    return (column.get("server") or server).replace("*", server)


class Server:
    def __init__(self, options, lane, spec, server, route, column):
        self.name = "%s/%s/%s" % (server, route["name"], column["name"])
        if column.get("route"):
            route = next(other for other in spec["routes"] + spec["refusedRoutes"] if other["name"] == column["route"] + ("-refused" if route["name"].endswith("-refused") else ""))
        self.options, self.lane, self.spec, self.route, self.column = options, lane, spec, route, column
        self.at_rate = {}
        self.executable = os.path.join(options.work, "bin", "%s-%s" % (program_of(column, server), column["name"]))
        self.folder = os.path.join(options.work, "lane-%d" % lane["server"], column["name"])
        self.copy = os.path.join("/dev/shm" if os.access("/dev/shm", os.W_OK) else options.work, "aot-servers-lane-%03d-column-%02d" % (lane["server"], options.columns.index(column) if column in options.columns else 99))
        os.makedirs(self.folder, exist_ok=True)
        self.cwd = os.path.join(options.work, "tanstack") if server == "tanstack" else self.folder
        self.process, self.rounds, self.max_private_mb, self.max_anon_mb, self.sampled = None, [], 0.0, 0.0, {}

    def kill(self):
        if self.process and self.process.poll() is None:
            self.process.kill()
            self.process.wait()
        if os.path.exists(self.copy):
            os.remove(self.copy)

    def run_time_ns(self):
        total = 0
        try:
            for thread in os.listdir("/proc/%d/task" % self.process.pid):
                total += int(open("/proc/%d/task/%s/schedstat" % (self.process.pid, thread)).read().split()[0])
        except (OSError, ValueError, IndexError):
            pass
        return total

    def pause(self):
        """Stops the server once none of its threads has run for 100 ms. When the load ends, a Bun server runs a young and a full
        collection. A SIGSTOP right behind the load fell before them, into them or behind them, and the next full collection
        is put off by the square root of the last one's length by the clock: one executable's starts ranged from 48 to 63 MB
        of peak RSS. Now the stop always falls behind them."""
        deadline, quiet_polls, before = time.perf_counter() + 3, 0, self.run_time_ns()
        while quiet_polls < 10 and time.perf_counter() < deadline:
            time.sleep(0.01)
            now = self.run_time_ns()
            quiet_polls, before = (quiet_polls + 1 if now - before < 50000 else 0), now
        self.process.send_signal(signal.SIGSTOP)

    def resume(self):
        self.process.send_signal(signal.SIGCONT)

    def log_tail(self):
        return open(os.path.join(self.folder, "server.log"), "rb").read()[-300:].decode("latin-1").replace("\n", " | ")

    def start(self):
        env = dict(os.environ, NODE_ENV="production", BUN_ENABLE_CRASH_REPORTING="0", DO_NOT_TRACK="1", WTF_numberOfProcessorCores=str(self.options.server_cores))
        env.update(self.column["run_env"])
        first_response_times = []
        self.lane["spawned"] += 1
        self.port = 20000 + self.lane["server"] * 64 + self.lane["spawned"] % 64
        env["PORT"] = str(self.port)
        self.kill()
        self.ready_instructions = self.count_instructions_to_ready(env)
        for _ in range(self.options.first_responses):
            self.kill()
            self.lane["spawned"] += 1
            self.port = 20000 + self.lane["server"] * 64 + self.lane["spawned"] % 64
            env["PORT"] = str(self.port)
            log = open(os.path.join(self.folder, "server.log"), "wb")
            shutil.copy(self.executable, self.copy)
            start_time = time.perf_counter()
            self.process = subprocess.Popen(["taskset", "-c", self.lane["server_cores"], self.copy], env=env, cwd=self.cwd, stdin=subprocess.DEVNULL, stdout=log, stderr=log)
            response = None
            while time.perf_counter() - start_time < 30 and self.process.poll() is None:
                try:
                    response = send_request(self.port, self.route)
                    break
                except (OSError, ValueError, IndexError):
                    time.sleep(0.0005)
            if response is None:
                raise MeasurementError("no response: " + self.log_tail())
            first_response_times.append((time.perf_counter() - start_time) * 1e3)
            if "expectedBody" not in self.route and response[0] == 200:
                self.route["expectedBody"] = strip_timestamps(response[2]).decode()
            if (response[0], self.route["type"] if self.route["type"] == "-" else response[1], strip_timestamps(response[2])) != (self.route.get("status", 200), self.route["type"], self.route["expectedBody"].encode()):
                raise MeasurementError("unexpected response: %d %s %r" % (response[0], response[1], response[2][:80]))
        self.first_response_ms = statistics.median(first_response_times)
        self.ready_rss_mb = proc_status_mb(self.process.pid, "VmRSS")
        self.idle_anon_mb = proc_status_mb(self.process.pid, "RssAnon")
        self.ready_private_mb = private_mb(self.process.pid)
        self.invalid_order_statuses = {}
        if self.route["method"] == "POST" and self.route.get("status", 200) == 200:
            for description, body in self.spec["invalidOrders"].items():
                self.invalid_order_statuses[description] = send_request(self.port, self.route, body)[0]
                # encoding/json and serde treat a null optional field like a missing one.
                if self.route["name"] in VALIDATING and self.invalid_order_statuses[description] != 400 and not (self.column is NATIVE_COLUMN and "null" in description):
                    raise MeasurementError("%s: expected 400, got %d" % (description, self.invalid_order_statuses[description]))
        self.load_files = self.write_load_files(self.route, response[2])

    def write_load_files(self, route, expected_body):
        """Writes the request and expected-response files that load.c reads for one route. Returns the two paths."""
        request = "%s %s HTTP/1.1\r\nHost: 127.0.0.1:%d\r\n" % (route["method"], route["path"], self.port)
        request += "".join("%s: %s\r\n" % pair for pair in route.get("headers", {}).items())
        body = route.get("request", "").encode()
        if body:
            request += "Content-Type: application/json\r\nContent-Length: %d\r\n" % len(body)
        paths = [os.path.join(self.folder, "request-" + route["name"]), os.path.join(self.folder, "expected-" + route["name"])]
        open(paths[0], "wb").write(request.encode() + b"\r\n" + body)
        comparison = "exact" if strip_timestamps(expected_body) == expected_body else "length"
        open(paths[1], "wb").write(("%d\n%s\n%s\n" % (route.get("status", 200), route["type"], comparison)).encode() + expected_body)
        return paths

    def run_window(self, requests, counters=True, rate=0):
        """Sends a fixed number of requests and returns per-request costs."""
        pid, report, done = self.process.pid, os.path.join(self.folder, "perf.csv"), threading.Event()

        def sample():
            while not done.wait(0.05):
                self.max_private_mb = max(self.max_private_mb, private_mb(pid))
                self.max_anon_mb = max(self.max_anon_mb, proc_status_mb(pid, "RssAnon"))

        sampler = threading.Thread(target=sample, daemon=True)
        sampler.start()
        client = ["taskset", "-c", self.lane["client"], os.path.join(self.options.work, "bin", "load"), str(self.port), str(self.options.connections), str(requests), "3"]
        client_cores = parse_core_range(self.lane["client"])
        main_before = self.main_thread_ns()
        ticks_before = (core_ticks(parse_core_range(self.lane["server_cores"])), sum(self.cpu_ticks()), core_ticks(client_cores), sum(os.times()[:4]), time.perf_counter())
        try:
            # perf enumerates the threads and then opens a counter on each; a thread that exits in between fails the whole call.
            for _ in range(4):
                run = subprocess.run(["perf", "stat", "-x,", "-o", report, "-e", ",".join(["instructions:u", "cycles:u", "task-clock"] + [event + ":u" for event in self.options.events]) if counters else "task-clock", "-p", str(pid), "--"] + client + self.load_files, capture_output=True, text=True, env=dict(os.environ, LOAD_RATE=str(rate)) if rate else None)
                if "sys_perf_event_open" not in run.stderr:
                    break
        finally:
            done.set()
            sampler.join()
        if self.process.poll() is not None:
            raise MeasurementError("the server exited with code %s: %s" % (self.process.returncode, self.log_tail()))
        ticks = os.sysconf("SC_CLK_TCK")
        elapsed = (time.perf_counter() - ticks_before[4]) * ticks
        server_guests = (core_ticks(parse_core_range(self.lane["server_cores"])) - ticks_before[0] - (sum(self.cpu_ticks()) - ticks_before[1])) / elapsed
        client_guests = (core_ticks(client_cores) - ticks_before[2] - (sum(os.times()[:4]) - ticks_before[3]) * ticks) / (elapsed * len(client_cores))
        words = run.stdout.split()
        printed = dict(zip(words[0::2], words[1::2]))
        if run.returncode != 0 or printed.get("requests") != str(requests):
            raise MeasurementError("the client: " + (run.stderr or run.stdout)[-200:].replace("\n", " "))
        counted = {}
        for line in open(report):
            fields = line.strip().split(",")
            if len(fields) > 4 and fields[0].replace(".", "").isdigit():
                counted[fields[2].split(":")[0]] = float(fields[0])
        if len(counted) < (3 + len(self.options.events) if counters else 1):
            raise MeasurementError("perf: " + open(report).read()[-160:].replace("\n", " "))
        return {
            "requests": requests,
            "requests_per_second": requests / float(printed["seconds"]),
            "instructions": counted.get("instructions", 0) / requests,
            "cycles": counted.get("cycles", 0) / requests,
            "cpu_us": counted["task-clock"] * 1e3 / requests,
            "main_cpu_us": (self.main_thread_ns() - main_before) / 1e3 / requests,
            "p50_us": float(printed["p50_us"]), "p99_us": float(printed["p99_us"]),
            "events": {event: counted.get(event, 0) / requests for event in self.options.events},
            "guests": max(0.0, server_guests),
            "disturbed": server_guests > 0.01 or client_guests > 0.03,
        }

    def main_thread_ns(self):
        try:
            return int(open("/proc/%d/task/%d/schedstat" % (self.process.pid, self.process.pid)).read().split()[0])
        except (OSError, ValueError, IndexError):
            return 0

    def count_instructions_to_ready(self, env):
        report = os.path.join(self.folder, "ready.csv")
        shutil.copy(self.executable, self.copy)
        counter = subprocess.Popen(["perf", "stat", "-x,", "-o", report, "-e", "instructions:u", "--", "taskset", "-c", self.lane["server_cores"], self.copy], env=env, cwd=self.cwd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        start_time, answered = time.perf_counter(), False
        while time.perf_counter() - start_time < 30 and counter.poll() is None and not answered:
            try:
                send_request(self.port, self.route)
                answered = True
            except (OSError, ValueError, IndexError):
                time.sleep(0.0005)
        while counter.poll() is None:
            subprocess.run(["pkill", "-KILL", "-P", str(counter.pid)])
            try:
                counter.wait(timeout=0.2)
            except subprocess.TimeoutExpired:
                pass
        for line in open(report):
            fields = line.strip().split(",")
            if answered and len(fields) > 2 and fields[0].isdigit():
                return int(fields[0])
        return 0

    def cpu_ticks(self):
        fields = open("/proc/%d/stat" % self.process.pid).read().rsplit(")", 1)[1].split()
        return int(fields[11]), int(fields[12])

    def profile(self, event, per_request):
        """Samples one window of load. Returns the per-request cost by layer and the heaviest symbols of every layer."""
        data = os.path.join(self.folder, "perf.data")
        requests = self.window_size * 2
        period = int(per_request * self.window_size / (SAMPLES_PER_SECOND * self.options.window_seconds))
        client = ["taskset", "-c", self.lane["client"], os.path.join(self.options.work, "bin", "load"), str(self.port), str(self.options.connections), str(requests), "3"]
        for _ in range(6):
            run = subprocess.run(["perf", "record", "-N", "-B", "-e", event + ":u", "-c", str(period), "-o", data, "-p", str(self.process.pid), "--"] + client + self.load_files, capture_output=True, text=True)
            if run.returncode == 0:
                break
        if run.returncode != 0:
            raise MeasurementError("perf record: " + (run.stderr or run.stdout)[-200:].replace("\n", " "))
        report = report_by_address(data, self.executable)
        image_map, perf_map = self.executable + ".map", "/tmp/perf-%d.map" % self.process.pid
        by_stub = {}
        if os.path.exists(image_map) and os.path.exists(perf_map):
            addresses = subprocess.run(["perf", "script", "-i", data, "-F", "ip"], capture_output=True, text=True).stdout.split()
            by_stub = layers.count_stubs([int(address, 16) for address in addresses], perf_map, image_map)
        os.remove(data)
        by_layer, by_symbol = layers.read_report(report.split("\n"), layers.kind_of(self.name.split("/")[0] if self.column is NATIVE_COLUMN else self.column.get("kind", "")))
        scale = per_request / sum(by_layer.values())
        self.sampled[event] = round(sum(by_layer.values()) * period / (per_request * requests), 3)
        heaviest = {layer: [[symbol, round(samples * scale)] for (owner, symbol), samples in by_symbol.most_common() if owner == layer][:12] for layer in by_layer}
        if by_stub:
            heaviest["stubs"] = [[name, round(samples * scale)] for name, samples in by_stub.most_common(40)]
        return {layer: round(samples * scale) for layer, samples in by_layer.items()}, heaviest

    def profile_callers(self, per_request):
        """Samples one window with call chains. Returns cycles per request by layer and by the compiled code that asked for them."""
        data = os.path.join(self.folder, "perf.data")
        requests = self.window_size * 2
        period = int(per_request * self.window_size / (SAMPLES_PER_SECOND * self.options.window_seconds))
        client = ["taskset", "-c", self.lane["client"], os.path.join(self.options.work, "bin", "load"), str(self.port), str(self.options.connections), str(requests), "3"]
        for _ in range(6):
            run = subprocess.run(["perf", "record", "-N", "-B", "-g", "-e", "cycles:u", "-c", str(period), "-o", data, "-p", str(self.process.pid), "--"] + client + self.load_files, capture_output=True, text=True)
            if run.returncode == 0:
                break
        if run.returncode != 0:
            raise MeasurementError("perf record -g: " + (run.stderr or run.stdout)[-200:].replace("\n", " "))
        counts = layers.read_call_chains(subprocess.run(["perf", "script", "-i", data, "-F", "ip,sym,dso"], capture_output=True, text=True, errors="replace").stdout.split("\n"))
        os.remove(data)
        scale = per_request / sum(counts.values())
        asked = {}
        for (layer, who), samples in counts.items():
            asked.setdefault(who, {})[layer] = round(samples * scale)
        return asked

    def warm_up(self):
        start_time, total, size, windows = time.perf_counter(), 0, 2000, []
        while True:
            windows.append(self.run_window(size))
            total += size
            size = 8000 if len(windows) == 1 else int(min(100000, max(10000, round(windows[-1]["requests_per_second"] * 1.5, -4))))
            last = [window["instructions"] for window in windows[-3:]]
            self.settled = total >= self.options.warm_up and len(windows) >= 5 and (max(last) - min(last)) * 100 <= 2 * min(last)
            if self.settled or (total >= self.options.warm_up and time.perf_counter() - start_time > 45) or time.perf_counter() - start_time > 270:
                break
        self.window_size = int(min(100000, max(5000, round(windows[-1]["requests_per_second"] * self.options.window_seconds, -3))))

    def run_round(self):
        self.run_window(self.window_size, counters=False)  # Discarded: the first window after SIGCONT.
        timed = self.run_window(self.window_size, counters=False)
        counted = self.run_window(self.window_size)
        return dict(timed, instructions=counted["instructions"], cycles=counted["cycles"], counted_requests_per_second=counted["requests_per_second"], events=counted["events"],
                    guests=max(timed["guests"], counted["guests"]), disturbed=timed["disturbed"] or counted["disturbed"])

    def alive_after_full_collections(self):
        """Megabytes alive after a full collection under load: the median of the second half of a run in which every collection
        is a full one. Peak RSS and private memory hang on when collections happen to fall; this does not. None where the log
        has no collection: a server that allocates too little."""
        self.column = dict(self.column, run_env=dict(self.column["run_env"], BUN_JSC_logGC="1", BUN_JSC_useGenerationalGC="0"))
        self.start()
        self.run_window(self.options.alive_requests, counters=False)
        self.kill()
        text = open(os.path.join(self.folder, "server.log"), "rb").read().decode("latin-1")
        alive = [int(kb) for kb in re.findall(r"=> (\d+)kb, p=", text)]
        return statistics.median(alive[len(alive) // 2:]) / 1024 if alive else None

    def is_stable(self):
        best = max(each["requests_per_second"] for each in self.rounds)
        return sum(1 for each in self.rounds if each["requests_per_second"] >= 0.97 * best and not each["disturbed"]) >= min(3, self.options.rounds)

    def result(self):
        if strip_timestamps(send_request(self.port, self.route)[2]) != self.route["expectedBody"].encode():
            raise MeasurementError("unexpected response after the last round")
        peak = proc_status_mb(self.process.pid, "VmHWM")
        time.sleep(2)
        after_anon_mb = proc_status_mb(self.process.pid, "RssAnon")
        self.kill()
        best = max(each["requests_per_second"] for each in self.rounds)
        clean_rounds = [each for each in self.rounds if not each["disturbed"]]
        valid_rounds = [each for each in clean_rounds or self.rounds if each["requests_per_second"] >= 0.9 * best] or self.rounds
        result = {name: statistics.median(each[name] for each in valid_rounds) for name in ("requests_per_second", "counted_requests_per_second", "instructions", "cycles", "cpu_us", "p50_us", "p99_us", "main_cpu_us")}
        result.update(ready_private_mb=self.ready_private_mb, ready_instructions=self.ready_instructions)
        result.update(first_response_ms=self.first_response_ms, ready_rss_mb=self.ready_rss_mb, peak_rss_mb=peak, private_mb=self.max_private_mb)
        result.update(rate=self.at_rate.get("rate", 0), rate_p50_us=self.at_rate.get("p50_us", 0), rate_p99_us=self.at_rate.get("p99_us", 0), rate_cpu_us=self.at_rate.get("cpu_us", 0))
        result.update(void=not clean_rounds, guests=max(each["guests"] for each in valid_rounds))
        result["events"] = {event: round(statistics.median(each["events"][event] for each in valid_rounds), 2) for event in self.options.events}
        result.update(idle_anon_mb=self.idle_anon_mb, load_anon_mb=self.max_anon_mb, after_anon_mb=after_anon_mb)
        result.update(settled=self.settled, stable=self.is_stable(), rounds=len(self.rounds), rounds_kept=len(valid_rounds), invalid_order_statuses=self.invalid_order_statuses)
        return result


def measure_job(options, lane, spec, server, route):
    """Measures one server and route. Returns one output line per column."""
    columns = [NATIVE_COLUMN] if server in NATIVE else options.columns
    results = {column["name"]: {} for column in columns}
    failures = {}

    def run_step(each, step):
        try:
            step()
            return True
        except Exception as error:
            each.kill()
            failures.setdefault(each.column["name"], []).append(str(error) if isinstance(error, MeasurementError) else repr(error))
            print("%-32s FAILED: %s" % (each.name, str(error)[:200]), flush=True)
            return False

    for start in range(options.starts):
        rotation = start % len(columns)
        running = []
        for column in columns[rotation:] + columns[:rotation]:
            each = Server(options, lane, spec, server, route, column)
            if run_step(each, each.start) and run_step(each, each.warm_up):
                each.pause()
                running.append(each)
        for n in range(max(options.rounds, options.max_rounds)):
            if n >= options.rounds and all(each.is_stable() for each in running):
                break
            for each in list(running):
                each.resume()
                if run_step(each, lambda: each.rounds.append(each.run_round())):
                    each.pause()
                else:
                    running.remove(each)
        # The open loop: the same rate for every column, one that the slowest can hold, so that what differs is how long a request waits and not how many are served.
        rate = options.rate * min((max(one["requests_per_second"] for one in each.rounds) for each in running if each.rounds), default=0)
        for each in list(running) if rate else []:
            each.resume()
            if run_step(each, lambda: each.at_rate.update(each.run_window(max(1000, int(rate * options.window_seconds * 2)), counters=False, rate=rate), rate=rate)):
                each.pause()
            else:
                running.remove(each)
        for each in running:
            each.resume()
            run_step(each, lambda: results[each.column["name"]].__setitem__(start, each.result()))
    alive = {}
    for column in columns if options.alive_requests else []:
        if column is NATIVE_COLUMN:
            continue
        each = Server(options, lane, spec, server, route, column)
        try:
            alive[column["name"]] = each.alive_after_full_collections()
        except Exception as error:
            each.kill()
            print("%-32s alive after full collections: not read: %s" % (each.name, str(error)[:160]), flush=True)
    lines = []
    for column in columns:
        starts = results[column["name"]]
        line = {"server": server, "route": route["name"], "column": column["name"], "failures": failures.get(column["name"], [])}
        if starts:
            line.update({name: statistics.median(each[name] for each in starts.values()) for name in PER_START})
            line["starts"] = {str(start): dict({name: round(each[name], 2) for name in PER_START}, **each["events"]) for start, each in starts.items()}
            line["alive_mb"] = alive.get(column["name"])
            line["settled"] = all(each["settled"] for each in starts.values())
            line["stable"] = all(each["stable"] for each in starts.values())
            line["void"] = any(each["void"] for each in starts.values())
            line["events"] = options.events
            line["guests"] = round(max(each["guests"] for each in starts.values()), 4)
            line["invalid_order_statuses"] = next(iter(starts.values()))["invalid_order_statuses"]
            line["executable_mb"] = os.path.getsize(os.path.join(options.work, "bin", "%s-%s" % (program_of(column, server), column["name"]))) / 1e6
            line["build_seconds"] = column.get("build_seconds", {}).get(program_of(column, server))
            print("%-32s %8.0f/s | %9.0f instructions %9.0f cycles %7.2f us CPU | peak RSS %6.1f private %6.1f alive %s ready %5.1f MB | first %6.1f ms | %d starts" % (
                "%s/%s/%s" % (server, route["name"], column["name"]), line["requests_per_second"], line["instructions"], line["cycles"], line["cpu_us"],
                line["peak_rss_mb"], line["private_mb"], "%5.2f" % line["alive_mb"] if line["alive_mb"] is not None else "    -", line["ready_rss_mb"], line["first_response_ms"], len(starts)) + (" VOID: guests on its cores" if line["void"] else ""), flush=True)
        lines.append(line)
    return lines


def soak_job(options, lane, spec, server, routes):
    """Runs one long-lived process per column over all routes. Returns memory and instructions per request for every twentieth of the run."""
    lines = []
    for column in [NATIVE_COLUMN] if server in NATIVE else options.columns:
        each = Server(options, lane, spec, server, routes[0], column)
        line = {"server": server, "route": "soak", "column": column["name"], "failures": [], "requests": [], "rss_mb": [], "private_mb": [], "instructions": []}
        try:
            each.start()
            each.load_files = [path for route in routes for path in each.write_load_files(route, route["expectedBody"].encode())]
            for n in range(20):
                line["instructions"].append(round(each.run_window(options.soak // 20)["instructions"]))
                line["requests"].append((n + 1) * (options.soak // 20))
                line["rss_mb"].append(round(proc_status_mb(each.process.pid, "VmRSS"), 1))
                line["private_mb"].append(round(private_mb(each.process.pid), 1))
        except Exception as error:
            line["failures"].append(str(error) if isinstance(error, MeasurementError) else repr(error))
        each.kill()
        print("%-24s RSS, MB: %s | instructions: %s%s" % ("%s/%s" % (server, column["name"]), " ".join("%.0f" % mb for mb in line["rss_mb"]), " ".join("%d" % count for count in line["instructions"]), " FAILED: " + line["failures"][0][:160] if line["failures"] else ""), flush=True)
        lines.append(line)
    return lines


def layers_job(options, lane, spec, server, route):
    """Profiles one process per column under load. Returns cycles and instructions per request by layer."""
    lines = []
    for column in [NATIVE_COLUMN] if server in NATIVE else options.columns:
        each = Server(options, lane, spec, server, route, column)
        line = {"server": server, "route": route["name"], "column": column["name"], "failures": [], "layers": {}, "heaviest": {}}
        try:
            each.start()
            each.warm_up()
            before = each.cpu_ticks()
            each.run_window(each.window_size * 2, counters=False)
            after = each.cpu_ticks()
            line.update(each.run_window(each.window_size * 2))
            line["void"] = line.pop("disturbed")
            for event in ("cycles", "instructions", *options.events):
                line["layers"][event], line["heaviest"][event] = each.profile(event, line[event] if event in line else line["events"][event])
            if "--aot" in column.get("flags", []):
                line["asked"] = each.profile_callers(line["cycles"])
            line["sampled"] = each.sampled
            line["layers"]["cycles"]["kernel"] = round(line["cycles"] * (after[1] - before[1]) / max(1, after[0] - before[0]))
        except Exception as error:
            line["failures"].append(str(error) if isinstance(error, MeasurementError) else repr(error))
        each.kill()
        print("%-32s %s%s" % (each.name, " ".join("%s %d" % pair for pair in line["layers"].get("cycles", {}).items()), " FAILED: " + line["failures"][0][:160] if line["failures"] else ""), flush=True)
        lines.append(line)
    return lines


def run_lane(options, spec, first_core, jobs, results_queue):
    os.sched_setaffinity(0, set(range(first_core + options.server_cores, first_core + options.server_cores + 3)))
    # A lane's first core gives it its ports and the names of its copies, so two runs on one machine must not share cores: whoever comes second waits.
    held = []
    for block in range(first_core // 4 * 4, first_core + options.server_cores + 3, 4):
        held.append(open(os.path.join("/dev/shm" if os.access("/dev/shm", os.W_OK) else tempfile.gettempdir(), "aot-servers-cores-%03d.lock" % block), "w"))
        fcntl.flock(held[-1], fcntl.LOCK_EX)
    lane = {"server": first_core, "server_cores": "%d-%d" % (first_core, first_core + options.server_cores - 1), "client": "%d-%d" % (first_core + options.server_cores, first_core + options.server_cores + 2), "spawned": 0}
    for stale_copy in glob.glob("/dev/shm/aot-servers-lane-%03d-column-*" % first_core):
        os.remove(stale_copy)
    while True:
        job = jobs.get()
        if job is None:
            return
        results_queue.put((soak_job if options.soak else layers_job if options.layers else measure_job)(options, lane, spec, *job))


def run_checked(command, **more):
    run = subprocess.run(command, capture_output=True, text=True, **more)
    if run.returncode != 0:
        sys.exit("%s failed:\n%s" % (" ".join(command), (run.stderr or run.stdout)[-2000:]))
    return run.stdout


@functools.lru_cache(maxsize=None)
def accepts_layout_seed_flag(bun):
    """Older Buns reject the flag and read BUN_AOT_LAYOUT_SEED instead."""
    probe = subprocess.run([bun, "build", "--compile", "--aot", "--aot-layout-seed=1", "./no-such-file.ts"], capture_output=True, text=True, stdin=subprocess.DEVNULL)
    return "unknown flag" not in probe.stderr


def with_layout_seed(column, seed):
    """A copy of the column that is built with another code layout. The variable is always set, so a wrong probe cannot lose the seed: a Bun that takes the flag ignores the variable."""
    flags = ["--aot-layout-seed=%d" % seed] if accepts_layout_seed_flag(column["bun"]) else []
    return dict(column, name="%s.%d" % (column["name"], seed), flags=column["flags"] + flags, run_env=dict(column["run_env"]), build_env=dict(column["build_env"], BUN_AOT_LAYOUT_SEED=str(seed)), build_seconds={})


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--column", action="append", required=True, metavar="NAME=BUN[:FLAGS][@SERVER]")
    parser.add_argument("--run-env", action="append", default=[], metavar="COLUMN:NAME=VALUE")
    parser.add_argument("--build-env", action="append", default=[], metavar="COLUMN:NAME=VALUE")
    parser.add_argument("--out", required=True, help="output file; lines are appended")
    parser.add_argument("--servers", default=",".join(SERVERS))
    parser.add_argument("--routes", default="", help="names from ../answers.ts, static, list; all by default")
    parser.add_argument("--cores", default="0-3", help="a range of consecutive cores, a multiple of four; every four cores form a lane")
    parser.add_argument("--modules", help="a node_modules folder with the packages from ../app/package.json and ../tanstack/package.json; skips `bun install`")
    parser.add_argument("--effect-modules", help="a node_modules folder with the packages from ../effect/package.json; skips `bun install`")
    parser.add_argument("--lock", help="a file to hold an exclusive lock on while measuring, for cores that are shared with other measurements; building does not hold it. Several files, separated by commas: all of them. '!' and a line of shell: that line takes the locks, in a shell that lives until the measurement has ended")
    parser.add_argument("--work", help="working directory for executables and logs; a temporary one by default")
    parser.add_argument("--server-cores", type=int, default=1, help="the cores that a server is pinned to and told that it has; a lane is that many and three for the client, rounded up to a multiple of four")
    parser.add_argument("--rate", type=float, default=0, metavar="PART", help="behind the closed loop, an open loop: every column is sent requests at this part of what the slowest column of the job served; 0: none")
    parser.add_argument("--starts", type=int, default=3)
    parser.add_argument("--layouts", type=int, default=0, metavar="K", help="build every --aot column K times, as NAME.1 to NAME.K, each with a different code layout; see layouts.py")
    parser.add_argument("--first-responses", type=int, default=3)
    parser.add_argument("--warm-up", type=int, default=200000, help="requests; a JIT build needs 200,000, an --aot build is stable from the first window")
    parser.add_argument("--rounds", type=int, default=3)
    parser.add_argument("--max-rounds", type=int, default=6)
    parser.add_argument("--window-seconds", type=float, default=1.5)
    parser.add_argument("--connections", type=int, default=64)
    parser.add_argument("--alive-requests", type=int, default=60000, help="requests of the one start more that reads what is alive after full collections; 0: no such start")
    parser.add_argument("--events", default="", help="more hardware events by perf's names, separated by commas: counted with instructions and cycles, per request, in every start's entry; at most four, or perf takes turns")
    parser.add_argument("--soak", type=int, default=0, metavar="REQUESTS", help="soak mode: one process per server and column serves this many requests over all routes")
    parser.add_argument("--layers", action="store_true", help="layers mode: cycles and instructions per request by the layer that owns the code")
    options = parser.parse_args()
    options.events = [event for event in options.events.split(",") if event]

    options.columns = []
    for text in options.column:
        name, _, rest = text.partition("=")
        rest, _, route = rest.partition("#")
        before, _, server = rest.rpartition("@")
        rest, server = (before, server) if server in SERVERS or server in EFFECT or server in API_SERVERS or "*" in server else (rest, "")
        bun, _, flags = rest.partition(":")
        options.columns.append({"name": name, "bun": os.path.abspath(bun), "flags": flags.split(), "server": server, "route": route, "run_env": {}, "build_env": {}, "build_seconds": {}})
    for kind, values in (("run_env", options.run_env), ("build_env", options.build_env)):
        for text in values:
            name, _, pair = text.partition(":")
            next(column for column in options.columns if column["name"] == name)[kind].update([pair.split("=", 1)])
    if options.layouts:
        options.columns = [
            copy
            for column in options.columns
            for copy in ([with_layout_seed(column, seed) for seed in range(1, options.layouts + 1)] if "--aot" in column["flags"] else [column])
        ]
    for column in options.columns if options.layers else []:
        if "--aot" in column["flags"]:
            column["run_env"].setdefault("BUN_JSC_useAOTPerfMap", "1")
            column["write_map"] = True
        if b".symtab" not in subprocess.run(["readelf", "-S", "-W", column["bun"]], capture_output=True).stdout:
            column["kind"] = "stripped"
    cores = parse_core_range(options.cores)
    if len(cores) % ((options.server_cores + 6) // 4 * 4):
        sys.exit("--cores must be a multiple of a lane: %d cores" % ((options.server_cores + 6) // 4 * 4))

    temporary = None if options.work else tempfile.mkdtemp(prefix="aot-servers-")
    options.work = os.path.abspath(options.work or temporary)
    os.makedirs(os.path.join(options.work, "bin"), exist_ok=True)
    build_env = dict(os.environ, NO_COLOR="1", BUN_ENABLE_CRASH_REPORTING="0", DO_NOT_TRACK="1")
    servers = options.servers.split(",")
    installer = next(column["bun"] for column in options.columns if column["flags"] != ["run"])
    folders = {}
    for name in ("app", "tanstack"):
        if not any((server == "tanstack") == (name == "tanstack") for server in servers if server not in NATIVE and server not in EFFECT):
            continue
        folders[name] = os.path.join(options.work, name)
        shutil.rmtree(folders[name], ignore_errors=True)
        shutil.copytree(os.path.join(HERE, "..", name), folders[name])
        if options.modules:
            os.symlink(os.path.abspath(options.modules), os.path.join(folders[name], "node_modules"))
        else:
            run_checked([installer, "install", "--ignore-scripts"], cwd=folders[name], env=build_env)
    if any(server in EFFECT for server in servers):
        folders["effect"], folders["effect-sources"] = os.path.join(options.work, "effect"), os.path.join(options.work, "effect-sources")
        shutil.rmtree(folders["effect"], ignore_errors=True)
        shutil.rmtree(folders["effect-sources"], ignore_errors=True)
        shutil.copytree(os.path.join(HERE, "..", "effect"), folders["effect"], ignore=shutil.ignore_patterns("node_modules"))
        if options.effect_modules:
            shutil.copytree(os.path.abspath(options.effect_modules), os.path.join(folders["effect"], "node_modules"), symlinks=True)
        else:
            run_checked([installer, "install", "--ignore-scripts"], cwd=folders["effect"], env=build_env)
        shutil.copytree(folders["effect"], folders["effect-sources"], symlinks=True)
        run_checked([installer, "./resolve-to-sources.ts"], cwd=folders["effect-sources"], env=build_env)
    if "tanstack" in folders:
        shutil.copy(os.path.join(HERE, "..", "app", "shared.ts"), os.path.join(folders["tanstack"], "src", "utils", "shared.ts"))
        run_checked([installer, "node_modules/vite/bin/vite.js", "build"], cwd=folders["tanstack"], env=build_env)
    spec = json.loads(run_checked([installer, os.path.join(HERE, "..", "answers.ts")], env=build_env))
    run_checked(["cc", "-O2", "-pthread", "-o", os.path.join(options.work, "bin", "load"), os.path.join(HERE, "load.c")])

    for server in servers:
        if server in NATIVE:
            executable = os.path.join(options.work, "bin", server + "-native")
            target = os.path.join(options.work, "rust-target")
            source = os.path.join(options.work, server)
            shutil.rmtree(source, ignore_errors=True)
            shutil.copytree(os.path.join(HERE, "..", server), source)
            run_checked(NATIVE[server] + ([executable, "."] if server == "go" else []), cwd=source, env=dict(os.environ, CARGO_TARGET_DIR=target))
            if server == "rust":
                shutil.copy(os.path.join(target, "release", "servers"), executable)
            continue
        # The bundler inlines process.env.NODE_ENV and defaults it to "development".
        for column in options.columns:
            program = program_of(column, server)
            folder = folders["tanstack" if program == "tanstack" else "effect-sources" if program == "effect-sources" else "effect" if program in EFFECT else "app"]
            entry = "./serve.ts" if program == "tanstack" else EFFECT.get(program, "./%s.ts" % program)
            executable = os.path.join(options.work, "bin", "%s-%s" % (program, column["name"]))
            if column["flags"] == ["run"]:
                if program in EFFECT and os.path.basename(column["bun"]).startswith("node"):
                    entry = "./node.ts"
                with open(executable, "w") as script:
                    script.write("#!/bin/sh\nexec %s %s\n" % (column["bun"], os.path.join(folder, entry)))
                os.chmod(executable, 0o755)
                continue
            image_map = {"BUN_JSC_aotMapFilePath": executable + ".map"} if column.get("write_map") else {}
            start_time = time.perf_counter()
            run_checked([column["bun"], "build", "--compile", *column["flags"], "--target=bun", "--define", 'process.env.NODE_ENV="production"', entry, "--outfile", executable], cwd=folder, env=dict(build_env, **image_map, **column["build_env"]))
            column["build_seconds"][program] = round(time.perf_counter() - start_time, 2)

    if options.lock and options.lock.startswith("!"):
        holder = subprocess.Popen(["bash", "-c", options.lock[1:] + " && echo held && while kill -0 %d 2> /dev/null; do sleep 1; done" % os.getpid()], stdout=subprocess.PIPE, text=True)
        if holder.stdout.readline() != "held\n":
            sys.exit("--lock: the locks were not taken")
        print("locked %s" % options.lock, flush=True)
    elif options.lock:
        # With several files, none is held for long while another is waited for: whoever needs only that one is not kept out by a waiter.
        locks = [open(path, "a") for path in options.lock.split(",")]
        while True:
            fcntl.flock(locks[0], fcntl.LOCK_EX)
            deadline, waiting = time.monotonic() + 10, locks[1:]
            while waiting and time.monotonic() < deadline:
                try:
                    fcntl.flock(waiting[0], fcntl.LOCK_EX | fcntl.LOCK_NB)
                    waiting = waiting[1:]
                except BlockingIOError:
                    time.sleep(0.2)
            if not waiting:
                break
            for lock in locks:
                fcntl.flock(lock, fcntl.LOCK_UN)
            time.sleep(1)
        print("locked %s" % options.lock, flush=True)
    jobs, results_queue = multiprocessing.Queue(), multiprocessing.Queue()
    count = 0
    for server in servers:
        routes = [
            route
            for route in (spec["effectRoutes"] if server in EFFECT else spec["apiRoutes"] if server in API_SERVERS else spec["routes"]) + (PAGES if server == "tanstack" and not options.soak else []) + [refused for refused in spec["refusedRoutes"] if refused["name"] in options.routes.split(",") and server not in EFFECT and server not in API_SERVERS]
            if (not options.routes or route["name"] in options.routes.split(",")) and (server not in NATIVE or route["name"] in NATIVE_ROUTES)
        ]
        for job in [routes] if options.soak else routes:
            jobs.put((server, job))
            count += 1
    lanes = [multiprocessing.Process(target=run_lane, args=(options, spec, first, jobs, results_queue)) for first in cores[::(options.server_cores + 6) // 4 * 4]]
    for lane in lanes:
        jobs.put(None)
        lane.start()
    failed = 0
    with open(options.out, "a") as out:
        for _ in range(count):
            for line in results_queue.get():
                failed += bool(line["failures"])
                out.write(json.dumps(line) + "\n")
            out.flush()
    for lane in lanes:
        lane.join()
    if temporary:
        shutil.rmtree(temporary, ignore_errors=True)
    sys.exit("%d rows have failures" % failed if failed else 0)


if __name__ == "__main__":
    main()
