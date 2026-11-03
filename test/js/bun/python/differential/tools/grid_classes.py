#!/usr/bin/env python3
"""The differences grid_compare.py finds, put in classes by the shape of the two outcomes.

    grid_classes.py [--ours CMD] [--oracle CMD] [--top N] [group ...]      ($BUN_EXE and $PYTHON_ORACLE are the defaults)"""
import argparse, collections, concurrent.futures, os, re, shlex, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
parser = argparse.ArgumentParser()
parser.add_argument("--ours", default=os.environ.get("BUN_EXE", "bun"))
parser.add_argument("--oracle", default=os.environ.get("PYTHON_ORACLE", "python3.15"))
parser.add_argument("--top", type=int, default=30)
parser.add_argument("--grid", default=os.path.join(os.path.dirname(HERE), "extra", "grid", "grid.py"))
parser.add_argument("groups", nargs="*")
options = parser.parse_args()
ORACLE = shlex.split(options.oracle) + ["-I", options.grid]
OURS = shlex.split(options.ours) + [options.grid]
def groups():
    out = subprocess.run(ORACLE + ["--groups"], capture_output=True).stdout.decode().split()
    return out
def lines(cmd, g):
    p = subprocess.run(cmd + [g], capture_output=True)
    out = p.stdout.decode("utf-8", "replace").split("\n")
    found = {}
    for l in out:
        if " -> " in l:
            key, outcome = l.split(" -> ", 1)
            # The same call made twice is two calls.
            while key in found:
                key += " (again)"
            found[key] = outcome
    return found, p
def shape(s):
    s = re.sub(r"'[^']*'", "'X'", s); s = re.sub(r"-?\d+(\.\d+)?(e[+-]?\d+)?", "N", s)
    return s[:130]
def one(g):
    (a, _), (b, p) = lines(ORACLE, g), lines(OURS, g)
    classes = collections.defaultdict(list)
    for k in b:
        if a.get(k) != b[k]:
            classes[(shape(a.get(k, "(no such call)")), shape(b[k]))].append(k)
    for k in a:
        if k not in b:
            classes[(shape(a[k]), "(no such call)")].append(k)
    return g, len(b), classes, p
total = 0
with concurrent.futures.ThreadPoolExecutor(8) as pool:
    for g, n, classes, p in pool.map(one, options.groups or groups()):
        count = sum(len(v) for v in classes.values())
        total += count
        print("==", g, n, "calls,", count, "differ, in", len(classes), "classes")
        if p.returncode:
            print("   ours ended with status", p.returncode, p.stderr.decode("utf-8", "replace")[-500:])
        for (x, y), ks in sorted(classes.items(), key=lambda kv: -len(kv[1]))[:options.top]:
            print("  %5d  cpython: %s\n         ours:    %s\n         e.g. %s" % (len(ks), x, y, ks[0][:150]))
print(total, "differ")
