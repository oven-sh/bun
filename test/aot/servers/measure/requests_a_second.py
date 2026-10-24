#!/usr/bin/env python3
"""Requests a second, from the start of a process to its millionth request. Linux only; needs `taskset` and `cc`. No hardware counters, nothing attached to the server.

    python3 requests_a_second.py --column aot=/path/to/bun:--aot --column jit=/path/to/bun --column released=/path/to/released/bun \\
        --servers bun,hono,elysia,node,express,fastify,koa --cores 0-19 --work /tmp/requests --out rows.jsonl
    python3 requests_a_second.py --table rows.jsonl

A column is a name, the Bun that builds the executable with `bun build --compile`, and the flags of that build, as in measure.py. Two more columns, `go` and `rust` (`--natives`), are
../go (net/http) and ../rust (axum): the same routes, built with `go build` and `cargo build --release`, one thread each (GOMAXPROCS=1, SERVER_THREADS=1).

All columns of a server run side by side, in the same seconds, each in a lane of its own: what else a machine does moves its clock rate and its memory's latency from one minute to the next, for
every core, and columns that run one after the other see different machines. A lane is `--server-cores` cores for the server, which is pinned to them and told how many it has, and `--client-cores`
for its client. `--cores` must hold a lane for every column. Cores that share a last-level cache with three busy lanes serve 3 to 5% less than cores that share it with one. So no lane is idle: what
is left over runs the first columns once more (`aot+`, `jit+` .. in the rows: the same executable twice, one more control). And the columns are dealt anew for every start: with eight lanes there
are seven starts, and any two columns are neighbors in three of them. A cell of a table is the median over the starts.

One start is one process and one run of load.c, which is knocking at the port before the server is started:

  1. As soon as the server listens, `--connections` connections are opened, and each has one request in flight from then on, a request of each route of `--routes` in turn, until the last of `--marks` is answered.
     The connections stay open and the load never pauses. Every response is compared with the expected one, byte for byte.
  2. load.c notes when every response was complete, counted from the moment the server was started, and reads the CPU time of all threads of the server
     (the kernel's clock for the process, clock_getcpuclockid) as the responses number 1,000, 10,000, 200,000 and 1,000,000 arrive (`--marks`; a server counts as warm between the last two).
  3. The same process, warm by now, is then sent requests at a fixed rate (`--rate`, an open loop) for `--rate-seconds`. A request's latency counts from the moment it was due.

So "the first second" has in it whatever the process does before it listens, and everything a JIT compiles meanwhile on the server's own core.
`--seconds 5` ends a start five seconds after it began: more starts for the first seconds alone.

Every process runs a copy of its executable that was made for it in /dev/shm. Before a timed start, a process of that copy is started, asked every route once, checked and ended;
how long its first response took, on one connection, is in the row as well.
The cores must be idle. "guests" in a row is the share of the server's cores that the kernel charged to somebody else.
A column that is built like another one (`--column again=/path/to/bun:--aot`, `--control again=aot` with `--table`) shows what two equal executables differ by.

`--routes-file routes.json --cwd <folder> --reuse --natives ""` measures another program: its executables lie in `<work>/bin/<server>-<column>` already, beside `load`, and are started in that folder. The file
is a list of routes as in ../answers.ts; only `name` and `path` are needed, and `"compare": "length"` is for a page that is not the same twice.

Instructions come from cost_by_request.py, which counts every thread; they hold on a busy machine. `--table rows.jsonl --counted counted.jsonl` prints them behind the other tables.

A process with several threads stands still while the kernel grows its table of open files, at the 64th, the 128th .. file, until every core of the machine has passed through its scheduler: a few
milliseconds on an idle machine, 100 to 250 on a busy one with 192 cores. A server meets that while it accepts its first connections.
"""
import argparse, collections, json, multiprocessing, os, random, shutil, socket, statistics, subprocess, time

import cost_by_request, measure

HERE = os.path.dirname(os.path.abspath(__file__))
TITLES = {"bun": "Bun.serve", "hono": "Hono", "elysia": "Elysia", "node": "node:http", "express": "Express", "fastify": "Fastify", "fastify-schemas": "Fastify with schemas", "koa": "Koa", "tanstack": "TanStack Start"}
WITHIN = (1, 2, 5, 10)


def build(options):
    spec = cost_by_request.build(options)
    for native in options.natives:
        executable = os.path.join(options.work, "bin", native + "-native")
        if options.reuse and os.path.exists(executable):
            continue
        source, target = os.path.join(options.work, native), os.path.join(options.work, "rust-target")
        shutil.rmtree(source, ignore_errors=True)
        shutil.copytree(os.path.join(HERE, "..", native), source)
        measure.run_checked(measure.NATIVE[native] + ([executable, "."] if native == "go" else []), cwd=source, env=dict(os.environ, CARGO_TARGET_DIR=target))
        if native == "rust":
            shutil.copy(os.path.join(target, "release", "servers"), executable)
    return spec


def free_port():
    """Below the range from which the kernel takes a client's own port: a client that knocks at a port of that range may be given that very port, and is then connected to itself."""
    while True:
        port = random.randrange(10000, 32000)
        with socket.socket() as probe:
            try:
                probe.bind(("127.0.0.1", port))
                return port
            except OSError:
                pass


def as_range(cores):
    return "%d-%d" % (cores[0], cores[-1]) if len(cores) > 1 else str(cores[0])


def run_start(options, routes, server, column, start, lane, wait_for_the_other_lanes):
    server_cores, client_cores = lane[:options.server_cores], lane[options.server_cores:]
    folder = os.path.join(options.work, "requests-%d" % lane[0])
    os.makedirs(folder, exist_ok=True)
    copy = os.path.join("/dev/shm" if os.access("/dev/shm", os.W_OK) else options.work, "aot-servers-requests-%03d" % lane[0])
    log_path = os.path.join(folder, "server.log")
    port = free_port()
    env = dict(os.environ, NODE_ENV="production", BUN_ENABLE_CRASH_REPORTING="0", DO_NOT_TRACK="1", WTF_numberOfProcessorCores=str(options.server_cores), GOMAXPROCS="1", SERVER_THREADS="1", PORT=str(port))
    env.update(column["run_env"])
    load = ["taskset", "-c", as_range(client_cores), os.path.join(options.work, "bin", "load"), str(port), str(options.connections)]

    def start_server():
        return subprocess.Popen(["taskset", "-c", as_range(server_cores), copy], env=env, cwd=options.cwd or (os.path.join(options.work, "tanstack") if server == "tanstack" else folder), stdin=subprocess.DEVNULL, stdout=open(log_path, "wb"), stderr=subprocess.STDOUT)

    def log_end():
        return open(log_path, "rb").read()[-300:].decode("latin-1")

    try:
        shutil.copy(os.path.join(options.work, "bin", column["name"] + "-native" if column["name"] in options.natives else "%s-%s" % (server, column["name"])), copy)
        asked_at, process, files, alone_seconds = time.monotonic(), start_server(), [], None
        try:
            for route in routes:
                deadline = time.monotonic() + 30
                while True:
                    try:
                        response = measure.send_request(port, route)
                        break
                    except (OSError, ValueError, IndexError):
                        if time.monotonic() > deadline or process.poll() is not None:
                            raise measure.MeasurementError("no response: " + log_end())
                        time.sleep(0.0002)
                alone_seconds = alone_seconds or time.monotonic() - asked_at
                expected = route.get("expectedBody")
                if expected is not None and (response[0], measure.strip_timestamps(response[2])) != (route.get("status", 200), expected.encode()):
                    raise measure.MeasurementError("unexpected response to /%s: %d %r" % (route["name"], response[0], response[2][:80]))
                request = "%s %s HTTP/1.1\r\nHost: 127.0.0.1:%d\r\n" % (route["method"], route["path"], port) + "".join("%s: %s\r\n" % pair for pair in route.get("headers", {}).items())
                body = route.get("request", "").encode()
                if body:
                    request += "Content-Type: application/json\r\nContent-Length: %d\r\n" % len(body)
                files += [os.path.join(folder, "request-" + route["name"]), os.path.join(folder, "expected-" + route["name"])]
                open(files[-2], "wb").write(request.encode() + b"\r\n" + body)
                open(files[-1], "wb").write(("%d\n%s\n%s\n" % (route.get("status", 200), route["type"], "exact" if measure.strip_timestamps(response[2]) == response[2] and route.get("compare") != "length" else "length")).encode() + response[2])
        finally:
            process.kill()
            process.wait()
    finally:
        wait_for_the_other_lanes()

    row = {"server": server, "column": column["name"] + ("+" if column.get("filler") else ""), "start": start, "lane": lane[0], "routes": [route["name"] for route in routes], "server_cores": options.server_cores, "client_cores": len(client_cores), "connections": options.connections, "load_average": open("/proc/loadavg").read().split()[0], "first_answer_alone_seconds": alone_seconds, "within": {}, "marks": {}, "windows": {}}
    from_start = dict(os.environ, LOAD_FROM_START="1", LOAD_MARKS=",".join(str(mark) for mark in options.marks), LOAD_WITHIN=",".join(str(seconds) for seconds in WITHIN))
    if options.seconds:
        from_start["LOAD_UNTIL"] = str(options.seconds)
    client = subprocess.Popen(load + [str(options.marks[-1]), str(len(client_cores))] + files, env=from_start, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    time.sleep(0.05)
    ticks_at_start, started_at = cost_by_request.core_ticks(server_cores), time.monotonic()
    process = start_server()
    try:
        output, errors = client.communicate("%.9f %d\n" % (started_at, process.pid), timeout=900)
        if client.returncode:
            raise measure.MeasurementError("load: %s | %s" % (errors[-300:], log_end()))
        seconds = time.monotonic() - started_at
        fields = open("/proc/%d/stat" % process.pid).read().rsplit(")", 1)[1].split()
        cpu_seconds = (int(fields[11]) + int(fields[12])) / os.sysconf("SC_CLK_TCK")
        row["guests"] = ((cost_by_request.core_ticks(server_cores) - ticks_at_start) / os.sysconf("SC_CLK_TCK") - cpu_seconds) / (seconds * options.server_cores)
        row["peak_rss_mb"], row["private_mb"] = measure.proc_status_mb(process.pid, "VmHWM"), measure.private_mb(process.pid)
        for line in output.split("\n"):
            words = line.split()
            if not words:
                continue
            if words[0] == "requests":
                row["requests"] = int(words[1])
            elif words[0] == "first":
                row["first_answer_seconds"] = float(words[1])
            elif words[0] == "within":
                row["within"][words[1]] = int(words[2])
            elif words[0] == "mark":
                row["marks"][words[1]] = {"seconds": float(words[2]), "cpu_seconds": float(words[3])}
            elif words[0] == "window":
                row["windows"][words[2]] = {"p50_us": float(words[3]), "p99_us": float(words[4]), "longest_us": float(words[5])}
        if options.rate and not options.seconds:
            run = subprocess.run(load + [str(int(options.rate * (options.rate_seconds + 1))), str(len(client_cores))] + files, env=dict(os.environ, LOAD_RATE=str(options.rate), LOAD_SKIP=str(int(options.rate))), capture_output=True, text=True)
            if run.returncode:
                raise measure.MeasurementError("load at a rate: %s | %s" % (run.stderr[-300:], log_end()))
            words = run.stdout.split()
            row["at_rate"] = {"rate": options.rate, **{name: float(words[words.index(name) + 1]) for name in ("p50_us", "p99_us", "p999_us", "longest_us")}}
    finally:
        client.kill()
        process.kill()
        process.wait()
        os.remove(copy)
    return row


def deal(count, start):
    """The column of every lane in this start. Lanes that lie side by side share a last-level cache, and what runs there moves a server by 3 to 5%. With 4, 8, 16 .. lanes, each start puts
    one half of the columns into the first half of the lanes, and over `count - 1` starts any two columns are in the same half equally often, and every column but the first is in either half
    as often as the others. With another number of lanes the columns move on by one."""
    if count < 4 or count & (count - 1):
        return [(lane - start) % count for lane in range(count)]
    mask = start % (count - 1) + 1
    halves = [[column for column in range(count) if bin(column & mask).count("1") % 2 == side] for side in (0, 1)]
    return [half[(place + start) % len(half)] for half in halves for place in range(len(half))]


def run_lane(options, routes, lanes, index, barrier, results):
    """The driver of a lane sleeps while its server is loaded. It sits on the last core of the lane's client."""
    os.sched_setaffinity(0, {lanes[index][-1]})
    for server in options.servers:
        for start in range(options.first_start, options.first_start + options.starts):
            column = options.columns[deal(len(lanes), start)[index]]
            try:
                results.put(run_start(options, routes, server, column, start, lanes[index], barrier.wait))
            except Exception as error:
                results.put({"server": server, "column": column["name"], "start": start, "error": "%s: %s" % (type(error).__name__, error)})
            barrier.wait()
    results.put(None)


def print_tables(options):
    rows = [json.loads(line) for path in options.table for line in open(path)]
    # Far below zero: the server has used more time than its cores were busy, so it ran elsewhere.
    disturbed = [row for row in rows if abs(row["guests"]) > options.guests]
    rows = [row for row in rows if abs(row["guests"]) <= options.guests]
    cells = collections.OrderedDict()
    for row in rows:
        cells.setdefault(row["server"], collections.OrderedDict()).setdefault(row["column"], []).append(row)
    controls = dict(pair.split("=", 1) for pair in options.control)
    names = [name for name in (options.show.split(",") if options.show else list(next(iter(cells.values())))) if name not in controls]
    titles = dict(pair.split("=", 1) for pair in options.title)
    some = rows[0]
    print("%d connections, %s in turn; every server on %d core%s of its own, every client on %d more; the columns of a row side by side.\n" % (some["connections"], ", ".join(some["routes"]), some["server_cores"], "" if some["server_cores"] == 1 else "s", some["client_cores"]))

    def table(title, value, form, best, cells=cells):
        def cell(server, name):
            values = [each for each in (value(row) for row in cells[server].get(name, [])) if each is not None]
            return (statistics.median(values), (max(values) - min(values)) / statistics.median(values), len(values)) if values else None

        lines, spreads, counts, apart = [], [], set(), []
        for server in cells:
            found = [cell(server, name) for name in names]
            if not any(found):
                continue
            winner = best(each[0] for each in found if each)
            lines.append((found[0][0] if found[0] else 0, "| %s | %s |" % (TITLES.get(server, server), " | ".join("" if not each else ("**%s**" if each[0] == winner else "%s") % form(each[0]) for each in found))))
            spreads += [each[1] for each in found if each]
            counts |= {each[2] for each in found if each}
            for again, name in controls.items():
                first, second = cell(server, again), cell(server, name)
                if first and second:
                    apart.append(first[0] / second[0] - 1)
        if not lines:
            return
        print("**%s**\n" % title)
        print("| | %s |" % " | ".join(titles.get(name, name) for name in names))
        print("| --- |%s" % (" ---: |" * len(names)))
        for _, line in sorted(lines, reverse=best is max):
            print(line)
        print("\nMedians of %s starts. The starts of a cell lie within %.1f%% of each other in the median cell, %.1f%% in the worst.%s\n" % (
            " to ".join(str(count) for count in sorted({min(counts), max(counts)})), 100 * statistics.median(spreads), 100 * max(spreads),
            " The same program built twice: %+.1f%% to %+.1f%% apart." % (100 * min(apart), 100 * max(apart)) if apart else ""))

    def between(first, last, what):
        def value(row):
            if str(last) not in row["marks"] or str(first) not in row["marks"]:
                return None
            seconds, cpu = (row["marks"][str(last)][key] - row["marks"][str(first)][key] for key in ("seconds", "cpu_seconds"))
            return (last - first) / seconds if what == "rate" else cpu / (last - first) * 1e6 if what == "cpu" else 100 * cpu / seconds / row["server_cores"]
        return value

    group = lambda number: "{:,}".format(int(round(number)))
    tenth = lambda number: "%.1f" % number
    marks = max((sorted(int(mark) for mark in row["marks"]) for row in rows), key=len)
    early, warm_from, last = marks[min(1, len(marks) - 1)], marks[-2], marks[-1]
    for seconds in WITHIN:
        table("Requests a second over the first %s after the process starts" % ("second" if seconds == 1 else "%d seconds" % seconds), lambda row: row["within"][str(seconds)] / seconds if str(seconds) in row["within"] else None, group, max)
    table("Requests a second over the first %s requests, from the start of the process" % group(early), lambda row: early / row["marks"][str(early)]["seconds"] if str(early) in row["marks"] else None, group, max)
    table("Requests a second, warm: requests %s to %s" % (group(warm_from + 1), group(last)), between(warm_from, last, "rate"), group, max)
    table("Milliseconds from the start of a process to its first response, one connection", lambda row: row["first_answer_alone_seconds"] * 1e3 if row.get("first_answer_alone_seconds") else None, tenth, min)
    table("Milliseconds from the start of the process to its first response, %d connections" % some["connections"], lambda row: row["first_answer_seconds"] * 1e3, tenth, min)
    table("CPU time a request over the first %s requests, all threads, from the start of the process: microseconds" % group(early), lambda row: row["marks"][str(early)]["cpu_seconds"] / early * 1e6 if str(early) in row["marks"] else None, tenth, min)
    table("CPU time a request, warm, all threads: microseconds", between(warm_from, last, "cpu"), tenth, min)
    table("How busy the server kept its cores, warm: percent (a server that waits for its client is not being measured)", between(warm_from, last, "busy"), tenth, max)
    rates = sorted({row["at_rate"]["rate"] for row in rows if "at_rate" in row})
    for key, title in (("p50_us", "Median latency"), ("p99_us", "99th percentile of latency")):
        table("%s at %s requests a second, warm: microseconds" % (title, " | ".join(group(rate) for rate in rates)), lambda row: row["at_rate"][key] if "at_rate" in row else None, group, min)
    table("Peak RSS at request %s: MB" % group(last), lambda row: row["peak_rss_mb"] if str(last) in row["marks"] else None, tenth, min)
    table("Private memory at request %s: MB" % group(last), lambda row: row.get("private_mb") if str(last) in row["marks"] else None, tenth, min)
    counted = collections.OrderedDict((server, {}) for server in cells)
    for row in (json.loads(line) for path in options.counted for line in open(path)):
        for server in counted if row["column"] == "native" else [row["server"]] if row["server"] in counted else []:
            counted[server].setdefault(row["server"] if row["column"] == "native" else row["column"], []).append({reading["requests"]: cost_by_request.total(reading, "user_instructions") for reading in row["readings"] if not reading.get("idle")})
    table("User instructions a request over the first %s requests, all threads, from the start of the process: thousands" % group(early), lambda sums: sums[early] / early / 1e3 if early in sums else None, tenth, min, counted)
    table("User instructions a request, warm, all threads: thousands", lambda sums: (sums[last] - sums[warm_from]) / (last - warm_from) / 1e3 if last in sums and warm_from in sums else None, tenth, min, counted)
    guests = [row["guests"] for row in rows]
    print("Somebody else on the servers' cores: %.1f%% of their time in the median start, %.1f%% in the worst; %d starts with more than %.0f%% are left out. Load average %s to %s." % (100 * statistics.median(guests), 100 * max(guests), len(disturbed), 100 * options.guests, min(float(row["load_average"]) for row in rows), max(float(row["load_average"]) for row in rows)))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--table", nargs="+", metavar="ROWS", help="print the tables of these files and do nothing else")
    parser.add_argument("--show", default="", help="with --table: the columns, in this order; all by default")
    parser.add_argument("--title", action="append", default=[], metavar="COLUMN=TEXT", help="with --table: the head of a column")
    parser.add_argument("--control", action="append", default=[], metavar="COLUMN=COLUMN", help="with --table: the first is built like the second; it is not shown, and every table says how far apart the two are")
    parser.add_argument("--counted", nargs="+", default=[], metavar="ROWS", help="with --table: rows of cost_by_request.py with the same columns and --in-turn (go and rust: --servers go,rust --column native=..): two tables of instructions")
    parser.add_argument("--guests", type=float, default=0.1, help="with --table: a start in which somebody else had more than this share of the server's cores is left out")
    parser.add_argument("--column", action="append", default=[], metavar="NAME=BUN[:FLAGS]")
    parser.add_argument("--natives", default="go,rust", help="the columns that are no Bun's; may be empty")
    parser.add_argument("--run-env", action="append", default=[], metavar="COLUMN:NAME=VALUE")
    parser.add_argument("--out", help="output file; lines are appended")
    parser.add_argument("--servers", default="bun,hono,elysia,node,express,fastify,koa")
    parser.add_argument("--routes", default="text,json,params,async,stream,post,hand,typed")
    parser.add_argument("--routes-file", help="the routes of a program that is not one of ../app; --routes names those of them that are sent")
    parser.add_argument("--cwd", help="the folder that the servers are started in")
    parser.add_argument("--cores", default="0-19", help="consecutive cores: a lane for every column")
    parser.add_argument("--server-cores", type=int, default=1)
    parser.add_argument("--client-cores", type=int, default=3)
    parser.add_argument("--marks", default="1000,10000,200000,1000000")
    parser.add_argument("--seconds", type=float, default=0, help="end a start this long after it began")
    parser.add_argument("--rate", type=float, default=5000, help="requests a second of the open loop behind the closed one; 0: none")
    parser.add_argument("--rate-seconds", type=float, default=4, help="and one second before them that is not counted; node:http closes a connection that was idle for six seconds")
    parser.add_argument("--starts", type=int, default=0, help="by default as many as it takes until any two columns have been neighbors equally often: one fewer than there are lanes, if those are 4, 8, 16 ..")
    parser.add_argument("--first-start", type=int, default=0, help="the number of the first start, for a run that goes on where another one ended")
    parser.add_argument("--connections", type=int, default=64)
    parser.add_argument("--modules", help="an installed node_modules, as for measure.py")
    parser.add_argument("--work", help="working directory for executables and logs")
    parser.add_argument("--reuse", action="store_true", help="the executables in --work are there already")
    parser.add_argument("--build-only", action="store_true")
    options = parser.parse_args()
    if options.table:
        return print_tables(options)
    if not options.column or not options.work or not (options.out or options.build_only):
        parser.error("--column, --work and --out are required")
    options.columns = []
    for text in options.column:
        name, _, rest = text.partition("=")
        bun, _, flags = rest.partition(":")
        options.columns.append({"name": name, "bun": os.path.abspath(bun), "flags": flags.split(), "run_env": {}})
    for text in options.run_env:
        name, _, pair = text.partition(":")
        next(column for column in options.columns if column["name"] == name)["run_env"].update([pair.split("=", 1)])
    options.work, options.servers, options.natives = os.path.abspath(options.work), options.servers.split(","), [native for native in options.natives.split(",") if native]
    options.marks = [int(mark) for mark in options.marks.split(",")]
    if options.routes_file:
        spec = {"routes": [{"method": "GET", "type": "-", **route} for route in json.load(open(options.routes_file))]}
    else:
        spec = build(options)
    if options.build_only:
        return
    options.columns += [{"name": native, "run_env": {}} for native in options.natives]
    cores, width = measure.parse_core_range(options.cores), options.server_cores + options.client_cores
    lanes = [cores[first:first + width] for first in range(0, len(cores) - width + 1, width)]
    if len(lanes) < len(options.columns):
        parser.error("--cores has %d lanes of %d cores for %d columns" % (len(lanes), width, len(options.columns)))
    # No lane is idle: a server beside an idle lane has more of the cache than one between two busy ones.
    options.columns = [dict(options.columns[index % len(options.columns)], filler=True) for index in range(len(lanes) - len(options.columns))] + options.columns
    options.starts = options.starts or (len(lanes) if len(lanes) < 4 or len(lanes) & (len(lanes) - 1) else len(lanes) - 1)
    wanted = options.routes.split(",")
    routes = sorted((route for route in spec["routes"] + ([] if options.routes_file else measure.PAGES) if route["name"] in wanted), key=lambda route: wanted.index(route["name"]))
    barrier, results = multiprocessing.Barrier(len(lanes)), multiprocessing.Queue()
    drivers = [multiprocessing.Process(target=run_lane, args=(options, routes, lanes, index, barrier, results)) for index in range(len(lanes))]
    for driver in drivers:
        driver.start()
    running = len(drivers)
    with open(options.out, "a") as out:
        while running:
            row = results.get()
            if row is None:
                running -= 1
            elif "error" in row:
                print("%s %s start %d: NO ROW: %s" % (row["server"], row["column"], row["start"], row["error"]), flush=True)
            else:
                out.write(json.dumps(row) + "\n")
                out.flush()
                print("%s %s start %d: first second %s, %s" % (row["server"], row["column"], row["start"], row["within"].get("1"), "%.0f warm" % ((options.marks[-1] - options.marks[-2]) / (row["marks"][str(options.marks[-1])]["seconds"] - row["marks"][str(options.marks[-2])]["seconds"])) if str(options.marks[-1]) in row["marks"] else "ended at %s requests" % row.get("requests")), flush=True)
    for driver in drivers:
        driver.join()


if __name__ == "__main__":
    main()
