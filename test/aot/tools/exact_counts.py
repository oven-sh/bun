#!/usr/bin/env python3
"""Exact instruction counts of an executable built with `bun build --compile --aot`, by function, from valgrind's callgrind.

`perf/compare-builds.ts` says that a row got slower. This says where: which compiled function, which stub of the compiler, which C++ function of the runtime.

    BUN_JSC_aotMapFilePath=app.map bun build --compile --aot app.ts --outfile app       # the map names the compiled functions and stubs

    exact_counts.py run    --out app.counts --map app.map [--symbols <bun with symbols>] -- ./app <arguments>
    exact_counts.py serve  --out app.counts --map app.map [--symbols ..] --request GET:/text [--request POST:/order:@body.json].. [--warm-up 20000] [--requests 4000] -- ./server
    exact_counts.py show   app.counts [--top 40] [--per 4000]
    exact_counts.py diff   before.counts after.counts [--top 40] [--per 4000]

`run` counts a program from start to exit. `serve` starts a server that reads its port from $PORT, sends --warm-up requests with counting switched off (valgrind is then only
four times slower than the hardware), then counts exactly --requests requests, each --request in turn. `--per` divides every number, for a table per request.

Needs Linux x64, valgrind 3.19 or later and binutils. One core executes about 35 million instructions a second under callgrind.

What to know before trusting a number:
  - The counts are within 1% of `perf stat -e instructions:u`. An instruction with a `rep` prefix counts once per round here and once in all on the hardware: a memset of 6 KB is 6,000 "instructions".
  - Two runs of one server differ by about 0.4%: timers fire more often per request, because a request takes longer.
  - Address space randomization is switched off (`setarch -R`), so that the compiled code runs where the ELF file says and addresses can be matched with the map.
  - The collector runs on the program's own thread (the environment below). Only the first thread is read.
  - A JIT can be counted too (`--smc-check=all` through --valgrind-flag), but its code has no names here.
"""
import argparse, bisect, collections, json, os, re, signal, socket, subprocess, sys, time

STEADY_ENVIRONMENT = {
    "GIGACAGE_ENABLED": "0",
    "BUN_JSC_useConcurrentGC": "0",
    "BUN_JSC_numberOfGCMarkers": "1",
    "BUN_JSC_useParallelMarkingConstraintSolver": "0",
    "BUN_GC_TIMER_DISABLE": "1",
    "BUN_ENABLE_CRASH_REPORTING": "0",
    "DO_NOT_TRACK": "1",
    "NO_COLOR": "1",
}


def callgrind_command(valgrind, raw, more, command):
    return ["setarch", "x86_64", "-R", valgrind, "--tool=callgrind", "--callgrind-out-file=" + raw, "--dump-instr=yes", "--separate-threads=yes",
            "--fair-sched=no", "--compress-strings=no", "--compress-pos=no"] + more + ["--"] + command  # fmt: skip


def read_callgrind(path):
    """Returns ({address: count} for code of the executable, {(library, function): count} for everything else, the total)."""
    by_address, by_library_function = collections.Counter(), collections.Counter()
    executable = object_file = function = None
    is_line_of_a_call = False
    total = 0
    totals_line = None
    for line in open(path, errors="replace"):
        first = line[0]
        if first == "0":
            if is_line_of_a_call:  # the inclusive cost of a callee: it is counted at the callee
                is_line_of_a_call = False
                continue
            address, _, count = line.split()[:3]
            count = int(count)
            total += count
            if object_file in ("???", executable):
                by_address[int(address, 16)] += count
            else:
                by_library_function[(os.path.basename(object_file), function)] += count
        elif line.startswith("ob="):
            object_file = line[3:].strip()
        elif line.startswith("fn="):
            function = line[3:].strip()
        elif line.startswith("calls="):
            is_line_of_a_call = True
        elif line.startswith("cmd:"):
            executable = line.split()[1]
        elif line.startswith("totals:"):
            totals_line = int(line.split()[1])
    if totals_line is not None and totals_line != total:
        raise SystemExit("%s: the rows add up to %d, its last line says %d" % (path, total, totals_line))
    return by_address, by_library_function, total


def read_map(path):
    """The compiler's map: rows `F` are compiled functions, rows `T` stubs. Offsets count from the start of the image's code."""
    ranges = []
    stubs = []
    for line in open(path, errors="replace"):
        fields = line.rstrip("\n").split("\t")
        if fields[0] == "F":
            module = os.path.basename(fields[10]) if len(fields) > 10 else ""
            ranges.append((int(fields[2]), int(fields[2]) + int(fields[3]), "compiled", "%s (%s)" % (fields[7] or "-", module)))
        elif fields[0] == "T":
            stubs.append((int(fields[1]), re.sub(r"\d+", "N", fields[2])))
    stubs.sort()
    first_function = min((start for start, _, _, _ in ranges), default=0)
    for (start, name), following in zip(stubs, stubs[1:] + [(None, None)]):
        end = following[0] if following[0] is not None else max(start + 1, first_function if first_function > start else start + 4096)
        ranges.append((start, end, "stub", name))
    return sorted(ranges)


def code_base(executable):
    """Where the image's code runs without address space randomization: the last executable LOAD segment."""
    bases = [int(line.split()[2], 16) for line in subprocess.run(["readelf", "-lW", executable], capture_output=True, text=True, check=True).stdout.split("\n")
             if line.strip().startswith("LOAD") and " R E " in line]  # fmt: skip
    is_position_independent = "DYN" in subprocess.run(["readelf", "-hW", executable], capture_output=True, text=True, check=True).stdout.split("Type:")[1].split("\n")[0]
    return bases[-1] + (0x555555554000 if is_position_independent and bases[-1] < 0x100000000 else 0), 0x555555554000 if is_position_independent else 0


def read_symbols(path, load_address):
    output = subprocess.run(["nm", "-n", "-C", "--defined-only", "-S", path], capture_output=True, text=True).stdout
    symbols = []
    for line in output.split("\n"):
        fields = line.split(" ", 3)
        if len(fields) == 4 and len(fields[1]) == 16 and fields[2] in "tTwW":
            symbols.append((int(fields[0], 16) + load_address, int(fields[0], 16) + load_address + int(fields[1], 16), "runtime", fields[3]))
    return sorted(symbols)


def attribute(raw, executable, map_path, symbols_path):
    by_address, by_library_function, total = read_callgrind(raw)
    base, load_address = code_base(executable)
    ranges = sorted([(base + start, base + end, kind, name) for start, end, kind, name in (read_map(map_path) if map_path else [])]
                    + read_symbols(symbols_path or executable, load_address))  # fmt: skip
    starts = [r[0] for r in ranges]
    counts = collections.Counter()
    for address, count in by_address.items():
        index = bisect.bisect_right(starts, address) - 1
        if index >= 0 and address < ranges[index][1]:
            counts["%s\t%s" % ranges[index][2:]] += count
        else:
            counts["unnamed\t%#x" % (address & ~0xFFF)] += count
    for (library, function), count in by_library_function.items():
        counts["library\t%s: %s" % (library, function)] += count
    assert sum(counts.values()) == total
    return {"total": total, "counts": counts}


def first_thread(raw):
    folder, name = os.path.split(os.path.abspath(raw))
    files = sorted(f for f in os.listdir(folder) if f.startswith(name) and f.endswith("-01"))
    if not files:
        raise SystemExit("callgrind wrote no file for the first thread: " + raw)
    return os.path.join(folder, files[-1])


def remove_raw_files(raw):
    folder, name = os.path.split(os.path.abspath(raw))
    for f in os.listdir(folder):
        if f.startswith(name):
            os.unlink(os.path.join(folder, f))


def save(options, raw):
    result = attribute(first_thread(raw), options.command[0], options.map, options.symbols)
    json.dump(result, open(options.out, "w"))
    if not options.keep_raw:
        remove_raw_files(raw)
    print("%s: %s instructions" % (options.out, format(result["total"], ",")))


def run(options):
    raw = options.out + ".callgrind"
    status = subprocess.run(callgrind_command(options.valgrind, raw, options.valgrind_flag, options.command), env={**os.environ, **STEADY_ENVIRONMENT}).returncode
    if status:
        raise SystemExit("the program exited with %d" % status)
    save(options, raw)


def parse_request(text, port):
    method, path, *body = text.split(":", 2)
    body = (open(body[0][1:], "rb").read() if body[0].startswith("@") else body[0].encode()) if body else b""
    head = "%s %s HTTP/1.1\r\nHost: 127.0.0.1:%d\r\n" % (method, path, port)
    if body:
        head += "Content-Type: application/json\r\nContent-Length: %d\r\n" % len(body)
    return head.encode() + b"\r\n" + body


def read_response(connection, buffered):
    while True:
        end_of_head = buffered.find(b"\r\n\r\n")
        if end_of_head >= 0:
            head = buffered[:end_of_head].lower()
            length = re.search(rb"content-length: *(\d+)", head)
            if length:
                end = end_of_head + 4 + int(length.group(1))
            elif b"transfer-encoding: chunked" in head:
                last_chunk = buffered.find(b"0\r\n\r\n", end_of_head + 4)
                end = last_chunk + 5 if last_chunk >= 0 else None
            else:
                end = end_of_head + 4
            if end is not None and len(buffered) >= end:
                return buffered[:end], buffered[end:]
        received = connection.recv(65536)
        if not received:
            raise SystemExit("the server closed the connection")
        buffered += received


def serve(options):
    raw = options.out + ".callgrind"
    port = options.port or 20000 + os.getpid() % 20000
    environment = {**os.environ, **STEADY_ENVIRONMENT, "PORT": str(port), "NODE_ENV": "production"}
    server = subprocess.Popen(callgrind_command(options.valgrind, raw, ["--instr-atstart=no"] + options.valgrind_flag, options.command),
                              env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)  # fmt: skip
    try:
        deadline = time.monotonic() + 300
        while True:
            try:
                connection = socket.create_connection(("127.0.0.1", port), 1)
                break
            except OSError:
                if server.poll() is not None or time.monotonic() > deadline:
                    raise SystemExit("the server does not listen on $PORT")
                time.sleep(0.05)
        connection.settimeout(300)
        connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        requests = [parse_request(text, port) for text in options.request]
        expected = {}
        buffered = b""

        def send(count):
            nonlocal buffered
            for index in range(count):
                request = requests[index % len(requests)]
                connection.sendall(request)
                response, buffered = read_response(connection, buffered)
                status = response[9:12]
                if expected.setdefault(request, status) != status or status[:1] == b"5":
                    raise SystemExit("status %s for %r" % (status.decode(), request[:60]))

        def control(*flags):
            subprocess.run([options.callgrind_control, *flags, str(server.pid)], check=True, stdout=subprocess.DEVNULL)

        send(options.warm_up)
        control("--instr=on")
        send(len(requests) * 20)
        control("--zero")
        send(options.requests)
        control("--dump")
    finally:
        server.send_signal(signal.SIGKILL)
        server.wait()
    save(options, raw)


def by_kind(counts):
    kinds = collections.Counter()
    for name, count in counts.items():
        kinds[name.split("\t")[0]] += count
    return kinds


def show(options):
    result = json.load(open(options.file))
    per = options.per
    print("%14s  all" % format(round(result["total"] / per), ","))
    for kind, count in by_kind(result["counts"]).most_common():
        print("%14s  %s" % (format(round(count / per), ","), kind))
    print()
    for name, count in collections.Counter(result["counts"]).most_common(options.top):
        print("%14s  %s" % (format(round(count / per), ","), name.replace("\t", "  ")))


def diff(options):
    before, after = json.load(open(options.before)), json.load(open(options.after))
    per = options.per
    line = lambda was, now, name: print("%+14s  %14s > %14s  %s" % (format(round((now - was) / per), "+,"), format(round(was / per), ","), format(round(now / per), ","), name))
    line(before["total"], after["total"], "all")
    kinds_before, kinds_after = by_kind(before["counts"]), by_kind(after["counts"])
    for kind in sorted(set(kinds_before) | set(kinds_after), key=lambda kind: kinds_before[kind] - kinds_after[kind]):
        line(kinds_before[kind], kinds_after[kind], kind)
    print()
    names = set(before["counts"]) | set(after["counts"])
    moved = sorted(names, key=lambda name: -abs(after["counts"].get(name, 0) - before["counts"].get(name, 0)))
    for name in moved[: options.top]:
        line(before["counts"].get(name, 0), after["counts"].get(name, 0), name.replace("\t", "  "))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="action", required=True)
    for name in ("run", "serve"):
        command = commands.add_parser(name)
        command.add_argument("--out", required=True)
        command.add_argument("--map")
        command.add_argument("--symbols", help="a file with the symbols of the runtime: the Bun that built the executable, before it was stripped")
        command.add_argument("--valgrind", default="valgrind")
        command.add_argument("--callgrind-control", default="callgrind_control")
        command.add_argument("--valgrind-flag", action="append", default=[])
        command.add_argument("--keep-raw", action="store_true", help="keep callgrind's own files, for callgrind_annotate or kcachegrind")
        command.add_argument("command", nargs="+")
        if name == "serve":
            command.add_argument("--request", action="append", required=True, help="METHOD:/path or METHOD:/path:body or METHOD:/path:@file")
            command.add_argument("--warm-up", type=int, default=20000)
            command.add_argument("--requests", type=int, default=4000)
            command.add_argument("--port", type=int)
    command = commands.add_parser("show")
    command.add_argument("file")
    command = commands.add_parser("diff")
    command.add_argument("before")
    command.add_argument("after")
    for name in ("show", "diff"):
        commands.choices[name].add_argument("--top", type=int, default=40)
        commands.choices[name].add_argument("--per", type=float, default=1)
    options = parser.parse_args()
    {"run": run, "serve": serve, "show": show, "diff": diff}[options.action](options)


if __name__ == "__main__":
    main()
