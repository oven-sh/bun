#!/usr/bin/env python3
"""drive_foreign.py COMMAND...: runs foreign_descriptors.py type by type under COMMAND, and again without the attribute that killed it,
until each type gets through. Prints every (type, attribute) that kills the interpreter."""
import subprocess, sys, os
from concurrent.futures import ThreadPoolExecutor
here = os.path.dirname(os.path.abspath(__file__))
command = sys.argv[1:]
def one(index):
    left_out, found = [], []
    while True:
        p = subprocess.run(command + ["foreign_descriptors.py", str(index)] + left_out, cwd=here, capture_output=True, text=True, errors="replace")
        marks = [l for l in p.stderr.splitlines() if l.startswith("@ ")]
        if p.returncode == 0 or not marks:
            return found if p.returncode == 0 or marks else found + [("type %d" % index, "status %d" % p.returncode, p.stderr[-300:])]
        _, type_name, name = marks[-1].split()
        what = [l for l in p.stderr.splitlines() if "ASSERTION FAILED" in l or "runtime error" in l or "ERROR: Addr" in l or "Segmentation" in l or "  #2 " in l or "  #3 " in l]
        found.append((type_name, name, " | ".join(what[:4])[:260]))
        left_out.append(name)
with ThreadPoolExecutor(8) as pool:
    for found in pool.map(one, range(90)):
        for f in found:
            print(*f, flush=True)
