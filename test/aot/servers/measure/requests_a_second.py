#!/usr/bin/env python3
"""Requests a second, from the start of a process to its millionth request. Linux only; needs `taskset` and `cc`. No hardware counters, nothing attached to the server.

    python3 requests_a_second.py --column aot=/path/to/bun:--aot --column jit=/path/to/bun --column released=/path/to/released/bun \\
        --servers bun,hono,elysia,node,express,fastify,koa,go,rust --cores 0-7 --work /tmp/requests --out rows.jsonl
    python3 requests_a_second.py --table rows.jsonl

A column is a name, the Bun that builds the executable with `bun build --compile`, and the flags of that build, as in measure.py. `go` and `rust` are ../go (net/http) and ../rust (axum):
the same routes, built with `go build` and `cargo build --release`, one thread each (GOMAXPROCS=1, SERVER_THREADS=1). They are columns of the tables, with the same number in every row.

One start is one process and one run of load.c, which is knocking at the port before the server is started:

  1. The server is pinned to the first core of `--cores` (`--server-cores 4`: the first four) and told how many it has. The client has the next three cores to itself.
  2. As soon as the server listens, 64 connections are opened, and each has one request in flight from then on, a request of each route of `--routes` in turn, until `--requests` are answered.
     The connections stay open and the load never pauses. Every response is compared with the expected one, byte for byte.
  3. load.c notes when every response was complete, counted from the moment the server was started, and reads the CPU time of all threads of the server
     (the kernel's clock for the process, clock_getcpuclockid) as the responses number 1,000, 10,000, 200,000 and 1,000,000 arrive.
  4. The same process, warm by now, is then sent requests at a fixed rate (`--rate`, an open loop) for `--rate-seconds`. A request's latency counts from the moment it was due.

So "the first second" has in it whatever the process does before it listens, and everything a JIT compiles meanwhile on the server's own core.
`--seconds 5` ends a start five seconds after it began: more starts for the first seconds alone.

The columns run in turn, `--starts` times, in an order that rotates, each process from a copy of its executable made for it in /dev/shm. A cell of a table is the median over the starts.
Before the first timed start of an executable, a process of it is started, asked every route once, checked and ended.
The cores must be idle, and so must the cores behind the same last-level cache. "guests" in a row is the share of the server's cores that the kernel charged to somebody else.
A column that is built like another one (`--column again=/path/to/bun:--aot`, `--control again=aot` with `--table`) shows what two equal executables differ by.
"""
import argparse, collections, json, os, shutil, socket, statistics, subprocess, time

import cost_by_request, measure

HERE = os.path.dirname(os.path.abspath(__file__))
TITLES = {"bun": "Bun.serve", "hono": "Hono", "elysia": "Elysia", "node": "node:http", "express": "Express", "fastify": "Fastify", "fastify-schemas": "Fastify with schemas", "koa": "Koa", "tanstack": "TanStack Start", "go": "Go", "rust": "Rust"}
MARKS = (1000, 10000, 200000, 1000000)
WITHIN = (1, 2, 5, 10)


def build(options):
    natives = [server for server in options.servers if server in measure.NATIVE]
    spec = cost_by_request.build(argparse.Namespace(**dict(vars(options), servers=[server for server in options.servers if server not in natives])))
    for server in natives:
        executable = os.path.join(options.work, "bin", server + "-native")
        if options.reuse and os.path.exists(executable):
            continue
        source, target = os.path.join(options.work, server), os.path.join(options.work, "rust-target")
        shutil.rmtree(source, ignore_errors=True)
        shutil.copytree(os.path.join(HERE, "..", server), source)
        measure.run_checked(measure.NATIVE[server] + ([executable, "."] if server == "go" else []), cwd=source, env=dict(os.environ, CARGO_TARGET_DIR=target))
        if server == "rust":
            shutil.copy(os.path.join(target, "release", "servers"), executable)
    return spec


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def as_range(cores):
    return "%d-%d" % (cores[0], cores[-1]) if len(cores) > 1 else str(cores[0])


def run_start(options, routes, server, column, start):
    cores = measure.parse_core_range(options.cores)
    server_cores, client_cores = cores[:options.server_cores], cores[options.server_cores:options.server_cores + 3]
    folder = os.path.join(options.work, "requests-%d" % cores[0])
    os.makedirs(folder, exist_ok=True)
    copy = os.path.join("/dev/shm" if os.access("/dev/shm", os.W_OK) else options.work, "aot-servers-requests-%03d" % cores[0])
    shutil.copy(os.path.join(options.work, "bin", "%s-%s" % (server, column["name"])), copy)
    port = free_port()
    env = dict(os.environ, NODE_ENV="production", BUN_ENABLE_CRASH_REPORTING="0", DO_NOT_TRACK="1", WTF_numberOfProcessorCores=str(options.server_cores), GOMAXPROCS="1", SERVER_THREADS="1", PORT=str(port))
    env.update(column["run_env"])
    log_path = os.path.join(folder, "server.log")
    load = ["taskset", "-c", as_range(client_cores), os.path.join(options.work, "bin", "load"), str(port), str(options.connections)]

    def start_server():
        return subprocess.Popen(["taskset", "-c", as_range(server_cores), copy], env=env, cwd=os.path.join(options.work, "tanstack") if server == "tanstack" else folder, stdin=subprocess.DEVNULL, stdout=open(log_path, "wb"), stderr=subprocess.STDOUT)

    def log_end():
        return open(log_path, "rb").read()[-300:].decode("latin-1")

    key = (server, column["name"])
    if key not in options.expected:
        process, options.expected[key] = start_server(), {}
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
                        time.sleep(0.001)
                expected = route.get("expectedBody")
                if expected is not None and (response[0], measure.strip_timestamps(response[2])) != (route.get("status", 200), expected.encode()):
                    raise measure.MeasurementError("unexpected response to /%s: %d %r" % (route["name"], response[0], response[2][:80]))
                options.expected[key][route["name"]] = ("%d\n%s\n%s\n" % (route.get("status", 200), route["type"], "exact" if measure.strip_timestamps(response[2]) == response[2] else "length")).encode() + response[2]
        finally:
            process.kill()
            process.wait()
    files = []
    for route in routes:
        request = "%s %s HTTP/1.1\r\nHost: 127.0.0.1:%d\r\n" % (route["method"], route["path"], port) + "".join("%s: %s\r\n" % pair for pair in route.get("headers", {}).items())
        body = route.get("request", "").encode()
        if body:
            request += "Content-Type: application/json\r\nContent-Length: %d\r\n" % len(body)
        files += [os.path.join(folder, "request-" + route["name"]), os.path.join(folder, "expected-" + route["name"])]
        open(files[-2], "wb").write(request.encode() + b"\r\n" + body)
        open(files[-1], "wb").write(options.expected[key][route["name"]])

    row = {"server": server, "column": column["name"], "start": start, "routes": [route["name"] for route in routes], "server_cores": options.server_cores, "connections": options.connections, "load_average": open("/proc/loadavg").read().split()[0], "within": {}, "marks": {}, "windows": {}}
    from_start = dict(os.environ, LOAD_FROM_START="1", LOAD_MARKS=",".join(str(mark) for mark in MARKS), LOAD_WITHIN=",".join(str(seconds) for seconds in WITHIN))
    if options.seconds:
        from_start["LOAD_UNTIL"] = str(options.seconds)
    client = subprocess.Popen(load + [str(options.requests), "3"] + files, env=from_start, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
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
        row["peak_rss_mb"] = measure.proc_status_mb(process.pid, "VmHWM")
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
            run = subprocess.run(load + [str(int(options.rate * (options.rate_seconds + 1))), "3"] + files, env=dict(os.environ, LOAD_RATE=str(options.rate), LOAD_SKIP=str(int(options.rate))), capture_output=True, text=True)
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


def print_tables(options):
    rows = [json.loads(line) for path in options.table for line in open(path)]
    cells = collections.OrderedDict()
    for row in rows:
        cells.setdefault(row["server"], collections.OrderedDict()).setdefault(row["column"], []).append(row)
    natives = [server for server in cells if server in measure.NATIVE]
    servers = [server for server in cells if server not in natives]
    controls = dict(pair.split("=", 1) for pair in options.control)
    names = [name for name in (options.show.split(",") if options.show else list(cells[servers[0]])) if name not in controls]
    titles = dict(pair.split("=", 1) for pair in options.title)
    some = rows[0]
    print("%d connections, %s in turn, the server on %d core%s, the client on three others.\n" % (some["connections"], ", ".join(some["routes"]), some["server_cores"], "" if some["server_cores"] == 1 else "s"))

    def table(title, value, form, best):
        def cell(server, name):
            values = [each for each in (value(row) for row in cells[server].get(name, [])) if each is not None]
            return (statistics.median(values), (max(values) - min(values)) / statistics.median(values), len(values)) if values else None

        print("**%s**\n" % title)
        print("| | %s |" % " | ".join([titles.get(name, name) for name in names] + [TITLES[native] for native in natives]))
        print("| --- |%s" % (" ---: |" * (len(names) + len(natives))))
        spreads, counts, apart = [], set(), []
        lines = []
        for server in servers:
            found = [cell(server, name) for name in names] + [cell(native, "native") for native in natives]
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
            return (last - first) / seconds if what == "rate" else cpu / (last - first) * 1e6
        return value

    group = lambda number: "{:,}".format(int(round(number)))
    for seconds in WITHIN:
        table("Requests a second over the first %s after the process starts" % ("second" if seconds == 1 else "%d seconds" % seconds), lambda row: row["within"][str(seconds)] / seconds if str(seconds) in row["within"] else None, group, max)
    table("Requests a second over the first 10,000 requests, from the start of the process", lambda row: 10000 / row["marks"]["10000"]["seconds"] if "10000" in row["marks"] else None, group, max)
    table("Requests a second, warm: requests 200,001 to 1,000,000", between(200000, 1000000, "rate"), group, max)
    table("Milliseconds from the start of the process to its first response", lambda row: row["first_answer_seconds"] * 1e3, lambda number: "%.1f" % number, min)
    table("CPU time a request over the first 10,000 requests, all threads, from the start of the process: microseconds", lambda row: row["marks"]["10000"]["cpu_seconds"] / 10000 * 1e6 if "10000" in row["marks"] else None, lambda number: "%.1f" % number, min)
    table("CPU time a request, warm, all threads: microseconds", between(200000, 1000000, "cpu"), lambda number: "%.1f" % number, min)
    for key, title in (("p50_us", "Median latency"), ("p99_us", "99th percentile of latency")):
        rates = sorted({row["at_rate"]["rate"] for row in rows if "at_rate" in row})
        if rates:
            table("%s at %s requests a second, warm: microseconds" % (title, " | ".join(group(rate) for rate in rates)), lambda row: row["at_rate"][key] if "at_rate" in row else None, group, min)
    table("Peak RSS: MB", lambda row: row["peak_rss_mb"] if "1000000" in row["marks"] else None, lambda number: "%.1f" % number, min)
    guests = [row["guests"] for row in rows]
    print("Somebody else on the server's cores: %.1f%% of their time in the median start, %.1f%% in the worst. Load average %s to %s." % (100 * statistics.median(guests), 100 * max(guests), min(float(row["load_average"]) for row in rows), max(float(row["load_average"]) for row in rows)))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--table", nargs="+", metavar="ROWS", help="print the tables of these files and do nothing else")
    parser.add_argument("--show", default="", help="with --table: the columns, in this order; all by default")
    parser.add_argument("--title", action="append", default=[], metavar="COLUMN=TEXT", help="with --table: the head of a column")
    parser.add_argument("--control", action="append", default=[], metavar="COLUMN=COLUMN", help="with --table: the first is built like the second; it is not shown, and every table says how far apart the two are")
    parser.add_argument("--column", action="append", default=[], metavar="NAME=BUN[:FLAGS]")
    parser.add_argument("--run-env", action="append", default=[], metavar="COLUMN:NAME=VALUE")
    parser.add_argument("--out", help="output file; lines are appended")
    parser.add_argument("--servers", default="bun,hono,elysia,node,express,fastify,koa,go,rust")
    parser.add_argument("--routes", default="text,json,params,async,stream,post,hand,typed")
    parser.add_argument("--cores", default="0-7", help="consecutive cores: the server's, then three for the client")
    parser.add_argument("--server-cores", type=int, default=1)
    parser.add_argument("--requests", type=int, default=1000000)
    parser.add_argument("--seconds", type=float, default=0, help="end a start this long after it began")
    parser.add_argument("--rate", type=float, default=10000, help="requests a second of the open loop behind the closed one; 0: none")
    parser.add_argument("--rate-seconds", type=float, default=10)
    parser.add_argument("--starts", type=int, default=3)
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
    options.work, options.servers, options.expected = os.path.abspath(options.work), options.servers.split(","), {}
    spec = build(options)
    if options.build_only:
        return
    wanted = options.routes.split(",")
    routes = sorted((route for route in spec["routes"] + measure.PAGES if route["name"] in wanted), key=lambda route: wanted.index(route["name"]))
    with open(options.out, "a") as out:
        for server in options.servers:
            columns = [measure.NATIVE_COLUMN] if server in measure.NATIVE else options.columns
            for start in range(options.starts):
                for index in range(len(columns)):
                    column = columns[(index + start) % len(columns)]
                    row = run_start(options, routes, server, column, start)
                    out.write(json.dumps(row) + "\n")
                    out.flush()
                    print("%s %s start %d: first second %s, %s" % (server, column["name"], start, row["within"].get("1"), "%.0f warm" % (800000 / (row["marks"]["1000000"]["seconds"] - row["marks"]["200000"]["seconds"])) if "1000000" in row["marks"] else "ended at %s requests" % row.get("requests")), flush=True)


if __name__ == "__main__":
    main()
