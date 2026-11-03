#!/usr/bin/env python3
"""Writes extra/grid_NN_*.py: samples of the grid (extra/grid/grid.py) that are small enough for a debug build.

Each script makes about each Nth call of some groups and prints the digests. N is the smallest of PRIMES that keeps a group under
LIMIT calls. All the calls are made by grid_compare.py and grid_classes.py, with a release build. Run this again whenever grid.py
changes, and run.py --update after it: the scripts carry the digest of grid.py, so that their .expected files are seen to be out of date.

    grid_scripts.py [CPython]      (default: $PYTHON_ORACLE, or python3.15)"""
import concurrent.futures, glob, hashlib, os, re, shlex, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
EXTRA = os.path.realpath(os.path.join(HERE, "..", "extra"))
GRID = os.path.join(EXTRA, "grid", "grid.py")
ORACLE = shlex.split(sys.argv[1] if len(sys.argv) > 1 else os.environ.get("PYTHON_ORACLE", "python3.15")) + ["-I"]
LIMIT = 3000
WEIGHT = {"characters": 60, "mutation": 5, "copies": 3, "iterators": 2, "exceptions": 3, "calls": 2}  # A call of these does so many times the work of others.
PRIMES = [1, 2, 3, 5, 7, 11, 13, 17, 23, 31, 41, 53, 71, 97, 127, 167, 211, 307, 401]

def size(group, every):
    code = "import sys; sys.path.insert(0, %r); import grid; grid.run_groups([%r], every=%d)" % (os.path.dirname(GRID), group, every)
    total = 0
    for line in subprocess.run(ORACLE + ["-c", code], capture_output=True, text=True).stdout.splitlines():
        match = re.fullmatch(r"\S+ .+ (\d+) [0-9a-f]{12}", line)
        if not match:
            raise SystemExit("not a digest: %r" % line)
        total += int(match.group(1))
    return total * WEIGHT.get(group, 1)

def choose(group):
    whole = size(group, 1)
    for every in PRIMES:
        count = whole if every == 1 else size(group, every)
        if count <= LIMIT:
            break
    return group, every, count, whole

groups = subprocess.run(ORACLE + [GRID, "--groups"], capture_output=True, text=True).stdout.split()
with concurrent.futures.ThreadPoolExecutor(8) as pool:
    chosen = list(pool.map(choose, groups))
scripts, current, room = [], [], LIMIT
for group, every, count, _ in chosen:
    if current and count > room:
        scripts.append(current); current, room = [], LIMIT
    current.append((group, every)); room -= count
if current: scripts.append(current)
for old in glob.glob(os.path.join(EXTRA, "grid_[0-9]*.py")):
    os.remove(old)
digest = hashlib.md5(open(GRID, "rb").read()).hexdigest()[:12]
for number, script in enumerate(scripts, 1):
    name = "grid_%02d_%s.py" % (number, script[0][0] if len(script) == 1 else script[0][0] + "_to_" + script[-1][0])
    with open(os.path.join(EXTRA, name), "w") as f:
        f.write("# A sample of the calls in grid/grid.py (version %s): digests of what comes out of them.\n" % digest)
        f.write("import os, sys\nsys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), \"grid\"))\nimport grid\n")
        for group, every in script:
            f.write("grid.run_groups([%r], every=%d)\n" % (group, every))
print(len(scripts), "scripts,", sum(c[3] // WEIGHT.get(c[0], 1) for c in chosen), "calls in all,", sum(c[2] // WEIGHT.get(c[0], 1) for c in chosen), "in the samples; the largest sample:", max(c[2] for c in chosen), [c[:3] for c in chosen if c[2] > LIMIT])
