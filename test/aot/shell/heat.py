#!/usr/bin/env python3
"""Runs the programs in ../programs with quick.py, compiled as if every function were hot, as if every function were cold, or as if none were either.

The compiler estimates how hot each function is and optimizes hot code differently: it predicts and inlines callees, calls a field that
holds a single function directly, and turns built-ins that take a callback into loops. The coldest part of a large program is compiled
differently again: compact code, no inlining, bodies shared between call sites. A test program exercises few of these paths: it is too
small to have a coldest part, and all its functions are among the hottest, which are hot and get site caches for property accesses. Most of
a large program is neither, and `neither` compiles every function that way. A forced heat exercises each path wherever it applies.

    JSC=<jsc> TESTAOT=<testaot> FRONT_END=<bun> PLAIN=<any bun> python3 test/aot/shell/heat.py [-j <jobs>] [--part <i>/<n>] hot | cold | neither <program>... | all

    --part <i>/<n>  with `all`: every n-th program, starting at the i-th, and all of $WRITTEN (quick.py). ../heat/*.test.ts split the programs this way
    the rest        as for quick.py. toolchain.py's docstring says how to build the tools

Prints one line per program that is `same` normally and not at that heat, or dies of a signal at that heat, and exits with 1 if there is one. Not counted: the programs in
heat-known.txt, which count runtime calls or check which code the compiler generated. A verdict `skipped: TODO: ..` of quick.py goes to stderr.
"""
import os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import quick, toolchain

HEATS = {"hot": "everything-is-hot", "cold": "everything-is-cold", "neither": "nothing-is-hottest"}


def verdicts(arguments, work, heat):
    env = {**os.environ, "WORK": work, "WORDS": "heat=" + heat}
    output = subprocess.run([sys.executable, HERE + "/quick.py", *arguments], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT).stdout.decode(errors="replace")
    return dict(line.split(": ", 1) for line in output.split("\n") if ": " in line)


if __name__ == "__main__":
    arguments = sys.argv[1:]
    jobs = []
    if arguments[:1] == ["-j"]:
        jobs, arguments = arguments[:2], arguments[2:]
    part, parts = 1, 1
    if "--part" in arguments:
        at = arguments.index("--part")
        part, parts = map(int, arguments[at + 1].split("/"))
        del arguments[at:at + 2]
    if len(arguments) < 2 or arguments[0] not in HEATS:
        sys.exit(__doc__)
    for name in ("JSC", "TESTAOT", "FRONT_END", "PLAIN"):
        toolchain.tool(name)
    heat, programs = arguments[0], arguments[1:]
    if programs == ["all"]:
        programs = quick.all_programs()[part - 1::parts] + quick.written_programs()
    known = {line.split()[0] for line in open(HERE + "/heat-known.txt") if line.strip() and not line.startswith("#") and line.split()[1] in (heat, "both")}
    with tempfile.TemporaryDirectory(prefix="aot-heat") as folder:
        forced = verdicts([*jobs, *programs], folder + "/forced", HEATS[heat])
        for name, verdict in forced.items():
            if verdict.startswith("skipped: TODO: "):
                print(f"{name}: {verdict}", file=sys.stderr)
        suspects = [name for name, verdict in forced.items() if not verdict.startswith(("same", "skipped")) and name not in known]
        baseline = verdicts([*jobs, *suspects], folder + "/baseline", "none") if suspects else {}
    failures = [name for name in suspects if baseline.get(name, "").startswith("same") or "died of signal" in forced[name]]
    for name in failures:
        print(f"{name}: {forced[name]}")
    print(f"{sum(verdict.startswith('same') for verdict in forced.values())} programs answer the same with every function {heat}, {len(failures)} do not")
    sys.exit(1 if failures else 0)
