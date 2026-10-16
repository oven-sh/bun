#!/usr/bin/env python3
"""Measures the servers under ../app and ../tanstack after warm-up, in several builds side by side. Linux only; needs `perf`, `taskset` and `cc`.

    python3 measure.py --column aot=/path/to/bun:--aot --column released=/path/to/released/bun --out rows.jsonl
    python3 compare.py rows.jsonl aot released

Two builds of Bun on the small routes of one server, in about four minutes:

    python3 measure.py --column new=/path/to/new/bun:--aot --column previous=/path/to/previous/bun:--aot --servers tanstack \
        --routes text,json,params,post,async --warm-up 50000 --cores 0-15 --out rows.jsonl

A column is a name, the Bun that builds the executable with `bun build --compile`, and more flags for that build.
`--run-env aot:NAME=value` adds a variable to the environment of one column's servers.

A job is one server and one route. Jobs are dealt to lanes. A lane is four cores in a row: the server is pinned to the first,
the client (load.c) to the other three.

One executable started several times differs by up to 4% in cycles per request on the small routes, while each process is
steady within 1%: it depends on where its pages happen to be placed. A column that is a single process therefore cannot show a
change below 5%. So every job is measured `--starts` times, each time with a fresh process of every column:

  1. Each column is started and asked until the first right answer (the time to the first response is the median of
     `--first-responses` starts). Memory at ready is read. On the routes that take an order, the bad orders of ../answers.ts are sent.
  2. It is warmed with at least `--warm-up` requests, until the instructions per request of the last three windows are within
     2% of each other, and then stopped with SIGSTOP.
  3. `--rounds` times, each column in turn is continued, loaded for one window and stopped again, so that all columns are
     read seconds apart. A round more than 10% below the best round of the same process was disturbed and is left out.
     Rounds are added, up to `--most-rounds`, until every column has three rounds within 3% of its best.

The order of the columns rotates from start to start. Every response is compared with the right answer, byte for byte.
`--servers go,rust` measures ../go (net/http) and ../rust (axum), which answer six of the routes, for comparison. They are built
with `go build` and `cargo build --release` and have one column, "native".
TanStack Start has two routes more, the pages / ("static") and /items ("list"). What is right for a page is what the first
process answered, less the times in it; under load only the length of a page is compared.
A window runs under `perf stat -p <pid>`, which counts all threads of the server. Hardware counters are saved and restored at
every switch between threads, which costs a server about 1% and one whose threads hand work to each other at every request far
more. So a round is two windows: requests per second and CPU time come from one under `-e task-clock` alone, instructions and
cycles from one under `-e instructions:u,cycles:u,task-clock` right after it.

Each line of the output is one server, route and column: the median over the starts of each start's median over its rounds, and
under "starts" the value of every start. Start i of one column and start i of another were measured in turn, so compare.py
counts in how many of those pairs one column beat the other.

`--soak 5000000` looks for what changes with time instead: memory that keeps growing, and requests that get dearer. One process
per server and column serves that many requests, all routes in turn, and its line has the resident and the private memory after
every twentieth of them and the instructions per request of every twentieth. A cost that comes with the number of full
collections shows a hundred times sooner with `--run-env aot:BUN_JSC_useGenerationalGC=0`, which makes every collection a full one.

    requests_per_second, instructions, cycles, cpu_us       per request; instructions and cycles in user mode
    counted_requests_per_second                             what the server served while the hardware counters ran
    first_response_ms, ready_rss_mb                         from the start of the process to the first right answer
    peak_rss_mb                                             VmHWM at the end
    private_mb                                              Anonymous less LazyFree in smaps_rollup, the highest of samples 50 ms apart
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


class Failed(Exception):
    pass


def cores_in(text):
    first, _, last = text.partition("-")
    return list(range(int(first), int(last or first) + 1))


def ask(port, route, body="the route's own"):
    """One request on a connection of its own. Returns the status, the media type and the body."""
    if body == "the route's own":
        body = route.get("request")
    head = "%s %s HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nConnection: close\r\n" % (route["method"], route["path"], port)
    data = b"" if body is None else body.encode()
    if body is not None:
        head += "Content-Type: application/json\r\nContent-Length: %d\r\n" % len(data)
    with socket.create_connection(("127.0.0.1", port), timeout=10) as connection:
        connection.sendall(head.encode() + b"\r\n" + data)
        answer = b""
        while chunk := connection.recv(65536):
            answer += chunk
    head, rest = answer.split(b"\r\n\r\n", 1)
    lines = head.decode("latin-1").split("\r\n")
    fields = {line.split(":", 1)[0].lower(): line.split(":", 1)[1].strip() for line in lines[1:]}
    if fields.get("transfer-encoding", "").lower() == "chunked":
        whole = b""
        while rest:
            size, rest = rest.split(b"\r\n", 1)
            size = int(size.split(b";")[0], 16)
            if size == 0:
                break
            whole, rest = whole + rest[:size], rest[size + 2:]
        rest = whole
    return int(lines[0].split()[1]), fields.get("content-type", "").split(";")[0].strip().lower(), rest


def without_times(body):
    return re.sub(rb"\b\d{13}\b", b"<time>", body)


def private_mb(pid):
    try:
        text = open("/proc/%d/smaps_rollup" % pid).read()
    except OSError:
        return 0.0
    kb = {name: int(value) for name, value in re.findall(r"^(\w+):\s+(\d+) kB", text, re.M)}
    return (kb.get("Anonymous", 0) - kb.get("LazyFree", 0)) / 1024


def status_mb(pid, name):
    return int(re.search(r"^%s:\s+(\d+)" % name, open("/proc/%d/status" % pid).read(), re.M).group(1)) / 1024


class Server:
    def __init__(self, options, lane, answers, server, route, column):
        self.options, self.lane, self.answers, self.route, self.column = options, lane, answers, route, column
        self.name = "%s/%s/%s" % (server, route["name"], column["name"])
        self.executable = os.path.join(options.work, "bin", "%s-%s" % (server, column["name"]))
        self.folder = os.path.join(options.work, "lane-%d" % lane["server"], column["name"])
        os.makedirs(self.folder, exist_ok=True)
        self.cwd = os.path.join(options.work, "tanstack") if server == "tanstack" else self.folder
        self.process, self.rounds, self.highest_private = None, [], 0.0

    def end(self):
        if self.process and self.process.poll() is None:
            self.process.kill()
            self.process.wait()

    def stop(self):
        self.process.send_signal(signal.SIGSTOP)

    def resume(self):
        self.process.send_signal(signal.SIGCONT)

    def log(self):
        return open(os.path.join(self.folder, "server.log"), "rb").read()[-300:].decode("latin-1").replace("\n", " | ")

    def start(self):
        env = dict(os.environ, NODE_ENV="production", BUN_ENABLE_CRASH_REPORTING="0", DO_NOT_TRACK="1", WTF_numberOfProcessorCores="1")
        env.update(self.column["run_env"])
        firsts = []
        for _ in range(self.options.first_responses):
            self.end()
            self.lane["spawned"] += 1
            self.port = 20000 + self.lane["server"] * 64 + self.lane["spawned"] % 64
            env["PORT"] = str(self.port)
            log = open(os.path.join(self.folder, "server.log"), "wb")
            began = time.perf_counter()
            self.process = subprocess.Popen(["taskset", "-c", str(self.lane["server"]), self.executable], env=env, cwd=self.cwd, stdin=subprocess.DEVNULL, stdout=log, stderr=log)
            answer = None
            while time.perf_counter() - began < 30 and self.process.poll() is None:
                try:
                    answer = ask(self.port, self.route)
                    break
                except (OSError, ValueError, IndexError):
                    time.sleep(0.0005)
            if answer is None:
                raise Failed("no answer: " + self.log())
            firsts.append((time.perf_counter() - began) * 1e3)
            if "answer" not in self.route and answer[0] == 200:
                self.route["answer"] = without_times(answer[2]).decode()
            if (answer[0], answer[1], without_times(answer[2])) != (200, self.route["type"], self.route["answer"].encode()):
                raise Failed("a wrong answer: %d %s %r" % (answer[0], answer[1], answer[2][:80]))
        self.first_response_ms = statistics.median(firsts)
        self.ready_rss_mb = status_mb(self.process.pid, "VmRSS")
        self.bad_orders = {}
        if self.route["method"] == "POST":
            for what, body in self.answers["badOrders"].items():
                self.bad_orders[what] = ask(self.port, self.route, body)[0]
                # To encoding/json and to serde, a member that is null is an optional member that is absent.
                if self.route["name"] in VALIDATING and self.bad_orders[what] != 400 and not (self.column is NATIVE_COLUMN and "null" in what):
                    raise Failed("%s is answered with %d" % (what, self.bad_orders[what]))
        self.exchange = self.exchange_files(self.route, answer[2])

    def exchange_files(self, route, answer):
        """Writes what load.c sends and what it expects for one route, and returns the two paths."""
        request = "%s %s HTTP/1.1\r\nHost: 127.0.0.1:%d\r\n" % (route["method"], route["path"], self.port)
        body = route.get("request", "").encode()
        if body:
            request += "Content-Type: application/json\r\nContent-Length: %d\r\n" % len(body)
        paths = [os.path.join(self.folder, "request-" + route["name"]), os.path.join(self.folder, "expected-" + route["name"])]
        open(paths[0], "wb").write(request.encode() + b"\r\n" + body)
        compared = "exact" if without_times(answer) == answer else "length"
        open(paths[1], "wb").write(("200\n%s\n%s\n" % (route["type"], compared)).encode() + answer)
        return paths

    def window(self, requests, counters=True):
        """Loads the server with a fixed number of requests and returns what one request took."""
        pid, report, done = self.process.pid, os.path.join(self.folder, "perf.csv"), threading.Event()

        def sample():
            while not done.wait(0.05):
                self.highest_private = max(self.highest_private, private_mb(pid))

        sampler = threading.Thread(target=sample, daemon=True)
        sampler.start()
        client = ["taskset", "-c", self.lane["client"], os.path.join(self.options.work, "bin", "load"), str(self.port), str(self.options.connections), str(requests), "3"]
        try:
            # perf lists the threads and then opens a counter on each. A thread that ends in between fails the whole call.
            for _ in range(4):
                run = subprocess.run(["perf", "stat", "-x,", "-o", report, "-e", "instructions:u,cycles:u,task-clock" if counters else "task-clock", "-p", str(pid), "--"] + client + self.exchange, capture_output=True, text=True)
                if "sys_perf_event_open" not in run.stderr:
                    break
        finally:
            done.set()
            sampler.join()
        if self.process.poll() is not None:
            raise Failed("the server ended with exit code %s: %s" % (self.process.returncode, self.log()))
        words = run.stdout.split()
        printed = dict(zip(words[0::2], words[1::2]))
        if run.returncode != 0 or printed.get("requests") != str(requests):
            raise Failed("the client: " + (run.stderr or run.stdout)[-200:].replace("\n", " "))
        counted = {}
        for line in open(report):
            fields = line.strip().split(",")
            if len(fields) > 4 and fields[0].replace(".", "").isdigit():
                counted[fields[2].split(":")[0]] = float(fields[0])
        if len(counted) < (3 if counters else 1):
            raise Failed("perf: " + open(report).read()[-160:].replace("\n", " "))
        return {
            "requests": requests,
            "requests_per_second": requests / float(printed["seconds"]),
            "instructions": counted.get("instructions", 0) / requests,
            "cycles": counted.get("cycles", 0) / requests,
            "cpu_us": counted["task-clock"] * 1e3 / requests,
        }

    def warm(self):
        began, total, size, windows = time.perf_counter(), 0, 2000, []
        while True:
            windows.append(self.window(size))
            total += size
            size = 8000 if len(windows) == 1 else int(min(100000, max(10000, round(windows[-1]["requests_per_second"] * 1.5, -4))))
            last = [window["instructions"] for window in windows[-3:]]
            self.settled = total >= self.options.warm_up and len(windows) >= 5 and (max(last) - min(last)) * 100 <= 2 * min(last)
            if self.settled or (total >= self.options.warm_up and time.perf_counter() - began > 45) or time.perf_counter() - began > 270:
                break
        self.window_size = int(min(100000, max(5000, round(windows[-1]["requests_per_second"] * self.options.window_seconds, -3))))

    def round(self):
        timed = self.window(self.window_size, counters=False)
        counted = self.window(self.window_size)
        return dict(timed, instructions=counted["instructions"], cycles=counted["cycles"], counted_requests_per_second=counted["requests_per_second"])

    def is_confirmed(self):
        best = max(each["requests_per_second"] for each in self.rounds)
        return sum(1 for each in self.rounds if each["requests_per_second"] >= 0.97 * best) >= min(3, self.options.rounds)

    def result(self):
        if without_times(ask(self.port, self.route)[2]) != self.route["answer"].encode():
            raise Failed("a wrong answer at the end")
        peak = status_mb(self.process.pid, "VmHWM")
        self.end()
        best = max(each["requests_per_second"] for each in self.rounds)
        kept = [each for each in self.rounds if each["requests_per_second"] >= 0.9 * best]
        result = {name: statistics.median(each[name] for each in kept) for name in ("requests_per_second", "counted_requests_per_second", "instructions", "cycles", "cpu_us")}
        result.update(first_response_ms=self.first_response_ms, ready_rss_mb=self.ready_rss_mb, peak_rss_mb=peak, private_mb=self.highest_private)
        result.update(settled=self.settled, confirmed=self.is_confirmed(), rounds=len(self.rounds), rounds_kept=len(kept), bad_orders=self.bad_orders)
        return result


def measure_job(options, lane, answers, server, route):
    """Returns one line of output per column."""
    columns = [NATIVE_COLUMN] if server in NATIVE else options.columns
    results = {column["name"]: {} for column in columns}
    failures = {}

    def guarded(each, step):
        try:
            step()
            return True
        except Exception as error:
            each.end()
            failures.setdefault(each.column["name"], []).append(str(error) if isinstance(error, Failed) else repr(error))
            print("%-32s FAILED: %s" % (each.name, str(error)[:200]), flush=True)
            return False

    for start in range(options.starts):
        turn = start % len(columns)
        running = []
        for column in columns[turn:] + columns[:turn]:
            each = Server(options, lane, answers, server, route, column)
            if guarded(each, each.start) and guarded(each, each.warm):
                each.stop()
                running.append(each)
        for n in range(max(options.rounds, options.most_rounds)):
            if n >= options.rounds and all(each.is_confirmed() for each in running):
                break
            for each in list(running):
                each.resume()
                if guarded(each, lambda: each.rounds.append(each.round())):
                    each.stop()
                else:
                    running.remove(each)
        for each in running:
            each.resume()
            guarded(each, lambda: results[each.column["name"]].__setitem__(start, each.result()))
    lines = []
    for column in columns:
        starts = results[column["name"]]
        line = {"server": server, "route": route["name"], "column": column["name"], "failures": failures.get(column["name"], [])}
        if starts:
            line.update({name: statistics.median(each[name] for each in starts.values()) for name in PER_START})
            line["starts"] = {str(start): {name: round(each[name], 2) for name in PER_START} for start, each in starts.items()}
            line["settled"] = all(each["settled"] for each in starts.values())
            line["confirmed"] = all(each["confirmed"] for each in starts.values())
            line["bad_orders"] = next(iter(starts.values()))["bad_orders"]
            line["executable_mb"] = os.path.getsize(os.path.join(options.work, "bin", "%s-%s" % (server, column["name"]))) / 1e6
            print("%-32s %8.0f/s | %9.0f instructions %9.0f cycles %7.2f us CPU | peak RSS %6.1f private %6.1f ready %5.1f MB | first %6.1f ms | %d starts" % (
                "%s/%s/%s" % (server, route["name"], column["name"]), line["requests_per_second"], line["instructions"], line["cycles"], line["cpu_us"],
                line["peak_rss_mb"], line["private_mb"], line["ready_rss_mb"], line["first_response_ms"], len(starts)), flush=True)
        lines.append(line)
    return lines


def soak_job(options, lane, answers, server, routes):
    """One process per column serves all the routes in turn for a long time. Returns its memory after every twentieth of it and what a request took in each."""
    lines = []
    for column in [NATIVE_COLUMN] if server in NATIVE else options.columns:
        each = Server(options, lane, answers, server, routes[0], column)
        line = {"server": server, "route": "soak", "column": column["name"], "failures": [], "requests": [], "rss_mb": [], "private_mb": [], "instructions": []}
        try:
            each.start()
            each.exchange = [path for route in routes for path in each.exchange_files(route, route["answer"].encode())]
            for n in range(20):
                line["instructions"].append(round(each.window(options.soak // 20)["instructions"]))
                line["requests"].append((n + 1) * (options.soak // 20))
                line["rss_mb"].append(round(status_mb(each.process.pid, "VmRSS"), 1))
                line["private_mb"].append(round(private_mb(each.process.pid), 1))
        except Exception as error:
            line["failures"].append(str(error) if isinstance(error, Failed) else repr(error))
        each.end()
        print("%-24s RSS, MB: %s | instructions: %s%s" % ("%s/%s" % (server, column["name"]), " ".join("%.0f" % mb for mb in line["rss_mb"]), " ".join("%d" % count for count in line["instructions"]), " FAILED: " + line["failures"][0][:160] if line["failures"] else ""), flush=True)
        lines.append(line)
    return lines


def run_lane(options, answers, first_core, jobs, finished):
    os.sched_setaffinity(0, set(range(first_core + 1, first_core + 4)))
    lane = {"server": first_core, "client": "%d-%d" % (first_core + 1, first_core + 3), "spawned": 0}
    while True:
        job = jobs.get()
        if job is None:
            return
        finished.put((soak_job if options.soak else measure_job)(options, lane, answers, *job))


def checked(command, **more):
    run = subprocess.run(command, capture_output=True, text=True, **more)
    if run.returncode != 0:
        sys.exit("%s failed:\n%s" % (" ".join(command), (run.stderr or run.stdout)[-2000:]))
    return run.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--column", action="append", required=True, metavar="NAME=BUN[:FLAGS]")
    parser.add_argument("--run-env", action="append", default=[], metavar="COLUMN:NAME=VALUE")
    parser.add_argument("--build-env", action="append", default=[], metavar="COLUMN:NAME=VALUE")
    parser.add_argument("--out", required=True, help="lines are appended")
    parser.add_argument("--servers", default=",".join(SERVERS))
    parser.add_argument("--routes", default="", help="names from ../answers.ts, static, list; all by default")
    parser.add_argument("--cores", default="0-3", help="cores in a row, a multiple of four: one lane for every four")
    parser.add_argument("--modules", help="a node_modules folder that has the packages of ../app/package.json and ../tanstack/package.json; nothing is downloaded")
    parser.add_argument("--work", help="a folder for the executables and logs; a temporary one by default")
    parser.add_argument("--starts", type=int, default=3)
    parser.add_argument("--first-responses", type=int, default=3)
    parser.add_argument("--warm-up", type=int, default=200000, help="requests; a JIT needs 200,000, an --aot executable is flat from the first window")
    parser.add_argument("--rounds", type=int, default=3)
    parser.add_argument("--most-rounds", type=int, default=6)
    parser.add_argument("--window-seconds", type=float, default=1.5)
    parser.add_argument("--connections", type=int, default=64)
    parser.add_argument("--soak", type=int, default=0, metavar="REQUESTS", help="instead: one process per server and column serves this many requests, all routes in turn")
    options = parser.parse_args()

    options.columns = []
    for text in options.column:
        name, _, rest = text.partition("=")
        bun, _, flags = rest.partition(":")
        options.columns.append({"name": name, "bun": os.path.abspath(bun), "flags": flags.split(), "run_env": {}, "build_env": {}})
    for kind, given in (("run_env", options.run_env), ("build_env", options.build_env)):
        for text in given:
            name, _, pair = text.partition(":")
            next(column for column in options.columns if column["name"] == name)[kind].update([pair.split("=", 1)])
    cores = cores_in(options.cores)
    if len(cores) % 4:
        sys.exit("--cores: a multiple of four")

    temporary = None if options.work else tempfile.mkdtemp(prefix="aot-servers-")
    options.work = os.path.abspath(options.work or temporary)
    os.makedirs(os.path.join(options.work, "bin"), exist_ok=True)
    quiet = dict(os.environ, NO_COLOR="1", BUN_ENABLE_CRASH_REPORTING="0", DO_NOT_TRACK="1")
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
            checked([options.columns[0]["bun"], "install", "--ignore-scripts"], cwd=folders[name], env=quiet)
    if "tanstack" in folders:
        shutil.copy(os.path.join(HERE, "..", "app", "shared.ts"), os.path.join(folders["tanstack"], "src", "utils", "shared.ts"))
        checked([options.columns[0]["bun"], "node_modules/vite/bin/vite.js", "build"], cwd=folders["tanstack"], env=quiet)
    answers = json.loads(checked([options.columns[0]["bun"], os.path.join(HERE, "..", "answers.ts")], env=quiet))
    checked(["cc", "-O2", "-pthread", "-o", os.path.join(options.work, "bin", "load"), os.path.join(HERE, "load.c")])

    for server in servers:
        if server in NATIVE:
            executable = os.path.join(options.work, "bin", server + "-native")
            target = os.path.join(options.work, "rust-target")
            source = os.path.join(options.work, server)
            shutil.rmtree(source, ignore_errors=True)
            shutil.copytree(os.path.join(HERE, "..", server), source)
            checked(NATIVE[server] + ([executable, "."] if server == "go" else []), cwd=source, env=dict(os.environ, CARGO_TARGET_DIR=target))
            if server == "rust":
                shutil.copy(os.path.join(target, "release", "servers"), executable)
            continue
        # Without the definition the bundler replaces process.env.NODE_ENV with "development".
        entry = ["--define", 'process.env.NODE_ENV="production"', "./serve.ts" if server == "tanstack" else "./%s.ts" % server]
        for column in options.columns:
            executable = os.path.join(options.work, "bin", "%s-%s" % (server, column["name"]))
            checked([column["bun"], "build", "--compile", *column["flags"], "--target=bun", *entry, "--outfile", executable], cwd=folders["tanstack" if server == "tanstack" else "app"], env=dict(quiet, **column["build_env"]))

    jobs, finished = multiprocessing.Queue(), multiprocessing.Queue()
    count = 0
    for server in servers:
        routes = [
            route
            for route in answers["routes"] + (PAGES if server == "tanstack" and not options.soak else [])
            if (not options.routes or route["name"] in options.routes.split(",")) and (server not in NATIVE or route["name"] in NATIVE_ROUTES)
        ]
        for job in [routes] if options.soak else routes:
            jobs.put((server, job))
            count += 1
    lanes = [multiprocessing.Process(target=run_lane, args=(options, answers, first, jobs, finished)) for first in cores[::4]]
    for lane in lanes:
        jobs.put(None)
        lane.start()
    failed = 0
    with open(options.out, "a") as out:
        for _ in range(count):
            for line in finished.get():
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
