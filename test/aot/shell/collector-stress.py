#!/usr/bin/env python3
"""Runs the programs in ../programs with quick.py twice: as they are, and with the garbage collector at work all the time.

The second time the `jsc` shell collects at every n-th allocation that leaves the fast path, and overwrites every cell it frees, but
only where the compiled program runs, not where it is compiled. A value that compiled code still uses and the collector cannot
find is then gone at once, every time, instead of once in a million runs. Run it on Linux x64 too: with fewer registers, fewer stale
copies of a pointer lie about that would keep such a value alive by accident.

    JSC=<jsc> SEMA=<bun-sema> PLAIN=<any bun> python3 test/aot/shell/collector-stress.py [-j <jobs>] [--every <n>] [--young] [--part <i>/<n>] <program>... | all

    --every <n>     collect at every n-th such allocation (default: 3). 1 and 2 find other things and take longer
    --young         the collections are young ones. A full collection finds everything from the roots; a young one relies on the
                    write barriers, so only this finds a store of a new cell into an old one that compiled code makes without one
    --part <i>/<n>  of `all`: every n-th program, from the i-th on. ../collector-stress/*.test.ts deal the programs out so
    the rest        as for quick.py, whose top says how to build the tools

Prints one line per program that is `same` as it is and not the same under stress, and exits with 1 if there is any. Not counted:
    a program that runs out of time under stress; their number is printed
    the programs in collector-stress-known.txt: they count calls into the runtime or cells of the heap, and a collection empties
    the caches that keep those numbers low
"""
import os, stat, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import quick


def verdicts(arguments, jsc, work, options):
    env = {**os.environ, "JSC": jsc, "WORK": work, "COLLECTOR_STRESS_OPTIONS": options}
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
    if "--part" in arguments:
        at = arguments.index("--part")
        part, parts = map(int, arguments[at + 1].split("/"))
        del arguments[at:at + 2]
        arguments[arguments.index("all"):] = quick.all_programs()[part - 1::parts]
    if not arguments or "JSC" not in os.environ:
        sys.exit(__doc__)
    known = {line.split()[0] for line in open(HERE + "/collector-stress-known.txt") if line.strip() and not line.startswith("#")}
    with tempfile.TemporaryDirectory(prefix="aot-collector-stress") as folder:
        wrapper = folder + "/jsc"
        open(wrapper, "w").write('#!/bin/sh\ncase " $* " in\n*" --aotImagePath="*) exec "%s" $COLLECTOR_STRESS_OPTIONS "$@";;\n*) exec "%s" "$@";;\nesac\n' % (os.environ["JSC"], os.environ["JSC"]))
        os.chmod(wrapper, os.stat(wrapper).st_mode | stat.S_IXUSR)
        plainly = verdicts(arguments, wrapper, folder + "/plainly", "")
        stressed = verdicts(arguments, wrapper, folder + "/stressed", f"--slowPathAllocsBetweenGCs={every} --useZombieMode=1 --scribbleFreeCells=1" + (" --useEdenCollectionsAtSlowPathAllocs=1" if young else ""))
    judged = [name for name, verdict in plainly.items() if verdict.startswith("same") and name not in known]
    slow = [name for name in judged if stressed.get(name, "").startswith("DIFFERS: timed out")]
    failures = [name for name in judged if name not in slow and not stressed.get(name, "").startswith("same")]
    for name in failures:
        print(f"{name}: {stressed.get(name, 'no verdict')}")
    print(f"{len(judged)} programs, {len(failures)} fail under stress alone, {len(slow)} run out of time")
    sys.exit(1 if failures else 0)
