#!/usr/bin/env python3
"""Load-tests the servers in ../app and ../tanstack, comparing several builds side by side. Linux only; needs `perf`, `taskset` and `cc`.

    python3 measure.py --column aot=/path/to/bun:--aot --column released=/path/to/released/bun --out rows.jsonl
    python3 compare.py rows.jsonl aot released

Two builds of Bun on the small routes of one server, in about four minutes:

    python3 measure.py --column new=/path/to/new/bun:--aot --column previous=/path/to/previous/bun:--aot --servers tanstack \
        --routes text,json,params,post,async --warm-up 50000 --cores 0-15 --out rows.jsonl

A column is a name, the Bun that builds the executable with `bun build --compile`, and extra flags for that build.
`--run-env aot:NAME=value` sets an environment variable for the servers of one column.

A job is one server and one route. Jobs are distributed over lanes. A lane is four consecutive cores: the server is pinned to
the first one and the client (load.c) to the other three. Servers are told they have one core (WTF_numberOfProcessorCores=1).

Different runs of the same executable differ by up to 4% in cycles per request on the small routes, while a single process is
stable within 1%: it depends on where its pages end up. One process per column therefore cannot resolve a change below 5%, so
every job is measured `--starts` times, each time with a fresh process for every column:

  1. Each column is started and polled until the first correct response (time to first response is the median of
     `--first-responses` starts). RSS is read at that point. On the POST routes the invalid orders from ../answers.ts are sent.
  2. It is warmed up with at least `--warm-up` requests, until instructions per request of the last three windows are within 2%
     of each other, and then paused with SIGSTOP.
  3. For `--rounds` rounds, each column in turn is resumed, loaded and paused again, so all columns are measured seconds apart.
     A round more than 10% below the best round of the same process is treated as disturbed and dropped. Rounds are added, up
     to `--max-rounds`, until every column has three rounds within 3% of its best.

The column order rotates from start to start. Every response is compared with the expected one, byte for byte.
`--servers go,rust` measures ../go (net/http) and ../rust (axum), which implement six of the routes, for comparison. They are
built with `go build` and `cargo build --release` and have a single column, "native".
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

    requests_per_second, instructions, cycles, cpu_us       per request; instructions and cycles in user mode
    counted_requests_per_second                             throughput while the hardware counters were running
    first_response_ms, ready_rss_mb                         from process start to the first correct response
    peak_rss_mb                                             VmHWM at the end
    private_mb                                              Anonymous minus LazyFree in smaps_rollup, the maximum of samples 50 ms apart
"""
import argparse, json, multiprocessing, os, re, resource, shutil, signal, socket, statistics, subprocess, sys, tempfile, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
SERVERS = ["bun", "hono", "elysia", "node", "express", "fastify", "tanstack"]
PAGES = [{"name": "static", "method": "GET", "path": "/", "type": "text/html"}, {"name": "list", "method": "GET", "path": "/items", "type": "text/html"}]
VALIDATING = ("post", "hand")
NATIVE = {"go": ["go", "build", "-o"], "rust": ["cargo", "build", "--release"]}
NATIVE_ROUTES = ("text", "json", "params", "post", "async", "stream")
NATIVE_COLUMN = {"name": "native", "run_env": {}}
PER_START = ("requests_per_second", "counted_requests_per_second", "instructions", "cycles", "cpu_us", "first_response_ms", "ready_rss_mb", "peak_rss_mb", "private_mb")


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


def proc_status_mb(pid, name):
    return int(re.search(r"^%s:\s+(\d+)" % name, open("/proc/%d/status" % pid).read(), re.M).group(1)) / 1024


class Server:
    def __init__(self, options, lane, spec, server, route, column):
        self.options, self.lane, self.spec, self.route, self.column = options, lane, spec, route, column
        self.name = "%s/%s/%s" % (server, route["name"], column["name"])
        self.executable = os.path.join(options.work, "bin", "%s-%s" % (server, column["name"]))
        self.folder = os.path.join(options.work, "lane-%d" % lane["server"], column["name"])
        os.makedirs(self.folder, exist_ok=True)
        self.cwd = os.path.join(options.work, "tanstack") if server == "tanstack" else self.folder
        self.process, self.rounds, self.max_private_mb = None, [], 0.0

    def kill(self):
        if self.process and self.process.poll() is None:
            self.process.kill()
            self.process.wait()

    def pause(self):
        self.process.send_signal(signal.SIGSTOP)

    def resume(self):
        self.process.send_signal(signal.SIGCONT)

    def log_tail(self):
        return open(os.path.join(self.folder, "server.log"), "rb").read()[-300:].decode("latin-1").replace("\n", " | ")

    def start(self):
        env = dict(os.environ, NODE_ENV="production", BUN_ENABLE_CRASH_REPORTING="0", DO_NOT_TRACK="1", WTF_numberOfProcessorCores="1")
        env.update(self.column["run_env"])
        first_response_times = []
        for _ in range(self.options.first_responses):
            self.kill()
            self.lane["spawned"] += 1
            self.port = 20000 + self.lane["server"] * 64 + self.lane["spawned"] % 64
            env["PORT"] = str(self.port)
            log = open(os.path.join(self.folder, "server.log"), "wb")
            start_time = time.perf_counter()
            self.process = subprocess.Popen(["taskset", "-c", str(self.lane["server"]), self.executable], env=env, cwd=self.cwd, stdin=subprocess.DEVNULL, stdout=log, stderr=log)
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
            if (response[0], response[1], strip_timestamps(response[2])) != (200, self.route["type"], self.route["expectedBody"].encode()):
                raise MeasurementError("unexpected response: %d %s %r" % (response[0], response[1], response[2][:80]))
        self.first_response_ms = statistics.median(first_response_times)
        self.ready_rss_mb = proc_status_mb(self.process.pid, "VmRSS")
        self.invalid_order_statuses = {}
        if self.route["method"] == "POST":
            for description, body in self.spec["invalidOrders"].items():
                self.invalid_order_statuses[description] = send_request(self.port, self.route, body)[0]
                # encoding/json and serde treat a null optional field like a missing one.
                if self.route["name"] in VALIDATING and self.invalid_order_statuses[description] != 400 and not (self.column is NATIVE_COLUMN and "null" in description):
                    raise MeasurementError("%s: expected 400, got %d" % (description, self.invalid_order_statuses[description]))
        self.load_files = self.write_load_files(self.route, response[2])

    def write_load_files(self, route, expected_body):
        """Writes the request and expected-response files that load.c reads for one route. Returns the two paths."""
        request = "%s %s HTTP/1.1\r\nHost: 127.0.0.1:%d\r\n" % (route["method"], route["path"], self.port)
        body = route.get("request", "").encode()
        if body:
            request += "Content-Type: application/json\r\nContent-Length: %d\r\n" % len(body)
        paths = [os.path.join(self.folder, "request-" + route["name"]), os.path.join(self.folder, "expected-" + route["name"])]
        open(paths[0], "wb").write(request.encode() + b"\r\n" + body)
        comparison = "exact" if strip_timestamps(expected_body) == expected_body else "length"
        open(paths[1], "wb").write(("200\n%s\n%s\n" % (route["type"], comparison)).encode() + expected_body)
        return paths

    def run_window(self, requests, counters=True):
        """Sends a fixed number of requests and returns per-request costs."""
        pid, report, done = self.process.pid, os.path.join(self.folder, "perf.csv"), threading.Event()

        def sample():
            while not done.wait(0.05):
                self.max_private_mb = max(self.max_private_mb, private_mb(pid))

        sampler = threading.Thread(target=sample, daemon=True)
        sampler.start()
        client = ["taskset", "-c", self.lane["client"], os.path.join(self.options.work, "bin", "load"), str(self.port), str(self.options.connections), str(requests), "3"]
        try:
            # perf enumerates the threads and then opens a counter on each; a thread that exits in between fails the whole call.
            for _ in range(4):
                run = subprocess.run(["perf", "stat", "-x,", "-o", report, "-e", "instructions:u,cycles:u,task-clock" if counters else "task-clock", "-p", str(pid), "--"] + client + self.load_files, capture_output=True, text=True)
                if "sys_perf_event_open" not in run.stderr:
                    break
        finally:
            done.set()
            sampler.join()
        if self.process.poll() is not None:
            raise MeasurementError("the server exited with code %s: %s" % (self.process.returncode, self.log_tail()))
        words = run.stdout.split()
        printed = dict(zip(words[0::2], words[1::2]))
        if run.returncode != 0 or printed.get("requests") != str(requests):
            raise MeasurementError("the client: " + (run.stderr or run.stdout)[-200:].replace("\n", " "))
        counted = {}
        for line in open(report):
            fields = line.strip().split(",")
            if len(fields) > 4 and fields[0].replace(".", "").isdigit():
                counted[fields[2].split(":")[0]] = float(fields[0])
        if len(counted) < (3 if counters else 1):
            raise MeasurementError("perf: " + open(report).read()[-160:].replace("\n", " "))
        return {
            "requests": requests,
            "requests_per_second": requests / float(printed["seconds"]),
            "instructions": counted.get("instructions", 0) / requests,
            "cycles": counted.get("cycles", 0) / requests,
            "cpu_us": counted["task-clock"] * 1e3 / requests,
        }

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
        return dict(timed, instructions=counted["instructions"], cycles=counted["cycles"], counted_requests_per_second=counted["requests_per_second"])

    def is_stable(self):
        best = max(each["requests_per_second"] for each in self.rounds)
        return sum(1 for each in self.rounds if each["requests_per_second"] >= 0.97 * best) >= min(3, self.options.rounds)

    def result(self):
        if strip_timestamps(send_request(self.port, self.route)[2]) != self.route["expectedBody"].encode():
            raise MeasurementError("unexpected response after the last round")
        peak = proc_status_mb(self.process.pid, "VmHWM")
        self.kill()
        best = max(each["requests_per_second"] for each in self.rounds)
        valid_rounds = [each for each in self.rounds if each["requests_per_second"] >= 0.9 * best]
        result = {name: statistics.median(each[name] for each in valid_rounds) for name in ("requests_per_second", "counted_requests_per_second", "instructions", "cycles", "cpu_us")}
        result.update(first_response_ms=self.first_response_ms, ready_rss_mb=self.ready_rss_mb, peak_rss_mb=peak, private_mb=self.max_private_mb)
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
        for each in running:
            each.resume()
            run_step(each, lambda: results[each.column["name"]].__setitem__(start, each.result()))
    lines = []
    for column in columns:
        starts = results[column["name"]]
        line = {"server": server, "route": route["name"], "column": column["name"], "failures": failures.get(column["name"], [])}
        if starts:
            line.update({name: statistics.median(each[name] for each in starts.values()) for name in PER_START})
            line["starts"] = {str(start): {name: round(each[name], 2) for name in PER_START} for start, each in starts.items()}
            line["settled"] = all(each["settled"] for each in starts.values())
            line["stable"] = all(each["stable"] for each in starts.values())
            line["invalid_order_statuses"] = next(iter(starts.values()))["invalid_order_statuses"]
            line["executable_mb"] = os.path.getsize(os.path.join(options.work, "bin", "%s-%s" % (server, column["name"]))) / 1e6
            print("%-32s %8.0f/s | %9.0f instructions %9.0f cycles %7.2f us CPU | peak RSS %6.1f private %6.1f ready %5.1f MB | first %6.1f ms | %d starts" % (
                "%s/%s/%s" % (server, route["name"], column["name"]), line["requests_per_second"], line["instructions"], line["cycles"], line["cpu_us"],
                line["peak_rss_mb"], line["private_mb"], line["ready_rss_mb"], line["first_response_ms"], len(starts)), flush=True)
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


def run_lane(options, spec, first_core, jobs, results_queue):
    os.sched_setaffinity(0, set(range(first_core + 1, first_core + 4)))
    lane = {"server": first_core, "client": "%d-%d" % (first_core + 1, first_core + 3), "spawned": 0}
    while True:
        job = jobs.get()
        if job is None:
            return
        results_queue.put((soak_job if options.soak else measure_job)(options, lane, spec, *job))


def run_checked(command, **more):
    run = subprocess.run(command, capture_output=True, text=True, **more)
    if run.returncode != 0:
        sys.exit("%s failed:\n%s" % (" ".join(command), (run.stderr or run.stdout)[-2000:]))
    return run.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--column", action="append", required=True, metavar="NAME=BUN[:FLAGS]")
    parser.add_argument("--run-env", action="append", default=[], metavar="COLUMN:NAME=VALUE")
    parser.add_argument("--build-env", action="append", default=[], metavar="COLUMN:NAME=VALUE")
    parser.add_argument("--out", required=True, help="output file; lines are appended")
    parser.add_argument("--servers", default=",".join(SERVERS))
    parser.add_argument("--routes", default="", help="names from ../answers.ts, static, list; all by default")
    parser.add_argument("--cores", default="0-3", help="a range of consecutive cores, a multiple of four; every four cores form a lane")
    parser.add_argument("--modules", help="a node_modules folder with the packages from ../app/package.json and ../tanstack/package.json; skips `bun install`")
    parser.add_argument("--work", help="working directory for executables and logs; a temporary one by default")
    parser.add_argument("--starts", type=int, default=3)
    parser.add_argument("--first-responses", type=int, default=3)
    parser.add_argument("--warm-up", type=int, default=200000, help="requests; a JIT build needs 200,000, an --aot build is stable from the first window")
    parser.add_argument("--rounds", type=int, default=3)
    parser.add_argument("--max-rounds", type=int, default=6)
    parser.add_argument("--window-seconds", type=float, default=1.5)
    parser.add_argument("--connections", type=int, default=64)
    parser.add_argument("--soak", type=int, default=0, metavar="REQUESTS", help="soak mode: one process per server and column serves this many requests over all routes")
    options = parser.parse_args()

    options.columns = []
    for text in options.column:
        name, _, rest = text.partition("=")
        bun, _, flags = rest.partition(":")
        options.columns.append({"name": name, "bun": os.path.abspath(bun), "flags": flags.split(), "run_env": {}, "build_env": {}})
    for kind, values in (("run_env", options.run_env), ("build_env", options.build_env)):
        for text in values:
            name, _, pair = text.partition(":")
            next(column for column in options.columns if column["name"] == name)[kind].update([pair.split("=", 1)])
    cores = parse_core_range(options.cores)
    if len(cores) % 4:
        sys.exit("--cores must be a multiple of four cores")

    temporary = None if options.work else tempfile.mkdtemp(prefix="aot-servers-")
    options.work = os.path.abspath(options.work or temporary)
    os.makedirs(os.path.join(options.work, "bin"), exist_ok=True)
    build_env = dict(os.environ, NO_COLOR="1", BUN_ENABLE_CRASH_REPORTING="0", DO_NOT_TRACK="1")
    servers = options.servers.split(",")
    folders = {}
    for name in ("app", "tanstack"):
        if not any((server == "tanstack") == (name == "tanstack") for server in servers if server not in NATIVE):
            continue
        folders[name] = os.path.join(options.work, name)
        shutil.rmtree(folders[name], ignore_errors=True)
        shutil.copytree(os.path.join(HERE, "..", name), folders[name])
        if options.modules:
            os.symlink(os.path.abspath(options.modules), os.path.join(folders[name], "node_modules"))
        else:
            run_checked([options.columns[0]["bun"], "install", "--ignore-scripts"], cwd=folders[name], env=build_env)
    if "tanstack" in folders:
        shutil.copy(os.path.join(HERE, "..", "app", "shared.ts"), os.path.join(folders["tanstack"], "src", "utils", "shared.ts"))
        run_checked([options.columns[0]["bun"], "node_modules/vite/bin/vite.js", "build"], cwd=folders["tanstack"], env=build_env)
    spec = json.loads(run_checked([options.columns[0]["bun"], os.path.join(HERE, "..", "answers.ts")], env=build_env))
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
        entry = ["--define", 'process.env.NODE_ENV="production"', "./serve.ts" if server == "tanstack" else "./%s.ts" % server]
        for column in options.columns:
            executable = os.path.join(options.work, "bin", "%s-%s" % (server, column["name"]))
            run_checked([column["bun"], "build", "--compile", *column["flags"], "--target=bun", *entry, "--outfile", executable], cwd=folders["tanstack" if server == "tanstack" else "app"], env=dict(build_env, **column["build_env"]))

    jobs, results_queue = multiprocessing.Queue(), multiprocessing.Queue()
    count = 0
    for server in servers:
        routes = [
            route
            for route in spec["routes"] + (PAGES if server == "tanstack" and not options.soak else [])
            if (not options.routes or route["name"] in options.routes.split(",")) and (server not in NATIVE or route["name"] in NATIVE_ROUTES)
        ]
        for job in [routes] if options.soak else routes:
            jobs.put((server, job))
            count += 1
    lanes = [multiprocessing.Process(target=run_lane, args=(options, spec, first, jobs, results_queue)) for first in cores[::4]]
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
