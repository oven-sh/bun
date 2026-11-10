#!/usr/bin/env python3
"""Prints how servers compiled ahead of time stand against the same sources under the JIT, from measure.py's rows.

    python3 against_the_jit.py one-core.jsonl [four-cores.jsonl] [--ours aot] [--jit jit] [--other NAME]

First the count: ahead | level (within 2%) | behind. A row of the count is one server and one measure; its number is the geometric mean
over the routes of ours relative to the JIT. Then every measure by server, worst first, and requests per second by route, worst first.
"+" is better for the compiled server, whatever the measure. `--other` adds a third column of the rows, for comparison: `own` is the same sources
built without --aot by the Bun that compiled ours, so both run on one runtime, one set of built-in modules and one build of the native code.
A row that measure.py marked void (other work ran on its cores) is used and counted at the top: measure again on idle cores.
"""
import argparse, json, math, statistics

NAMES = {"bun": "Bun.serve", "thin": "thin typed framework", "hono": "Hono", "elysia": "Elysia", "node": "node:http", "koa": "Koa", "tanstack": "TanStack Start", "express": "Express", "fastify": "Fastify", "fastify-schemas": "Fastify with schemas"}

parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
parser.add_argument("one")
parser.add_argument("four", nargs="?")
parser.add_argument("--ours", default="aot")
parser.add_argument("--jit", default="jit")
parser.add_argument("--other")
parser.add_argument("--count-only", action="store_true")
parser.add_argument("--tsv", help="also writes server, measure, ours, the JIT and the other column, the means over the routes")
options = parser.parse_args()
OTHER_TITLE = "the JIT of the Bun that compiled it" if options.other == "own" else options.other


def read(path):
    rows = {}
    for line in open(path) if path else []:
        row = json.loads(line)
        if row.get("requests_per_second") and not row["failures"]:
            for event in row.get("events") or []:
                row[event] = statistics.median(start[event] for start in row["starts"].values())
            rows[row["server"], row["route"], row["column"]] = row
    return rows


one, four = read(options.one), read(options.four)
MISPREDICTED = "branch-misses"
MISSES = next((event for row in one.values() for event in row.get("events") or [] if event != MISPREDICTED), "")
MEASURES = [
    ("requests per second, one core", one, "requests_per_second", 1, True, "%.0f"),
    ("requests per second, four cores", four, "requests_per_second", 1, True, "%.0f"),
    ("p50 latency at a fixed rate, us", one, "rate_p50_us", 1, False, "%.0f"),
    ("p99 latency at a fixed rate, us", one, "rate_p99_us", 1, False, "%.0f"),
    ("CPU seconds for 100,000 requests", one, "cpu_us", 0.1, False, "%.2f"),
    ("thousand instructions per request", one, "instructions", 1e-3, False, "%.1f"),
    ("L1 instruction-cache misses per request", one, MISSES, 1, False, "%.0f"),
    ("peak RSS under load, MB", one, "peak_rss_mb", 1, False, "%.1f"),
    ("peak private memory under load, MB", one, "private_mb", 1, False, "%.1f"),
    ("first correct response, ms", one, "first_response_ms", 1, False, "%.1f"),
    ("executable, MB", one, "executable_mb", 1, False, "%.1f"),
]
servers = [server for server in NAMES if any(key[0] == server for key in list(one) + list(four))]


def routes_of(rows, server):
    return sorted({key[1] for key in rows if key[0] == server and all((server, key[1], column) in rows for column in (options.ours, options.jit))})


def gain(rows, server, name, column, larger_is_better):
    ratios = [rows[server, route, options.ours][name] / rows[server, route, column][name] for route in routes_of(rows, server) if (server, route, column) in rows and rows[server, route, column].get(name) and rows[server, route, options.ours].get(name)]
    if not ratios:
        return None
    mean = math.exp(sum(map(math.log, ratios)) / len(ratios))
    return 100 * (mean - 1) if larger_is_better else 100 * (1 / mean - 1)


def mean_of(rows, server, name, column):
    values = [rows[server, route, column][name] for route in routes_of(rows, server) if (server, route, column) in rows and rows[server, route, column].get(name) is not None]
    return sum(values) / len(values) if values else None


def tally(gains):
    gains = [each for each in gains if each is not None]
    return sum(1 for each in gains if each > 2), sum(1 for each in gains if -2 <= each <= 2), sum(1 for each in gains if each < -2), len(gains)


by_route = {name: sorted((100 * (rows[server, route, options.ours]["requests_per_second"] / rows[server, route, options.jit]["requests_per_second"] - 1), server, route) for server in servers for route in routes_of(rows, server)) for name, rows in (("one core", one), ("four cores", four))}
print("Against the JIT: ahead %d | level %d | behind %d of %d rows (a server and a measure)" % tally([gain(rows, server, name, options.jit, larger) for _, rows, name, _, larger, _ in MEASURES for server in servers]))
if options.other:
    print("Against %s: ahead %d | level %d | behind %d of %d rows" % ((OTHER_TITLE,) + tally([gain(rows, server, name, options.other, larger) for _, rows, name, _, larger, _ in MEASURES for server in servers])))
for name, gains in by_route.items():
    if gains:
        print("Requests per second by route, %s: ahead %d | level %d | behind %d of %d" % ((name,) + tally([each[0] for each in gains])))
if options.tsv:
    with open(options.tsv, "w") as out:
        for title, rows, name, scale, _, _ in MEASURES:
            for server in servers:
                values = [mean_of(rows, server, name, column) if column else None for column in (options.ours, options.jit, options.other)]
                if values[0] is not None and values[1] is not None:
                    out.write("%s\t%s\t%s\n" % (NAMES[server], title, "\t".join("" if value is None else "%.4f" % (value * scale) for value in values)))
if options.count_only:
    raise SystemExit

void = sum(1 for rows in (one, four) for row in rows.values() if row.get("void"))
unsettled = ["%s /%s %s" % key for key, row in one.items() if not row.get("settled")]
print("\n%d of %d rows had other work on their cores. %d never settled within 2%% while they were warmed up%s" % (void, len(one) + len(four), len(unsettled), ": " + ", ".join(unsettled[:8]) if unsettled else "."))
other_head, other_rule = (" %s | against it |" % OTHER_TITLE, "---:|---:|") if options.other else ("", "")
for title, rows, name, scale, larger, form in MEASURES:
    gains = sorted((against_jit, server) for server in servers for against_jit in [gain(rows, server, name, options.jit, larger)] if against_jit is not None)
    if not gains:
        continue
    print("\n| %s (mean of the routes) | compiled | the JIT | against the JIT |%s\n|---|---:|---:|---:|%s" % (title, other_head, other_rule))
    for against_jit, server in gains:
        cells = [form % (mean_of(rows, server, name, column) * scale) for column in (options.ours, options.jit)] + ["%+.1f%%" % against_jit]
        if options.other:
            value, against_other = mean_of(rows, server, name, options.other), gain(rows, server, name, options.other, larger)
            cells += [form % (value * scale) if value is not None else "-", "%+.1f%%" % against_other if against_other is not None else "-"]
        print("| %s | %s |" % (NAMES[server], " | ".join(cells)))
for name, rows in (("one core", one), ("four cores", four)):
    if by_route[name]:
        print("\n| requests per second by route, %s | compiled | the JIT | against the JIT | thousand instructions: compiled | the JIT | thousand cycles: compiled | the JIT | instruction-cache misses: compiled | the JIT | mispredicted branches: compiled | the JIT |" % name)
        print("|---|" + "---:|" * 11)
        for against_jit, server, route in by_route[name]:
            ours, jit = rows[server, route, options.ours], rows[server, route, options.jit]
            counted = ["%.0f" % row[event] if event in row else "-" for event in (MISSES, MISPREDICTED) for row in (ours, jit)]
            print("| %s /%s | %.0f | %.0f | %+.1f%% | %.1f | %.1f | %.1f | %.1f | %s |" % (NAMES[server], route, ours["requests_per_second"], jit["requests_per_second"], against_jit, ours["instructions"] / 1e3, jit["instructions"] / 1e3, ours["cycles"] / 1e3, jit["cycles"] / 1e3, " | ".join(counted)))
