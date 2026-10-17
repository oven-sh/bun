#!/usr/bin/env python3
"""Compares two columns of `measure.py --layouts K`, each over all of its layouts, and prints a Markdown table.

    python3 layouts.py rows.jsonl new previous

The columns NAME.1 to NAME.K are one build of Bun that compiled one server K times, with other padding around the code each time.
The value of a build on a route is the mean over its layouts. "one layout" is the standard deviation over them, in percent: what
the place of the code alone is worth, and the least that a comparison of two builds in one layout each can resolve.
A change is the first build relative to the second, in percent; "+-" is its standard error, sqrt(sd1^2 / K1 + sd2^2 / K2).
The change of a server is the mean over its routes, and its standard error takes the routes as independent.
A row that measure.py marked void is left out and named at the end. A later line for the same server, route and column replaces an earlier one.
"""
import argparse, json, math, statistics

parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
parser.add_argument("rows")
parser.add_argument("first")
parser.add_argument("second")
options = parser.parse_args()

rows, void_rows = {}, []
for text in open(options.rows):
    line = json.loads(text)
    key = line["server"], line["route"], line["column"]
    if line.get("void"):
        void_rows.append(" ".join(key))
        rows.pop(key, None)
    elif "starts" in line:
        rows[key] = line


def layouts_of(server, route, name, metric):
    return [line[metric] for (each, path, column), line in sorted(rows.items()) if each == server and path == route and column.rpartition(".")[0] == name and column.rpartition(".")[2].isdigit()]


def spread(values):
    return statistics.stdev(values) if len(values) > 1 else 0.0


for server in dict.fromkeys(server for server, _, _ in rows):
    print("### %s: %s against %s\n" % (server, options.first, options.second))
    print("| route | layouts | cycles | change | one layout | requests per second | change | one layout | instructions |")
    print("|---|---:|---:|---:|---:|---:|---:|---:|---:|")
    changes = {"cycles": [], "requests_per_second": []}
    for route in dict.fromkeys(route for each, route, _ in rows if each == server):
        cells = []
        for metric in ("cycles", "requests_per_second"):
            first, second = layouts_of(server, route, options.first, metric), layouts_of(server, route, options.second, metric)
            if not first or not second:
                break
            mean = statistics.mean(second)
            change = (statistics.mean(first) / mean - 1) * 100
            error = math.sqrt(spread(first) ** 2 / len(first) + spread(second) ** 2 / len(second)) / mean * 100
            changes[metric].append((change, error))
            cells += ["%.0f -> %.0f" % (mean, statistics.mean(first)), "%+.2f%% +- %.2f" % (change, error), "%.2f%%, %.2f%%" % (spread(second) / mean * 100, spread(first) / statistics.mean(first) * 100)]
        else:
            first, second = layouts_of(server, route, options.first, "instructions"), layouts_of(server, route, options.second, "instructions")
            print("| %s | %d, %d | %s | %+.2f%% |" % (route, len(second), len(first), " | ".join(cells), (statistics.mean(first) / statistics.mean(second) - 1) * 100))
    if changes["cycles"]:
        summary = ["%+.2f%% +- %.2f" % (statistics.mean(change for change, _ in each), math.sqrt(sum(error ** 2 for _, error in each)) / len(each)) for each in changes.values()]
        print("| **all** | | | **%s** | | | **%s** | | |" % tuple(summary))
    print()
if void_rows:
    print("Void, left out: " + ", ".join(void_rows))
