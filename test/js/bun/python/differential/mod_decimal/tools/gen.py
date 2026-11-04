#!/usr/bin/env python3
"""Writes the scripts g_KIND_SEED.py of the directory above: a kind of operation of engine.py, a seed and a number of cases.

usage: gen.py [--count N] [--seeds A-B] [kinds...]        (default: every kind, seeds 1-2, 1000 cases, 300 of long numbers)
"""
import argparse, os
HERE = os.path.dirname(os.path.abspath(__file__))
KINDS = "arithmetic construction conversion comparison formatting contexts wrong_arguments long_numbers".split()
ap = argparse.ArgumentParser()
ap.add_argument("--count", type=int)
ap.add_argument("--seeds", default="1-2")
ap.add_argument("kinds", nargs="*", default=KINDS)
A = ap.parse_args()
first, _, last = A.seeds.partition("-")
for kind in A.kinds:
    for seed in range(int(first), int(last or first) + 1):
        name = os.path.join(HERE, "..", "g_%s_%d.py" % (kind, seed))
        with open(name, "w") as f:
            f.write("# Written by tools/gen.py.\nimport os, sys\nsys.dont_write_bytecode = True\nsys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))\nfrom engine import run\n"
                    "run(%r, %d, %d)\n" % (kind, seed, A.count or (300 if kind == "long_numbers" else 1000)))
        print(os.path.normpath(name))
