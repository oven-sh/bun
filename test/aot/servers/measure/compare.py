#!/usr/bin/env python3
"""Compares two columns of measure.py's output and prints Markdown tables.

    python3 compare.py rows.jsonl aot released [--without post]

A change is the first column relative to the second, in percent. Start i of one column and start i of the other were measured
back to back, seconds apart, and form a pair. The change of a route is the median change over its pairs, not the change of the
two values shown: on a shared machine, starts that are minutes apart differ by more than the columns do.
The change of a server is the mean over its routes; a second mean excludes the routes named with --without.
"wins 5 of 9": in five of the nine pairs the first column served more requests per second, or used fewer cycles.
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

rows, soak_rows = {}, {}
for text in open(options.rows):
    line = json.loads(text)
    if "starts" in line:
        rows[line["server"], line["route"], line["column"]] = line
    elif line["route"] == "soak":
        soak_rows[line["server"], line["column"]] = line
servers = list(dict.fromkeys(server for server, _, column in rows if column != "native"))


def common_routes(server):
    return [route for each, route, column in rows if each == server and column == options.first and (server, route, options.second) in rows]


def percent_change(first, second):
    return (first / second - 1) * 100


def paired_starts(server, route, metric):
    first, second = rows[server, route, options.first]["starts"], rows[server, route, options.second]["starts"]
    return [(first[start][metric], second[start][metric]) for start in first if start in second]


def route_percent_change(server, route, metric):
    return statistics.median(percent_change(a, b) for a, b in paired_starts(server, route, metric))


def mean_percent_change(server, routes, metric):
    return statistics.mean(route_percent_change(server, route, metric) for route in routes)


def count_wins(server, routes, metric, more_is_better):
    pairs = [pair for route in routes for pair in paired_starts(server, route, metric)]
    return "%d of %d" % (sum(1 for a, b in pairs if (a > b) == more_is_better and a != b), len(pairs))


def print_table(header, lines):
    print("| " + " | ".join(header) + " |")
    print("|" + "---|" * len(header))
    for line in lines:
        print("| " + " | ".join(line) + " |")
    print()


print("## %s vs. %s\n" % (options.first, options.second))
lines = []
for server in servers:
    routes = common_routes(server)
    filtered_routes = [route for route in routes if route not in without] or routes
    lines.append([
        NAMES.get(server, server),
        "%+.1f%%" % mean_percent_change(server, routes, "requests_per_second"),
        "%+.1f%%" % mean_percent_change(server, filtered_routes, "requests_per_second"),
        count_wins(server, routes, "requests_per_second", True),
        "%+.1f%%" % mean_percent_change(server, routes, "cycles"),
        "%+.1f%%" % mean_percent_change(server, filtered_routes, "cycles"),
        count_wins(server, routes, "cycles", False),
        "%+.1f%%" % mean_percent_change(server, routes, "instructions"),
        "%+.1f%%" % mean_percent_change(server, routes, "cpu_us"),
    ])
without_label = "without " + " ".join(without)
print_table(["server", "requests per second", without_label, "wins", "cycles", without_label, "wins", "instructions", "CPU time"], lines)

lines = []
for server in servers:
    routes = common_routes(server)
    line = [NAMES.get(server, server)]
    for metric, _ in MEMORY:
        first = statistics.mean(rows[server, route, options.first][metric] for route in routes)
        second = statistics.mean(rows[server, route, options.second][metric] for route in routes)
        line.append("%.1f \\| %.1f (%+.1f%%)" % (first, second, percent_change(first, second)))
    lines.append(line)
print_table(["server"] + [name for _, name in MEMORY], lines)

lines = []
for server in servers:
    for route in common_routes(server):
        first, second = rows[server, route, options.first], rows[server, route, options.second]
        line = [NAMES.get(server, server), route]
        for metric, more_is_better in (("requests_per_second", True), ("cycles", False), ("instructions", None)):
            line += ["%.0f \\| %.0f" % (first[metric], second[metric]), "%+.1f%%" % route_percent_change(server, route, metric)]
            if more_is_better is not None:
                line.append(count_wins(server, [route], metric, more_is_better))
        lines.append(line)
print_table(["server", "route", "requests per second", "change", "wins", "cycles", "change", "wins", "instructions", "change"], lines)

native = [line for line in rows.values() if line["column"] == "native"]
if native:
    print_table(["server", "route", "requests per second", "cycles", "instructions", "CPU time, us", "peak RSS, MB", "first response, ms"], [
        [line["server"], line["route"]] + ["%.0f" % line[metric] for metric in ("requests_per_second", "cycles", "instructions")] + ["%.2f" % line["cpu_us"], "%.1f" % line["peak_rss_mb"], "%.1f" % line["first_response_ms"]]
        for line in native
    ])

if soak_rows:
    # Compared with the cheapest twentieth rather than the first few, because a step can happen as early as the first twentieth.
    # For a JIT build the first twentieth is the most expensive one, so it is never the minimum.
    def instruction_growth(line):
        counts = line.get("instructions", [])
        return "%+.1f%%" % ((statistics.median(counts[15:]) / min(counts) - 1) * 100) if len(counts) == 20 else ""

    print_table(["server", "column", "requests", "RSS after 5%, 25%, 50%, 75% and 100% of the run, MB", "private memory, MB", "instructions per request", "last quarter vs. cheapest twentieth"], [
        [NAMES.get(server, server), column, "%d" % line["requests"][-1]] + [" ".join("%.1f" % line[metric][index] for index in (0, 4, 9, 14, 19)) for metric in ("rss_mb", "private_mb")] + [" ".join("%d" % line["instructions"][index] for index in (0, 4, 9, 14, 19)) if line.get("instructions") else "", instruction_growth(line)]
        for (server, column), line in soak_rows.items()
        if len(line["requests"]) == 20
    ])
