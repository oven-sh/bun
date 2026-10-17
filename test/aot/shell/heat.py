#!/usr/bin/env python3
"""Runs the programs in ../programs with quick.py, compiled as if every function were hot, or as if every function were cold.

The compiler estimates how hot each function is and compiles hot code in other forms than the rest: callees are guessed and copied in,
a field that holds one function is called without being read, built-ins that take a callback become loops around it. The coldest part of
a large program gets forms of its own again: compact code, nothing copied in, bodies shared between call sites. A test program meets few
of them. Most of its functions run once, and a program this small has no coldest part at all. Here each form is made wherever it can be.

    JSC=<jsc> SEMA=<bun-sema> PLAIN=<any bun> python3 test/aot/shell/heat.py [-j <jobs>] [--part <i>/<n>] hot | cold <program>... | all

    --part <i>/<n>  of `all`: every n-th program, from the i-th on. ../heat/*.test.ts deal the programs out so
    the rest        as for quick.py, whose top says how to build the tools

Prints one line per program that is not `same` at that heat and is `same` as it is, and exits with 1 if there is any. Not counted: the
programs in heat-known.txt, which count calls into the runtime or ask which form the compiler chose.
"""
import os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import quick

HEATS = {"hot": "2", "cold": "3"}


def verdicts(arguments, work, heat):
    env = {**os.environ, "WORK": work, "JSC_aotHotByTextForTesting": heat}
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
    if len(arguments) < 2 or arguments[0] not in HEATS or "JSC" not in os.environ:
        sys.exit(__doc__)
    heat, programs = arguments[0], arguments[1:]
    if programs == ["all"]:
        programs = quick.all_programs()[part - 1::parts]
    known = {line.split()[0] for line in open(HERE + "/heat-known.txt") if line.strip() and not line.startswith("#") and line.split()[1] in (heat, "both")}
    with tempfile.TemporaryDirectory(prefix="aot-heat") as folder:
        forced = verdicts([*jobs, *programs], folder + "/forced", HEATS[heat])
        suspects = [name for name, verdict in forced.items() if not verdict.startswith(("same", "skipped")) and name not in known]
        plainly = verdicts([*jobs, *suspects], folder + "/plainly", "0") if suspects else {}
    failures = [name for name in suspects if plainly.get(name, "").startswith("same")]
    for name in failures:
        print(f"{name}: {forced[name]}")
    print(f"{sum(verdict.startswith('same') for verdict in forced.values())} programs answer the same with every function {heat}, {len(failures)} do not")
    sys.exit(1 if failures else 0)
