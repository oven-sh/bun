#!/usr/bin/env python3
"""Compares two columns of what measure.py wrote, as Markdown tables.

    python3 compare.py rows.jsonl aot released [--without post]

A change is that of the first column against the second, in percent. Start i of one column and start i of the other were
measured in turn, seconds apart, and make a pair. The change of a route is the median of the changes of its pairs, not the
change of the two values shown: on a machine that others use, starts that are minutes apart differ by more than the columns do.
For a server it is the mean over its routes, and a second mean leaves out the routes named with --without.
"better in 5 of 9": in five of the nine pairs the first column served more requests per second, or spent fewer cycles.
A later line for the same server, route and column replaces an earlier one. The rows of ../go and ../rust are listed at the end.
"""
import argparse, json, statistics

NAMES = {"bun": "Bun.serve", "hono": "Hono", "elysia": "Elysia", "node": "node:http", "express": "Express", "fastify": "Fastify", "tanstack": "TanStack Start"}
MEMORY = (("ready_rss_mb", "RSS at ready, MB"), ("peak_rss_mb", "peak RSS, MB"), ("private_mb", "private memory, MB"), ("first_response_ms", "first response, ms"))

parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
parser.add_argument("rows")
parser.add_argument("first")
parser.add_argument("second")
parser.add_argument("--without", default="post")
options = parser.parse_args()
without = options.without.split(",")

rows, soaked = {}, {}
for text in open(options.rows):
    line = json.loads(text)
    if "starts" in line:
        rows[line["server"], line["route"], line["column"]] = line
    elif line["route"] == "soak":
        soaked[line["server"], line["column"]] = line
servers = list(dict.fromkeys(server for server, _, column in rows if column != "native"))


def routes_of(server):
    return [route for each, route, column in rows if each == server and column == options.first and (server, route, options.second) in rows]


def change(first, second):
    return (first / second - 1) * 100


def pairs_of(server, route, metric):
    first, second = rows[server, route, options.first]["starts"], rows[server, route, options.second]["starts"]
    return [(first[start][metric], second[start][metric]) for start in first if start in second]


def route_change(server, route, metric):
    return statistics.median(change(a, b) for a, b in pairs_of(server, route, metric))


def mean_change(server, routes, metric):
    return statistics.mean(route_change(server, route, metric) for route in routes)


def better(server, routes, metric, more_is_better):
    pairs = [pair for route in routes for pair in pairs_of(server, route, metric)]
    return "%d of %d" % (sum(1 for a, b in pairs if (a > b) == more_is_better and a != b), len(pairs))


def table(head, lines):
    print("| " + " | ".join(head) + " |")
    print("|" + "---|" * len(head))
    for line in lines:
        print("| " + " | ".join(line) + " |")
    print()


print("## %s against %s\n" % (options.first, options.second))
lines = []
for server in servers:
    routes = routes_of(server)
    some = [route for route in routes if route not in without] or routes
    lines.append([
        NAMES.get(server, server),
        "%+.1f%%" % mean_change(server, routes, "requests_per_second"),
        "%+.1f%%" % mean_change(server, some, "requests_per_second"),
        better(server, routes, "requests_per_second", True),
        "%+.1f%%" % mean_change(server, routes, "cycles"),
        "%+.1f%%" % mean_change(server, some, "cycles"),
        better(server, routes, "cycles", False),
        "%+.1f%%" % mean_change(server, routes, "instructions"),
        "%+.1f%%" % mean_change(server, routes, "cpu_us"),
    ])
less = "without " + " ".join(without)
table(["server", "requests per second", less, "better in", "cycles", less, "better in", "instructions", "CPU time"], lines)

lines = []
for server in servers:
    routes = routes_of(server)
    line = [NAMES.get(server, server)]
    for metric, _ in MEMORY:
        first = statistics.mean(rows[server, route, options.first][metric] for route in routes)
        second = statistics.mean(rows[server, route, options.second][metric] for route in routes)
        line.append("%.1f \\| %.1f (%+.1f%%)" % (first, second, change(first, second)))
    lines.append(line)
table(["server"] + [name for _, name in MEMORY], lines)

lines = []
for server in servers:
    for route in routes_of(server):
        first, second = rows[server, route, options.first], rows[server, route, options.second]
        line = [NAMES.get(server, server), route]
        for metric, more_is_better in (("requests_per_second", True), ("cycles", False), ("instructions", None)):
            line += ["%.0f \\| %.0f" % (first[metric], second[metric]), "%+.1f%%" % route_change(server, route, metric)]
            if more_is_better is not None:
                line.append(better(server, [route], metric, more_is_better))
        lines.append(line)
table(["server", "route", "requests per second", "change", "better in", "cycles", "change", "better in", "instructions", "change"], lines)

native = [line for line in rows.values() if line["column"] == "native"]
if native:
    table(["server", "route", "requests per second", "cycles", "instructions", "CPU time, us", "peak RSS, MB", "first response, ms"], [
        [line["server"], line["route"]] + ["%.0f" % line[metric] for metric in ("requests_per_second", "cycles", "instructions")] + ["%.2f" % line["cpu_us"], "%.1f" % line["peak_rss_mb"], "%.1f" % line["first_response_ms"]]
        for line in native
    ])

if soaked:
    # The cheapest of all, not the first few: a step may come as early as the first twentieth. A JIT's first one is its dearest.
    def dearer(line):
        counts = line.get("instructions", [])
        return "%+.1f%%" % ((statistics.median(counts[15:]) / min(counts) - 1) * 100) if len(counts) == 20 else ""

    table(["server", "column", "requests", "RSS after a twentieth, a quarter, a half, three quarters and all of them, MB", "private memory, MB", "instructions per request", "the last quarter against the cheapest twentieth"], [
        [NAMES.get(server, server), column, "%d" % line["requests"][-1]] + [" ".join("%.1f" % line[metric][index] for index in (0, 4, 9, 14, 19)) for metric in ("rss_mb", "private_mb")] + [" ".join("%d" % line["instructions"][index] for index in (0, 4, 9, 14, 19)) if line.get("instructions") else "", dearer(line)]
        for (server, column), line in soaked.items()
        if len(line["requests"]) == 20
    ])
