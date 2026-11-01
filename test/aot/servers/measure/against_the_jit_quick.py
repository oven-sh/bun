#!/usr/bin/env python3
"""Prints requests per second by route from measure.py's rows: compiled ahead of time, the JIT of the Bun that compiled it, the other Bun's JIT. Worst first.

    python3 against_the_jit_quick.py rows.jsonl [more-rows.jsonl ..]

A number is the median of the starts in all the files. The spread is the distance from the slowest start to the fastest, the larger of the first two columns'.
A route is level where the two are within 3%.
"""
import json, statistics, sys

starts = {}
for path in sys.argv[1:]:
    for line in open(path):
        row = json.loads(line)
        if row.get("requests_per_second") and not row["failures"]:
            starts.setdefault((row["server"], row["route"]), {}).setdefault(row["column"], []).extend(start["requests_per_second"] for start in row["starts"].values())

table = []
for (server, route), columns in starts.items():
    if all(column in columns for column in ("aot", "own", "jit")):
        aot, own, jit = (statistics.median(columns[column]) for column in ("aot", "own", "jit"))
        spread = max((max(columns[column]) - min(columns[column])) / statistics.median(columns[column]) for column in ("aot", "own"))
        table.append((aot / own, server, route, aot, own, jit, spread, len(columns["aot"])))
table.sort()


def count(ratios):
    return "%d ahead | %d level | %d behind" % (sum(ratio > 1.03 for ratio in ratios), sum(0.97 <= ratio <= 1.03 for ratio in ratios), sum(ratio < 0.97 for ratio in ratios))


print("requests per second, one core, warm; %d routes, %d to %d starts" % (len(table), min(row[7] for row in table), max(row[7] for row in table)))
print("against the JIT of the Bun that compiled it: %s" % count([row[0] for row in table]))
print("against the other Bun's JIT:                 %s" % count([row[3] / row[5] for row in table]))
print("%-16s %-8s %9s %9s %9s %8s %8s %7s" % ("server", "route", "compiled", "own JIT", "other", "/ own", "/ other", "spread"))
for ratio, server, route, aot, own, jit, spread, _ in table:
    print("%-16s %-8s %9.0f %9.0f %9.0f %8.2f %8.2f %6.1f%%" % (server, route, aot, own, jit, ratio, aot / jit, spread * 100))
