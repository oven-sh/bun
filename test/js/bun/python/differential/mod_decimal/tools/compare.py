#!/usr/bin/env python3
"""Runs ../engine.py under two interpreters with the same seeds and reports the lines that differ.

usage: compare.py --reference CMD --ours CMD [--kinds a,b] [--seeds FIRST-LAST] [--count N] [-j N] [--show N]

The reference has to be a CPython with its C module: `import _decimal` works there.
"""
import argparse, os, shlex, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
KINDS = "arithmetic construction conversion comparison formatting contexts wrong_arguments long_numbers".split()
ap = argparse.ArgumentParser()
ap.add_argument("--reference", required=True)
ap.add_argument("--ours", required=True)
ap.add_argument("--kinds", default=",".join(KINDS))
ap.add_argument("--seeds", default="1-4")
ap.add_argument("--count", type=int, default=5000)
ap.add_argument("-j", type=int, default=4)
ap.add_argument("--show", type=int, default=6)
ap.add_argument("--timeout", type=int, default=1800)
A = ap.parse_args()
theirs = mine = os.path.join(HERE, "..", "engine.py")


def run(cmd, script, kind, seed):
    p = subprocess.run(shlex.split(cmd) + [script, kind, str(seed), str(A.count)], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=A.timeout)
    return p.returncode, p.stdout.decode("utf-8", "backslashreplace").split("\n"), p.stderr.decode("utf-8", "backslashreplace")


def one(job):
    kind, seed = job
    try:
        a = run(A.reference, theirs, kind, seed)
        b = run(A.ours, mine, kind, seed)
    except subprocess.TimeoutExpired as e:
        return kind, seed, -1, ["TIMEOUT %s" % e.cmd[0]]
    out = []
    bad = 0
    if a[0] != b[0]:
        out.append("exit status %s / %s: %s" % (a[0], b[0], b[2][-1500:]))
        bad += 1
    for x, y in zip(a[1], b[1]):
        if x != y:
            bad += 1
            if bad <= A.show:
                out.append("  want %s\n  got  %s" % (x[:600], y[:600]))
    if len(a[1]) != len(b[1]):
        bad += 1
        out.append("%d lines / %d lines" % (len(a[1]), len(b[1])))
    return kind, seed, bad, out


first, _, last = A.seeds.partition("-")
jobs = [(k, s) for k in A.kinds.split(",") for s in range(int(first), int(last or first) + 1)]
total = 0
with ThreadPoolExecutor(A.j) as ex:
    for kind, seed, bad, out in ex.map(one, jobs):
        total += bad != 0
        print("%-16s seed %-4d %s" % (kind, seed, "same" if not bad else "%d DIFFERENT" % bad))
        for line in out:
            print(line)
        sys.stdout.flush()
print("%d runs of %d cases, %d with differences" % (len(jobs), A.count, total))
sys.exit(1 if total else 0)
