#!/usr/bin/env python3
"""Runs extra/grid/grid.py under CPython and under Bun, group by group, and shows where they differ.

    grid_compare.py [-j N] [--ours CMD] [--oracle CMD] [--lines N] [group ...]      ($BUN_EXE and $PYTHON_ORACLE are the defaults)

For every (group, name) whose digest differs, the calls are run again one per line, and the first N differing lines are printed."""
import argparse, concurrent.futures, os, re, shlex, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
GRID = os.path.join(os.path.dirname(HERE), "extra", "grid", "grid.py")

def run(command, *args):
    return subprocess.run(command + [GRID, *args], capture_output=True, timeout=3000)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("-j", type=int, default=8)
    parser.add_argument("--ours", default=os.environ.get("BUN_EXE", "bun"))
    parser.add_argument("--oracle", default=os.environ.get("PYTHON_ORACLE", "python3.15"))
    parser.add_argument("--lines", type=int, default=6)
    parser.add_argument("groups", nargs="*")
    options = parser.parse_args()
    ours, oracle = shlex.split(options.ours), shlex.split(options.oracle) + ["-I"]
    groups = options.groups or run(oracle, "--groups").stdout.decode().split()

    def compare(group):
        theirs, mine = run(oracle, group), run(ours, group)
        a, b = theirs.stdout.split(b"\n"), mine.stdout.split(b"\n")
        report = []
        if mine.returncode:
            report.append("  ours ended with status %d: %s" % (mine.returncode, mine.stderr.decode("utf-8", "replace")[-600:]))
        def key(line): return line.split(b" -> ", 1)[0]
        theirs_by_key = {key(l): l for l in a if l}
        differing = {}
        total = 0
        for line in b:
            if not line: continue
            total += 1
            other = theirs_by_key.pop(key(line), None)
            if other != line:
                differing.setdefault(name_of(group, key(line)), []).append((other, line))
        for k, l in theirs_by_key.items():
            differing.setdefault(name_of(group, k), []).append((l, None))
        return group, total, differing, report

    def name_of(group, call):
        text = call.decode("utf-8", "replace")
        if group in ("operators", "unary", "builtins", "format", "subscript"):
            return group
        rest = text.split(").", 1)[-1] if text.startswith(("bytearray(", "memoryview(", "range(", "slice(", "frozenset(", "object(", "set(")) else text
        m = re.search(r"\.([A-Za-z_][A-Za-z_0-9]*)(\(|$)", rest if rest != text else text)
        return m.group(1) if m else "?"

    grand, bad = 0, 0
    with concurrent.futures.ThreadPoolExecutor(options.j) as pool:
        for group, total, differing, report in pool.map(compare, groups):
            count = sum(len(v) for v in differing.values())
            grand += total; bad += count
            print("== %s: %d calls, %d differ" % (group, total, count))
            for line in report: print(line)
            for name, pairs in sorted(differing.items(), key=lambda kv: -len(kv[1])):
                print("  -- %s: %d" % (name, len(pairs)))
                for theirs, mine in pairs[:options.lines]:
                    print("     cpython: %s" % (theirs.decode("utf-8", "replace")[:230] if theirs else "(no such call)"))
                    print("     ours:    %s" % (mine.decode("utf-8", "replace")[:230] if mine else "(no such call)"))
            sys.stdout.flush()
    print("%d calls, %d differ" % (grand, bad))

main()
