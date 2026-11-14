#!/usr/bin/env python3
"""Compares two columns of measure.py's output and prints Markdown tables.

    python3 compare.py rows.jsonl aot released [--without post]

A change is the first column relative to the second, in percent. Start i of one column and start i of the other were measured
back to back, seconds apart, and form a pair. The change of a route is the median change over its pairs, not the change of the
two values shown: on a shared machine, starts that are minutes apart differ by more than the columns do.
The change of a server is the mean over its routes; a second mean excludes the routes named with --without. "+-" is its standard error,
from the scatter of the pairs within each route: every process is a new draw of where its code and data lie in memory.
"wins 5 of 9": in five of the nine pairs the first column served more requests per second, or used fewer cycles.
Events counted with `measure.py --events` get a table of their own, per request.
A row that measure.py marked void (other work ran on its cores) is left out and named at the end.
A later line for the same server, route and column replaces an earlier one. The rows of ../go and ../rust are listed at the end.

Rows of `measure.py --layers` are printed as one table per server and route: cycles and instructions per request by layer, and
the first column minus the second. Compiled code of three layers (application, stubs, modules) stands against one layer of a JIT
build (application: all code made at run time), so their sum is shown as well.
"""
import argparse, json, statistics

import layers

NAMES = {"api-bun": "API on Bun.serve", "api-thin": "API on the thin typed framework", "api-hono": "API on Hono", "api-elysia": "API on Elysia", "api-node": "API on node:http", "api-express": "API on Express", "api-fastify": "API on Fastify", "api-koa": "API on Koa", "bun": "Bun.serve", "thin": "thin typed framework", "hono": "Hono", "elysia": "Elysia", "node": "node:http", "express": "Express", "fastify": "Fastify", "fastify-schemas": "Fastify with schemas", "tanstack": "TanStack Start"}
MEMORY = (("ready_rss_mb", "RSS at ready, MB"), ("peak_rss_mb", "peak RSS, MB"), ("private_mb", "private memory, MB"), ("first_response_ms", "first response, ms"))

parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
parser.add_argument("rows")
parser.add_argument("first")
parser.add_argument("second")
parser.add_argument("--without", default="post")
options = parser.parse_args()
without = options.without.split(",")

rows, soak_rows, layer_rows, void_rows = {}, {}, {}, []
for text in open(options.rows):
    line = json.loads(text)
    if line.get("void"):
        void_rows.append("%s %s %s" % (line["server"], line["route"], line["column"]))
        for kind in (rows, layer_rows):
            kind.pop((line["server"], line["route"], line["column"]), None)
    elif "starts" in line:
        rows[line["server"], line["route"], line["column"]] = line
    elif line["route"] == "soak":
        soak_rows[line["server"], line["column"]] = line
    elif line.get("layers"):
        layer_rows[line["server"], line["route"], line["column"]] = line
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


def standard_error(server, routes, metric):
    """Of mean_percent_change, from the scatter of the pairs within each route."""
    squares = []
    for route in routes:
        changes = [percent_change(a, b) for a, b in paired_starts(server, route, metric)]
        squares.append(statistics.variance(changes) / len(changes) if len(changes) > 1 else 0)
    return sum(squares) ** 0.5 / len(routes)


def count_wins(server, routes, metric, more_is_better):
    pairs = [pair for route in routes for pair in paired_starts(server, route, metric)]
    return "%d of %d" % (sum(1 for a, b in pairs if (a > b) == more_is_better and a != b), len(pairs))


def print_table(header, lines):
    print("| " + " | ".join(header) + " |")
    print("|" + "---|" * len(header))
    for line in lines:
        print("| " + " | ".join(line) + " |")
    print()


if servers:
    print("## %s vs. %s\n" % (options.first, options.second))
    lines = []
    for server in servers:
        routes = common_routes(server)
        filtered_routes = [route for route in routes if route not in without] or routes
        lines.append([
            NAMES.get(server, server),
            "%+.1f%% +-%.1f" % (mean_percent_change(server, routes, "requests_per_second"), standard_error(server, routes, "requests_per_second")),
            "%+.1f%%" % mean_percent_change(server, filtered_routes, "requests_per_second"),
            count_wins(server, routes, "requests_per_second", True),
            "%+.1f%% +-%.1f" % (mean_percent_change(server, routes, "cycles"), standard_error(server, routes, "cycles")),
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

    events = list(dict.fromkeys(event for line in rows.values() for event in line.get("events", [])))
    if events:
        lines = []
        for server in servers:
            for route in common_routes(server):
                line = [NAMES.get(server, server), route]
                for event in events:
                    pairs = paired_starts(server, route, event)
                    line += ["%.0f \\| %.0f" % (statistics.median(a for a, _ in pairs), statistics.median(b for _, b in pairs)), "%+.1f%%" % route_percent_change(server, route, event)]
                lines.append(line)
        print_table(["server", "route"] + [text for event in events for text in (event + " per request", "change")], lines)

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

COMPILED = ("application", "stubs", "modules")
summary = []
for (server, route, column), first in layer_rows.items():
    second = layer_rows.get((server, route, options.second))
    if column != options.first or not second:
        continue
    lines, differences = [], {}
    for layer in ["compiled"] + layers.LAYERS + ["kernel", "all"]:
        line = ["all compiled code \\| code made at run time" if layer == "compiled" else layers.TITLES.get(layer, layer).replace("|", "\\|")]
        for event in first["layers"]:
            values = []
            for each in (first, second):
                by_layer = each["layers"][event]
                values.append(sum(count for name, count in by_layer.items() if layer == "all" or name == layer or layer == "compiled" and name in COMPILED))
            line += ["%d" % values[0] if values[0] else "", "%d" % values[1] if values[1] else "", "%+d" % (values[0] - values[1])]
            if event == "cycles" and layer not in COMPILED + ("all",):
                differences[line[0]] = values[0] - values[1]
        if any(line[index] for index in range(1, len(line)) if index % 3):
            lines.append(line)
    print("### %s, %s: %s vs. %s\n" % (NAMES.get(server, server), route, options.first, options.second))
    print_table(["layer"] + [head for event in first["layers"] for head in (event + ": " + options.first, options.second, "difference")], lines)
    largest = sorted(differences.items(), key=lambda pair: -pair[1])[:3]
    total = sum(first["layers"]["cycles"].values()) - sum(second["layers"]["cycles"].values())
    summary.append([NAMES.get(server, server), route, "%+d" % total] + ["%s %+d" % pair for pair in largest])
if summary:
    print("### Which layers hold the difference in cycles per request\n")
    print_table(["server", "route", "all", "largest", "second", "third"], summary)

if void_rows:
    print("Void, because other work ran on their cores: " + ", ".join(void_rows) + ".")
