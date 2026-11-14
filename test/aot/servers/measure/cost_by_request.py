#!/usr/bin/env python3
"""What a request costs by its number, from exec to the millionth, and which thread pays. Linux only; needs `taskset`, `cc` and hardware counters.

    python3 cost_by_request.py --column aot=/path/to/bun:--aot --column own=/path/to/bun --column released=/path/to/released/bun \
        --servers express,fastify --routes text --cores 0-7 --work /tmp/cost --out rows.jsonl
    python3 cost_by_request.py --table rows.jsonl

measure.py warms every process up and measures it afterwards. This measures the warming up: a JIT compiles on threads of its own while the
server answers, and requests per second do not show that work when those threads have cores of their own to run on.

A column is a name, the Bun that builds the executable and the flags of that build, as in measure.py. A process is started under count_threads
(see its first lines), which counts every thread by itself from before exec. It is sent exactly as many requests as bring it to each mark of `--marks`
(load.c, a closed loop of 64 connections, opened anew for every window), and at each mark the counters of all threads are read. So every number is
known twice: for the window between two marks, and as a sum from exec.

The first core, or the first four, of `--cores` are the server's (`--server-cores 1,4` does both, one after the other), and it is told how many it has; the next three are
the client's. On one core the compiler's and the collector's threads take turns with the thread that runs JavaScript. On four they run beside it.
The columns run in turn, `--starts` times, in an order that rotates. A process serves one route; with `--in-turn` it serves all of `--routes`, one request of each in turn.

Threads are told apart by the names they give themselves (/proc/<pid>/task/<tid>/comm): the first thread, which runs the JavaScript; the JIT's compiler threads;
the collector's threads (its own, its marking helpers, the allocators' scavengers); everything else (Bun's thread pool and whatever has no name).

Instructions hold on a busy machine. Time on a core and cycles do not: what else ran on the server's cores is in every row ("guests", the share of those cores' time
that the kernel charged to somebody else), but a busy sibling hyperthread, or busy cores behind the same last-level cache, show in no counter at all. Take a whole group of cores that share one.
The counters cost something themselves: they are saved and restored at every context switch. `--plain` runs without them and without count_threads, and reads only time on a core
(/proc/<pid>/task/<tid>/schedstat): for the clock's numbers, and to see what counting costs.

`--log NAME=REGEX` counts the lines of the server's output that match, window by window. With `--run-env own:BUN_JSC_reportCompileTimes=1` the engine prints a line for
every function it compiles, so `--log dfg='using DFG' --log ftl='using FTL'` say whether it is still compiling at the millionth request.
"""
import argparse, collections, json, os, re, shutil, statistics, subprocess, time

import measure

HERE = os.path.dirname(os.path.abspath(__file__))
KINDS = ("main", "jit", "collector", "other")
KIND_TITLES = {"main": "JavaScript's thread", "jit": "JIT compiler threads", "collector": "collector's threads", "other": "everything else"}
COUNTS = ("ns", "user_instructions", "user_cycles", "kernel_instructions", "kernel_cycles")
JIT_THREADS = re.compile(r"JITWorker|JIT Worklist|t Helper Thread|DFG|FTL|Baseline")
COLLECTOR_THREADS = re.compile(r"Heap|p Helper Thread|ollector Thread|Collector|scavenger|Scavenger|GC")


def core_ticks(cores):
    """Clock ticks that the kernel charged to these cores for anything but idling. A thread's time on a core, as the counters have it, includes the interrupts that it was
    interrupted by, and on the loopback interface a good part of TCP runs in those."""
    wanted = {"cpu%d" % core for core in cores}
    return sum(sum(int(line.split()[field]) for field in (1, 2, 3, 6, 7)) for line in open("/proc/stat") if line.split(" ", 1)[0] in wanted)


def kind_of(tid, pid, name):
    if tid == pid:
        return "main"
    if JIT_THREADS.search(name):
        return "jit"
    if COLLECTOR_THREADS.search(name):
        return "collector"
    return "other"


def build(options):
    """Builds every server with every column, as measure.py does. Returns the routes."""
    bin_folder = os.path.join(options.work, "bin")
    spec_path = os.path.join(options.work, "spec.json")
    if options.reuse and os.path.exists(spec_path):
        return json.load(open(spec_path))
    os.makedirs(bin_folder, exist_ok=True)
    env = dict(os.environ, NO_COLOR="1", BUN_ENABLE_CRASH_REPORTING="0", DO_NOT_TRACK="1")
    installer = options.columns[0]["bun"]
    folders = {}
    for name in ("app", "tanstack"):
        if not any((server == "tanstack") == (name == "tanstack") for server in options.servers):
            continue
        folders[name] = os.path.join(options.work, name)
        shutil.rmtree(folders[name], ignore_errors=True)
        shutil.copytree(os.path.join(HERE, "..", name), folders[name])
        if options.modules:
            os.symlink(os.path.abspath(options.modules), os.path.join(folders[name], "node_modules"))
        else:
            measure.run_checked([installer, "install", "--ignore-scripts"], cwd=folders[name], env=env)
    if "tanstack" in folders:
        shutil.copy(os.path.join(HERE, "..", "app", "shared.ts"), os.path.join(folders["tanstack"], "src", "utils", "shared.ts"))
        measure.run_checked([installer, "node_modules/vite/bin/vite.js", "build"], cwd=folders["tanstack"], env=env)
    spec = json.loads(measure.run_checked([installer, os.path.join(HERE, "..", "answers.ts")], env=env))
    for tool in ("load", "count_threads"):
        measure.run_checked(["cc", "-O2", "-pthread", "-o", os.path.join(bin_folder, tool), os.path.join(HERE, tool + ".c")])
    for server in options.servers:
        for column in options.columns:
            measure.run_checked(
                [column["bun"], "build", "--compile", *column["flags"], "--target=bun", "--define", 'process.env.NODE_ENV="production"', "./serve.ts" if server == "tanstack" else "./%s.ts" % server, "--outfile", os.path.join(bin_folder, "%s-%s" % (server, column["name"]))],
                cwd=folders["tanstack" if server == "tanstack" else "app"],
                env=env,
            )
            print("built %s-%s" % (server, column["name"]), flush=True)
    json.dump(spec, open(spec_path, "w"))
    return spec


class Counted:
    """A server under count_threads."""

    def __init__(self, command, server_cores, client_cores, **more):
        self.process = subprocess.Popen(["taskset", "-c", client_cores, command[0], server_cores] + command[1:], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, **more)
        fields = self.process.stdout.readline().split()
        if not fields or fields[0] != "started":
            raise measure.MeasurementError("count_threads did not start the server")
        self.pid, self.started_at, self.counts_kernel = int(fields[1]), float(fields[2]), fields[3] == "1"

    def read(self):
        self.process.stdin.write("read\n")
        self.process.stdin.flush()
        threads = {}
        while True:
            fields = self.process.stdout.readline().rstrip("\n").split(" ", 10)
            if fields[0] == "end":
                return float(fields[1]), threads
            if fields[0] != "thread":
                raise measure.MeasurementError("the server ended: %s" % " ".join(fields))
            if int(fields[8]) > int(fields[9]) * 1.001 + 1000:
                raise measure.MeasurementError("the processor has too few counters: thread %s was counted for %s of %s ns" % (fields[1], fields[9], fields[8]))
            threads[fields[1]] = {"name": fields[10] if len(fields) > 10 else "", "counts": [int(field) for field in fields[3:8]]}

    def end(self):
        self.process.stdin.close()
        self.process.wait()


class Plain:
    """A server by itself: only the kernel's own account of each thread's time on a core. A thread that has ended keeps what it had when it was last seen;
    the engine's threads end after ten idle seconds, so that is all they ever had, as long as `read` is called more often than that."""

    def __init__(self, command, server_cores, client_cores, **more):
        self.started_at, self.counts_kernel, self.threads = time.monotonic(), False, {}
        self.process = subprocess.Popen(["taskset", "-c", server_cores] + command[1:], stdin=subprocess.DEVNULL, **more)
        self.pid = self.process.pid

    def read(self):
        folder = "/proc/%d/task" % self.pid
        for tid in os.listdir(folder):
            try:
                self.threads[tid] = {"name": open("%s/%s/comm" % (folder, tid)).read().rstrip("\n"), "counts": [int(open("%s/%s/schedstat" % (folder, tid)).read().split()[0]), 0, 0, 0, 0]}
            except (OSError, IndexError):
                pass
        return time.monotonic(), json.loads(json.dumps(self.threads))

    def end(self):
        self.process.kill()
        self.process.wait()


def run_start(options, routes, server, column, server_core_count, start):
    cores = measure.parse_core_range(options.cores)
    server_cores, client_cores = cores[:server_core_count], cores[server_core_count:server_core_count + 3]
    as_range = lambda some: "%d-%d" % (some[0], some[-1]) if len(some) > 1 else str(some[0])
    folder = os.path.join(options.work, "cost-%d" % cores[0])
    os.makedirs(folder, exist_ok=True)
    copy = os.path.join("/dev/shm" if os.access("/dev/shm", os.W_OK) else options.work, "aot-servers-cost-%03d-column-%02d" % (cores[0], options.columns.index(column)))
    shutil.copy(os.path.join(options.work, "bin", "%s-%s" % (server, column["name"])), copy)
    options.spawned += 1
    port = 20000 + cores[0] * 64 + options.spawned % 64
    env = dict(os.environ, NODE_ENV="production", BUN_ENABLE_CRASH_REPORTING="0", DO_NOT_TRACK="1", WTF_numberOfProcessorCores=str(server_core_count), PORT=str(port))
    env.update(column["run_env"])
    log_path = os.path.join(folder, "server.log")
    log = open(log_path, "wb")
    row = {"server": server, "route": route_title(routes), "column": column["name"], "server_cores": server_core_count, "start": start, "connections": options.connections, "plain": options.plain, "load_average": open("/proc/loadavg").read().split()[0], "readings": []}
    process = (Plain if options.plain else Counted)([os.path.join(options.work, "bin", "count_threads"), copy], as_range(server_cores), as_range(client_cores), env=env, cwd=os.path.join(options.work, "tanstack") if server == "tanstack" else folder, stderr=log, **({"stdout": log} if options.plain else {}))
    row["counts_kernel"] = process.counts_kernel

    def read(requests, seconds_of_load):
        at, threads = process.read()
        fields = open("/proc/%d/stat" % process.pid).read().rsplit(")", 1)[1].split()
        row["readings"].append({
            "requests": requests, "seconds": at - process.started_at, "seconds_of_load": seconds_of_load, "threads": threads, "pid": process.pid,
            "rss_mb": measure.proc_status_mb(process.pid, "VmRSS"), "peak_rss_mb": measure.proc_status_mb(process.pid, "VmHWM"), "private_mb": measure.private_mb(process.pid),
            "user_ticks": int(fields[11]), "kernel_ticks": int(fields[12]), "busy_ticks": core_ticks(server_cores), "log_bytes": os.path.getsize(log_path),
        })

    try:
        ticks_at_start = core_ticks(server_cores)
        response = None
        while time.monotonic() - process.started_at < 30 and process.process.poll() is None:
            try:
                response = measure.send_request(port, routes[0])
                break
            except (OSError, ValueError, IndexError):
                time.sleep(0.0005)
        if response is None:
            raise measure.MeasurementError("no response: " + open(log_path, "rb").read()[-300:].decode("latin-1"))
        read(1, 0)
        row["busy_ticks_at_start"] = ticks_at_start
        files = []
        for route in routes:
            if route is not routes[0]:
                response = measure.send_request(port, route)
            expected = route.get("expectedBody")
            if expected is not None and (response[0], measure.strip_timestamps(response[2])) != (route.get("status", 200), expected.encode()):
                raise measure.MeasurementError("unexpected response to /%s: %d %r" % (route["name"], response[0], response[2][:80]))
            request = "%s %s HTTP/1.1\r\nHost: 127.0.0.1:%d\r\n" % (route["method"], route["path"], port) + "".join("%s: %s\r\n" % pair for pair in route.get("headers", {}).items())
            body = route.get("request", "").encode()
            if body:
                request += "Content-Type: application/json\r\nContent-Length: %d\r\n" % len(body)
            files += [os.path.join(folder, "request-" + route["name"]), os.path.join(folder, "expected-" + route["name"])]
            open(files[-2], "wb").write(request.encode() + b"\r\n" + body)
            open(files[-1], "wb").write(("%d\n%s\n%s\n" % (route.get("status", 200), route["type"], "exact" if measure.strip_timestamps(response[2]) == response[2] else "length")).encode() + response[2])
        done = len(routes)
        for mark in options.marks:
            run = subprocess.run(["taskset", "-c", as_range(client_cores), os.path.join(options.work, "bin", "load"), str(port), str(options.connections), str(mark - done), "3"] + files, capture_output=True, text=True)
            if run.returncode:
                raise measure.MeasurementError("load: %s | %s" % (run.stderr[-300:], open(log_path, "rb").read()[-300:].decode("latin-1")))
            done = mark
            read(mark, float(run.stdout.split()[3]))
        if options.idle_seconds:
            time.sleep(options.idle_seconds)
            read(done, 0)
            row["readings"][-1]["idle"] = True
    finally:
        process.end()
        os.remove(copy)
    text = open(log_path, "rb").read()
    for reading in row["readings"]:
        reading["log"] = {name: len(re.findall(pattern.encode(), text[:reading["log_bytes"]])) for name, pattern in options.log.items()}
    return row


def route_title(routes):
    return "/" + routes[0]["name"] if len(routes) == 1 else "%d routes in turn (%s)" % (len(routes), ", ".join(route["name"] for route in routes))


def by_kind(reading):
    sums = {kind: [0] * len(COUNTS) for kind in KINDS}
    for tid, thread in reading["threads"].items():
        into = sums[kind_of(int(tid), reading["pid"], thread["name"])]
        for index, count in enumerate(thread["counts"]):
            into[index] += count
    return sums


def total(reading, count):
    return sum(thread["counts"][COUNTS.index(count)] for thread in reading["threads"].values())


def group(number):
    return "{:,}".format(int(round(number)))


def crossing(marks, ours, theirs):
    """The request at which `theirs`, summed from exec, falls under `ours`: both are straight lines between two marks."""
    if theirs[0] <= ours[0]:
        return "from the first"
    for index in range(1, len(marks)):
        if theirs[index] < ours[index]:
            requests = marks[index] - marks[index - 1]
            gain = ((ours[index] - ours[index - 1]) - (theirs[index] - theirs[index - 1])) / requests
            return group(marks[index - 1] + (theirs[index - 1] - ours[index - 1]) / gain)
    requests = marks[-1] - marks[-2]
    gain = ((ours[-1] - ours[-2]) - (theirs[-1] - theirs[-2])) / requests
    if gain <= 0:
        return "never: its request still costs more in the last window"
    return "not within %s; at the last window's costs, at %s" % (group(marks[-1]), group(marks[-1] + (theirs[-1] - ours[-1]) / gain))


def print_summary(jobs):
    """One line for each server and pinning: the last window, the sums from exec, what warming up cost, and the break-even."""
    names = list(next(iter(jobs.values())))

    def reading_at(row, mark):
        return next(reading for reading in row["readings"] if reading["requests"] == mark and not reading.get("idle"))

    def lines(title, heads, cells_of):
        print("**%s**\n" % title)
        print("| server | cores | %s |" % " | ".join(heads))
        print("| --- | ---: |%s" % (" ---: |" * len(heads)))
        for (server, route, server_cores, plain), columns in jobs.items():
            if list(columns) == names and not plain:
                marks = [reading["requests"] for reading in columns[names[0]][0]["readings"] if not reading.get("idle")]
                print("| %s | %d | %s |" % (server, server_cores, " | ".join(cells_of(columns, marks))))
        print()

    def medians(columns, value):
        return [statistics.median(value(row) for row in columns[name]) for name in names]

    def against(cells):
        return ["%+.1f%%" % (100 * (cells[0] / cell - 1)) if cell else "" for cell in cells[1:]]

    versus = ["%s against %s" % (names[0], name) for name in names[1:]]
    counts_kernel = any(row["counts_kernel"] for columns in jobs.values() for rows in columns.values() for row in rows)
    for count, scale, unit in (("user_instructions", 1e3, "user instructions a request, thousands"), ("kernel_instructions", 1e3, "kernel instructions a request, thousands"), ("user_cycles", 1e3, "user cycles a request, thousands"), ("kernel_cycles", 1e3, "kernel cycles a request, thousands"), ("ns", 1e3, "CPU time a request, microseconds")):
        if count.startswith("kernel") and not counts_kernel:
            continue
        def warm(columns, marks, count=count, scale=scale):
            cells = medians(columns, lambda row: (total(reading_at(row, marks[-1]), count) - total(reading_at(row, marks[-3]), count)) / (marks[-1] - marks[-3]) / scale)
            return ["%.1f" % cell for cell in cells] + against(cells)
        lines("Warm, all threads: %s, over the last two windows" % unit, names + versus, warm)
    for count, scale, unit in (("user_instructions", 1e9, "billions of user instructions"), ("ns", 1e9, "CPU seconds")):
        def summed(columns, marks, count=count, scale=scale):
            cells = medians(columns, lambda row: total(reading_at(row, marks[-1]), count) / scale)
            return ["%.2f" % cell for cell in cells] + against(cells)
        lines("From exec to the last request, all threads: %s" % unit, names + versus, summed)

        def warming(columns, marks, count=count, scale=scale):
            return ["%.3f" % cell for cell in medians(columns, lambda row: (total(reading_at(row, marks[-1]), count) - marks[-1] * (total(reading_at(row, marks[-1]), count) - total(reading_at(row, marks[-3]), count)) / (marks[-1] - marks[-3])) / scale)]
        lines("Starting and warming up: %s beyond what as many warm requests cost" % unit, names, warming)
    lines("The compiler threads from exec to the last request: CPU seconds", names, lambda columns, marks: ["%.3f" % cell for cell in medians(columns, lambda row: by_kind(reading_at(row, marks[-1]))["jit"][0] / 1e9)])
    lines("The compiler threads in the last window: CPU milliseconds a second", names, lambda columns, marks: ["%.2f" % cell for cell in medians(columns, lambda row: (by_kind(reading_at(row, marks[-1]))["jit"][0] - by_kind(reading_at(row, marks[-2]))["jit"][0]) / (reading_at(row, marks[-1])["seconds"] - reading_at(row, marks[-2])["seconds"]) / 1e6)])
    lines("The collector's threads, warm: CPU microseconds a request", names, lambda columns, marks: ["%.2f" % cell for cell in medians(columns, lambda row: (by_kind(reading_at(row, marks[-1]))["collector"][0] - by_kind(reading_at(row, marks[-3]))["collector"][0]) / (marks[-1] - marks[-3]) / 1e3)])

    def by_thread(title, value, form):
        print("**%s**\n" % title)
        print("| server | cores | | %s | all |" % " | ".join(KIND_TITLES[kind] for kind in KINDS))
        print("| --- | ---: | --- |%s" % (" ---: |" * (len(KINDS) + 1)))
        for (server, route, server_cores, plain), columns in jobs.items():
            if list(columns) != names or plain:
                continue
            marks = [reading["requests"] for reading in columns[names[0]][0]["readings"] if not reading.get("idle")]
            for name in names:
                cells = [statistics.median(value(row, marks, [kind]) for row in columns[name]) for kind in KINDS] + [statistics.median(value(row, marks, KINDS) for row in columns[name])]
                print("| %s | %d | %s | %s |" % (server, server_cores, name, " | ".join(form % cell for cell in cells)))
        print()

    def warm_of(position, scale):
        return lambda row, marks, kinds: sum(by_kind(reading_at(row, marks[-1]))[kind][position] - by_kind(reading_at(row, marks[-3]))[kind][position] for kind in kinds) / (marks[-1] - marks[-3]) / scale

    by_thread("Warm, by thread: user instructions a request, thousands", warm_of(1, 1e3), "%.2f")
    by_thread("Warm, by thread: CPU time a request, microseconds", warm_of(0, 1e3), "%.2f")
    by_thread("From exec to the last request, by thread: CPU seconds", lambda row, marks, kinds: sum(by_kind(reading_at(row, marks[-1]))[kind][0] for kind in kinds) / 1e9, "%.3f")

    def break_even(columns, marks):
        cells = []
        for count in ("user_instructions", "ns"):
            sums = {name: [statistics.median(total(reading_at(row, mark), count) for row in columns[name]) for mark in marks] for name in names}
            warm = {name: [total(reading_at(row, marks[-1]), count) - total(reading_at(row, marks[-3]), count) for row in columns[name]] for name in names}
            for name in names[1:]:
                undecided = abs(statistics.median(warm[names[0]]) - statistics.median(warm[name])) < max(max(warm[each]) - min(warm[each]) for each in (names[0], name))
                cells.append(("~ " if undecided else "") + crossing(marks, sums[names[0]], sums[name]).replace("never: its request still costs more in the last window", "never"))
        return cells
    lines("Break-even: the request at which a JIT's sum from exec falls below %s's" % names[0], ["%s, %s" % (name, unit) for unit in ("instructions", "CPU time") for name in names[1:]], break_even)
    print("~: warm, the two columns differ by less than the starts of one of them do: where the sums cross is not decided.\n")
    lines("RSS at the last request, MB", names + versus, lambda columns, marks: (lambda cells: ["%.1f" % cell for cell in cells] + against(cells))(medians(columns, lambda row: reading_at(row, marks[-1])["rss_mb"])))


def print_tables(paths, shown_marks, summary_only=False):
    rows = [json.loads(line) for path in paths for line in open(path)]
    jobs = collections.OrderedDict()
    for row in rows:
        jobs.setdefault((row["server"], row["route"], row["server_cores"], row["plain"]), collections.OrderedDict()).setdefault(row["column"], []).append(row)
    if sum(not plain for server, route, server_cores, plain in jobs) > 1:
        print_summary(jobs)
    if summary_only:
        return
    for (server, route, server_cores, plain), columns in jobs.items():
        names = list(columns)
        some = columns[names[0]][0]
        marks = [reading["requests"] for reading in some["readings"] if not reading.get("idle")]
        shown = [mark for mark in marks if not shown_marks or mark in shown_marks or mark == 1]
        counts_kernel = all(row["counts_kernel"] for name in names for row in columns[name])
        loads = [float(row["load_average"]) for name in names for row in columns[name]]
        print("\n## %s, %s, the server on %d core%s%s\n" % (server, route if route[0] in "/123456789" else "/" + route, server_cores, "" if server_cores == 1 else "s", ", without counters" if plain else ""))
        print("%d connections, %s starts a column, load average %.0f to %.0f.\n" % (some["connections"], " | ".join(str(len(columns[name])) for name in names), min(loads), max(loads)))

        def at(row, mark):
            return next(reading for reading in row["readings"] if reading["requests"] == mark and not reading.get("idle"))

        def window_title(index):
            return "exec to the first answer" if index == 0 else "%s to %s" % (group(shown[index - 1] + 1), group(shown[index]))

        def table(title, value, form, compare=True):
            """`value(row, earlier reading or None, reading, requests)` for every window; the median over the starts in a cell."""
            print("**%s**\n" % title)
            print("| requests | %s |%s spread |" % (" | ".join(names), "".join(" %s against %s |" % (names[0], name) for name in names[1:]) if compare else ""))
            print("| --- |%s" % (" ---: |" * (len(names) + (len(names) - 1 if compare else 0) + 1)))
            for index, mark in enumerate(shown):
                cells, spreads = [], []
                for name in names:
                    values = [value(row, at(row, shown[index - 1]) if index else None, at(row, mark), mark - shown[index - 1] if index else 1) for row in columns[name]]
                    cells.append(statistics.median(values))
                    if statistics.median(values):
                        spreads.append((max(values) - min(values)) / abs(statistics.median(values)))
                ratios = ["%+.1f%%" % (100 * (cells[0] / cell - 1)) if cell else "" for cell in cells[1:]] if compare else []
                print("| %s | %s | %.1f%% |" % (window_title(index), " | ".join([form(cell) for cell in cells] + ratios), 100 * max(spreads, default=0)))
            print()

        def per_request(count, scale):
            return lambda row, earlier, reading, requests: (total(reading, count) - (total(earlier, count) if earlier else 0)) / requests / scale

        thousands = lambda cell: "%.1f" % cell if cell < 1000 else group(cell)
        if not plain:
            table("User instructions a request, all threads, thousands", per_request("user_instructions", 1e3), thousands)
            if counts_kernel:
                table("Kernel instructions a request, all threads, thousands", per_request("kernel_instructions", 1e3), thousands)
        table("CPU time a request, all threads, microseconds", per_request("ns", 1e3), thousands)
        if not plain:
            table("User cycles a request, all threads, thousands", per_request("user_cycles", 1e3), thousands)
            if counts_kernel:
                table("Kernel cycles a request, all threads, thousands", per_request("kernel_cycles", 1e3), thousands)
        def seconds_of_load(row, earlier, reading):
            return sum(each["seconds_of_load"] for each in row["readings"] if (earlier["requests"] if earlier else 0) < each["requests"] <= reading["requests"])

        print("**Milliseconds from exec to the first answer**: %s\n" % " | ".join("%s %.1f" % (name, statistics.median(1e3 * at(row, 1)["seconds"] for row in columns[name])) for name in names))
        table("Requests a second", lambda row, earlier, reading, requests: requests / seconds_of_load(row, earlier, reading) if earlier else 0, lambda cell: group(cell) if cell else "")
        table("RSS at the window's end, MB", lambda row, earlier, reading, requests: reading["rss_mb"], lambda cell: "%.1f" % cell)

        for count, scale, unit in (("user_instructions", 1e3, "user instructions a request, thousands"), ("ns", 1e3, "CPU time a request, microseconds")):
            if plain and count != "ns":
                continue
            for name in names:
                print("**%s: %s, by thread**\n" % (name, unit))
                print("| requests | %s | all |" % " | ".join(KIND_TITLES[kind] for kind in KINDS))
                print("| --- |%s" % (" ---: |" * (len(KINDS) + 1)))
                for index, mark in enumerate(shown):
                    cells = []
                    for kind in KINDS + (None,):
                        values = []
                        for row in columns[name]:
                            now, before = by_kind(at(row, mark)), by_kind(at(row, shown[index - 1])) if index else {kind: [0] * len(COUNTS) for kind in KINDS}
                            position = COUNTS.index(count)
                            values.append(sum(now[each][position] - before[each][position] for each in ([kind] if kind else KINDS)) / (mark - shown[index - 1] if index else 1) / scale)
                        cells.append(statistics.median(values))
                    print("| %s | %s |" % (window_title(index), " | ".join("%.2f" % cell if cell < 100 else group(cell) for cell in cells)))
                print()

        print("**From exec, summed over all threads**\n")
        print("| requests | %s |" % " | ".join("%s, %s" % (name, unit) for unit in (["CPU s"] if plain else ["G user instructions", "CPU s"]) for name in names))
        print("| --- |%s" % (" ---: |" * (len(names) * (1 if plain else 2))))
        for mark in shown:
            cells = []
            for count, scale in ([("ns", 1e9)] if plain else [("user_instructions", 1e9), ("ns", 1e9)]):
                cells += ["%.3f" % statistics.median(total(at(row, mark), count) / scale for row in columns[name]) for name in names]
            print("| %s | %s |" % (group(mark), " | ".join(cells)))
        print()

        tick = os.sysconf("SC_CLK_TCK")
        print("**CPU seconds from exec to request %s as /proc/<pid>/stat has them (ticks of %d ms)**\n" % (group(marks[-1]), 1000 // tick))
        print("| | %s |" % " | ".join(names))
        print("| --- |%s" % (" ---: |" * len(names)))
        for title, keys in (("user", ("user_ticks",)), ("system", ("kernel_ticks",)), ("both", ("user_ticks", "kernel_ticks"))):
            print("| %s | %s |" % (title, " | ".join("%.2f" % statistics.median(sum(at(row, marks[-1])[key] for key in keys) / tick for row in columns[name]) for name in names)))
        print()

        print("**Break-even: the request at which a JIT has used less than %s, summed from exec over all threads**\n" % names[0])
        print("| | %s |" % " | ".join(names[1:]))
        print("| --- |%s" % (" ---: |" * (len(names) - 1)))
        for count, title in (("user_instructions", "user instructions"), ("all_instructions", "user and kernel instructions"), ("ns", "CPU time")):
            if (plain and count != "ns") or (count == "all_instructions" and not counts_kernel):
                continue
            sums = {name: [statistics.median((total(at(row, mark), "user_instructions") + total(at(row, mark), "kernel_instructions")) if count == "all_instructions" else total(at(row, mark), count) for row in columns[name]) for mark in marks] for name in names}
            print("| %s | %s |" % (title, " | ".join(crossing(marks, sums[names[0]], sums[name]) for name in names[1:])))
        print()

        print("**The threads beside JavaScript's in the last window, %s to %s**\n" % (group(marks[-2] + 1), group(marks[-1])))
        print("| | %s |" % " | ".join(names))
        print("| --- |%s" % (" ---: |" * len(names)))
        for kind in KINDS[1:]:
            for title, value in (
                ("CPU microseconds a request", lambda now, before, last, earlier: (now - before) / (last["requests"] - earlier["requests"]) / 1e3),
                ("CPU milliseconds a second", lambda now, before, last, earlier: (now - before) / (last["seconds"] - earlier["seconds"]) / 1e6),
            ):
                print("| %s, %s | %s |" % (KIND_TITLES[kind], title, " | ".join("%.3f" % statistics.median(value(by_kind(at(row, marks[-1]))[kind][0], by_kind(at(row, marks[-2]))[kind][0], at(row, marks[-1]), at(row, marks[-2])) for row in columns[name]) for name in names)))
        print()

        logged = sorted({key for name in names for row in columns[name] for key in row["readings"][0].get("log", {})})
        if logged:
            print("**Lines of the server's output, by window**\n")
            print("| requests | %s |" % " | ".join("%s, %s" % (name, key) for name in names for key in logged))
            print("| --- |%s" % (" ---: |" * (len(names) * len(logged))))
            for index, mark in enumerate(marks):
                print("| %s | %s |" % ("up to the first answer" if not index else "up to %s" % group(mark), " | ".join(group(statistics.median(at(row, mark)["log"][key] - (at(row, marks[index - 1])["log"][key] if index else 0) for row in columns[name])) for name in names for key in logged)))
            print()

        guests = []
        for name in names:
            for row in columns[name]:
                last = at(row, marks[-1])
                if "busy_ticks" in last and not plain:
                    guests.append(((last["busy_ticks"] - row["busy_ticks_at_start"]) / os.sysconf("SC_CLK_TCK") - total(last, "ns") / 1e9) / (last["seconds"] * server_cores))
        if guests:
            print("Guests on the server's cores, as a share of their time: %.1f%% to %.1f%%." % (100 * min(guests), 100 * max(guests)))
        seen = collections.OrderedDict()
        for name in names:
            for row in columns[name]:
                for tid, thread in row["readings"][-1]["threads"].items():
                    seen.setdefault(kind_of(int(tid), row["readings"][-1]["pid"], thread["name"]), set()).add(re.sub(r"\d+$", "N", thread["name"]))
        print("Threads by name: %s." % "; ".join("%s: %s" % (KIND_TITLES[kind], ", ".join(sorted(seen[kind]))) for kind in KINDS if kind in seen))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--table", nargs="+", metavar="ROWS", help="print the tables of these files and do nothing else")
    parser.add_argument("--summary", action="store_true", help="with --table: only the tables that have a line for each server")
    parser.add_argument("--show", default="", help="with --table: the marks that end a row; all by default")
    parser.add_argument("--column", action="append", default=[], metavar="NAME=BUN[:FLAGS]", help="the first one is held against the others")
    parser.add_argument("--run-env", action="append", default=[], metavar="COLUMN:NAME=VALUE")
    parser.add_argument("--out", help="output file; lines are appended")
    parser.add_argument("--servers", default="express,fastify")
    parser.add_argument("--routes", default="text")
    parser.add_argument("--in-turn", action="store_true", help="one process serves all of --routes, request by request in turn, instead of a process for each")
    parser.add_argument("--cores", default="0-7", help="consecutive cores: the server's, then three for the client")
    parser.add_argument("--server-cores", default="1,4")
    parser.add_argument("--marks", default="1000,3000,10000,30000,100000,200000,500000,1000000")
    parser.add_argument("--starts", type=int, default=3)
    parser.add_argument("--connections", type=int, default=64)
    parser.add_argument("--idle-seconds", type=float, default=0, help="one more reading this long after the last request")
    parser.add_argument("--plain", action="store_true", help="no counters: time on a core alone")
    parser.add_argument("--log", action="append", default=[], metavar="NAME=REGEX")
    parser.add_argument("--modules", help="an installed node_modules, as for measure.py")
    parser.add_argument("--work", help="working directory for executables and logs")
    parser.add_argument("--reuse", action="store_true", help="the executables in --work are there already")
    parser.add_argument("--build-only", action="store_true")
    options = parser.parse_args()
    if options.table:
        return print_tables(options.table, [int(mark) for mark in options.show.split(",") if mark], options.summary)
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
    options.work, options.servers, options.spawned = os.path.abspath(options.work), options.servers.split(","), 0
    options.marks = [int(mark) for mark in options.marks.split(",")]
    options.log = dict(text.split("=", 1) for text in options.log)
    spec = build(options)
    if options.build_only:
        return
    for server in options.servers:
        chosen = [route for route in spec["routes"] if route["name"] in options.routes.split(",")]
        for routes in [chosen] if options.in_turn else [[route] for route in chosen]:
            for server_core_count in (int(count) for count in options.server_cores.split(",")):
                for start in range(options.starts):
                    for column in options.columns[start % len(options.columns):] + options.columns[:start % len(options.columns)]:
                        what = "%s %s %s on %d, start %d" % (server, route_title(routes).split(" (")[0], column["name"], server_core_count, start)
                        try:
                            row = run_start(options, routes, server, column, server_core_count, start)
                        except measure.MeasurementError as error:
                            print("FAILED %s: %s" % (what, error), flush=True)
                            continue
                        with open(options.out, "a") as out:
                            out.write(json.dumps(row) + "\n")
                        last = row["readings"][len(options.marks)]
                        print("%s: %.1f s, %.2f CPU s, %.2f G user instructions" % (what, last["seconds"], total(last, "ns") / 1e9, total(last, "user_instructions") / 1e9), flush=True)


if __name__ == "__main__":
    main()
