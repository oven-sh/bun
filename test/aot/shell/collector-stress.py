#!/usr/bin/env python3
"""Runs the programs in ../programs with quick.py twice: normally, and under collector stress.

In the second run the `jsc` shell collects at every n-th slow-path allocation and scribbles over every cell it frees. Only the run of the
image is stressed, not the compile. A value that compiled code still uses and the collector cannot find is then destroyed at once, every
time, instead of once in a million runs. Run it on Linux x64 too: with fewer registers, fewer stale copies of a pointer are left to keep
such a value alive by accident.

    JSC=<jsc> TESTAOT=<testaot> FRONT_END=<bun> PLAIN=<any bun> python3 test/aot/shell/collector-stress.py [-j <jobs>] [--every <n>] [--young] [--part <i>/<n>] <program>... | all

    --every <n>     collect at every n-th slow-path allocation (default: 3). 1 and 2 find other bugs and take longer
    --young         run Eden collections. A full collection finds everything from the roots. An Eden collection relies on the write
                    barriers, so only this finds a store of a new cell into an old one that compiled code does without a barrier
    --part <i>/<n>  with `all`: every n-th program, starting at the i-th, and all of $WRITTEN (quick.py). ../collector-stress/*.test.ts split the programs this way
    the rest        as for quick.py. toolchain.py's docstring says how to build the tools

Prints one line per program that is `same` normally and not under stress, and one per program that dies of a signal normally, and exits
with 1 if there is one. Not counted:
    a program that times out under stress; their number is printed
    the programs in collector-stress-known.txt: they count runtime calls or heap cells, and a collection empties the caches that
    keep those numbers low
Not run as part of `all`: the programs in collector-stress-slow.txt, which always time out
"""
import os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import quick, toolchain


def verdicts(arguments, work, options):
    env = {**os.environ, "WORK": work, "RUN_OPTIONS": options}
    output = subprocess.run([sys.executable, HERE + "/quick.py", *arguments], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT).stdout.decode(errors="replace")
    return dict(line.split(": ", 1) for line in output.split("\n") if ": " in line)


if __name__ == "__main__":
    arguments = sys.argv[1:]
    every = 3
    if "--every" in arguments:
        at = arguments.index("--every")
        every = int(arguments[at + 1])
        del arguments[at:at + 2]
    young = "--young" in arguments
    if young:
        arguments.remove("--young")
    part, parts = 1, 1
    if "--part" in arguments:
        at = arguments.index("--part")
        part, parts = map(int, arguments[at + 1].split("/"))
        del arguments[at:at + 2]
    if "all" in arguments:
        slow = {line.split()[0] for line in open(HERE + "/collector-stress-slow.txt") if not line.startswith("#") and ("young" if young else "full") in line.split(None, 1)[1]}
        arguments[arguments.index("all"):] = [name for name in quick.all_programs() if name not in slow][part - 1::parts] + quick.written_programs()
    if not arguments:
        sys.exit(__doc__)
    for name in ("JSC", "TESTAOT", "FRONT_END", "PLAIN"):
        toolchain.tool(name)
    known = {line.split()[0] for line in open(HERE + "/collector-stress-known.txt") if line.strip() and not line.startswith("#")}
    with tempfile.TemporaryDirectory(prefix="aot-collector-stress") as folder:
        baseline = verdicts(arguments, folder + "/baseline", "")
        judged = [name for name, verdict in baseline.items() if verdict.startswith("same") and name not in known]
        jobs = arguments[:2] if arguments[0] == "-j" else []
        stressed = verdicts([*jobs, *judged], folder + "/stressed", f"--slowPathAllocsBetweenGCs={every} --useZombieMode=1 --scribbleFreeCells=1" + (" --useEdenCollectionsAtSlowPathAllocs=1" if young else "")) if judged else {}
    timed_out = [name for name in judged if stressed.get(name, "").startswith("DIFFERS: timed out")]
    failures = [name for name in judged if name not in timed_out and not stressed.get(name, "").startswith("same")]
    for name in failures:
        print(f"{name}: {stressed.get(name, 'no verdict')}")
    died = [name for name, verdict in baseline.items() if "died of signal" in verdict]
    for name in died:
        print(f"{name}: {baseline[name]}")
    print(f"{len(judged)} programs, {len(failures)} fail under stress alone, {len(timed_out)} run out of time")
    sys.exit(1 if failures or died else 0)
