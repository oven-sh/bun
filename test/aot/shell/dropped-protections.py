#!/usr/bin/env python3
"""Tests the tests of what keeps an object alive that compiled code holds by a 32-bit reference alone.

A typed object keeps most references in 32 bits. The collector's scan of the stack knows 64-bit pointers, so wherever compiled code
goes on with the 32-bit word (it stores it again, compares it, or could compute an address from it later), the compiler keeps the
pointer alive beside it. Each place in the compiler that does so can be left out, one at a time, by an option of the `jsc` shell.
For every such place that the programs below reach, this script leaves it out and expects to be told:

    statically      --validateAOTNarrowReferences=1 refuses to compile some program
    at run time     some program dies or prints something else, with every freed cell overwritten and the second line of defence
                    switched off: the collector's scan of the stack also takes each 32-bit half of a word for a reference.
                    With that scan as it is, the same program must run as before

    JSC=<jsc> SEMA=<bun-sema> python3 test/aot/shell/dropped-protections.py [-j <jobs>] [--table]

quick.py's top says how to build the tools. Prints one line per place, named by the function of the compiler it is in and its
number among the places of that function that are reached, and exits with 1 if the lines are not those of
dropped-protections-expected.txt. A place that nothing notices is either not needed or not tested: the expected lines say which,
behind a `#`. --table adds file and line and compares nothing.
"""
import os, re, subprocess, sys, tempfile
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
PROGRAMS = os.path.realpath(HERE + "/../programs")
NAMES = [
    "typed-objects/locals-outlive-collections-by-kind",
    "typed-objects/locals-outlive-collections-by-place",
    "typed-objects/local-object-alive-until-reference-compare",
    "typed-objects/local-object-alive-until-reference-compare-on-the-right",
    "typed-objects/literal-fields-that-hold-strings-outlive-collections",
    "typed-objects/out-of-line-references-outlive-collections",
    "typed-objects/references-carried-across-awaits",
    "typed-objects/key-order-late-fields",
    "typed-objects/string-and-mixed-enums",
    "calls-fast-paths/new-as",
    "typed-objects/values-taken-from-maps-outlive-their-entries",
    "typed-objects/maps-alone-hold-their-keys-and-values",
]
# The places that deal with 32-bit references. The option can leave out others, which keep the owner of raw storage alive.
FUNCTIONS = {("AOTTypedLoweringAccess.cpp", "load"), ("AOTTypedLoweringAccess.cpp", "store"), ("AOTTypedLoweringAccess.cpp", "loadSlot"), ("AOTTypedLoweringInternal.h", "haveEqualBits"), ("AOTTypedBuiltinsMapSet.cpp", "operator()")}
SCRIBBLE = ["--useZombieMode=1", "--scribbleFreeCells=1"]
WITHOUT_THE_SCAN_OF_HALVES = ["--aotGuardToDropForTesting=narrow-reference-scan"]


def run(command, cwd, seconds=120):
    try:
        done = subprocess.run(command, cwd=cwd, timeout=seconds, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        return done.returncode, done.stdout.decode(errors="replace")
    except subprocess.TimeoutExpired as expired:
        return None, (expired.stdout or b"").decode(errors="replace")


def front_end(name, work):
    ir = os.path.join(work, name.replace("/", ".") + ".ir")
    source = os.path.join(PROGRAMS, name + ".ts")
    said = run([SEMA, "cli" if os.path.basename(SEMA).startswith("bun-sema") else "check", source, "--allowJs", "--resolveJsonModule", "--no-builtin-modules", "--aot", "--aot-out=" + ir], os.path.dirname(source))[1]
    if not os.path.isfile(ir):
        sys.exit(f"{name}: no IR: {said[:300]}")
    return ir


def compile(ir, image, options):
    if os.path.exists(image):
        os.remove(image)
    said = run([JSC, "--useDollarVM=1", "--numberOfAOTCompilerThreads=2", *options, HERE + "/image.js", "--", ir, image, HERE + "/stub.js"], HERE, 300)[1]
    return os.path.isfile(image), said


def answer(image, more=WITHOUT_THE_SCAN_OF_HALVES):
    return run([JSC, "--aotImagePath=" + image, *SCRIBBLE, *more, "-e", open(HERE + "/prelude.js").read(), "-m", HERE + "/stub.js"], HERE)


def as_it_is(name, work):
    ir = front_end(name, work)
    image = os.path.join(work, name.replace("/", ".") + ".image")
    made, said = compile(ir, image, ["--aotGuardToDropForTesting=list-protections", "--validateAOTNarrowReferences=1"])
    if not made:
        sys.exit(f"{name}: not compiled as it is: {said[-600:]}")
    expected = answer(image)
    if expected[0] != 0:
        sys.exit(f"{name}: as it is, it ends with {expected[0]}: {expected[1][-300:]}")
    return ir, dict(re.findall(r"^AOT protection: (\S+) (.*)$", said, re.M)), expected


def judge(place, programs, work):
    """Returns (is it noticed statically, is it noticed at run time, does the scan of halves make up for it)."""
    drop = "--aotGuardToDropForTesting=" + place
    statically = at_run_time = False
    is_made_up_for = True
    for name, (ir, reached, expected) in programs.items():
        if place not in reached or (statically and at_run_time):
            continue
        image = os.path.join(work, f"{name.replace('/', '.')}.{place.replace(':', '-')}.image")
        if not statically:
            made, said = compile(ir, image, [drop, "--validateAOTNarrowReferences=1"])
            statically = not made and "the collector could miss an object" in said
        if not at_run_time and compile(ir, image, [drop])[0]:
            at_run_time = answer(image) != expected
            is_made_up_for &= answer(image, []) == expected
            os.remove(image)
    return statically, at_run_time, is_made_up_for


if __name__ == "__main__":
    arguments = sys.argv[1:]
    jobs = 8
    if arguments[:1] == ["-j"]:
        jobs, arguments = int(arguments[1]), arguments[2:]
    if "JSC" not in os.environ or "SEMA" not in os.environ:
        sys.exit(__doc__)
    JSC, SEMA = os.environ["JSC"], os.environ["SEMA"]
    os.environ.update(TZ="Etc/UTC", NO_COLOR="1", BUN_ENABLE_CRASH_REPORTING="0")
    os.environ.setdefault("BUN_SEMA_TS_LIB", os.path.realpath(HERE + "/../../../node_modules/typescript/lib"))
    with tempfile.TemporaryDirectory(prefix="aot-dropped-protections") as work, ThreadPoolExecutor(jobs) as pool:
        programs = dict(zip(NAMES, pool.map(lambda name: as_it_is(name, work), NAMES)))
        functions = {place: function for _, reached, _ in programs.values() for place, function in reached.items() if (place.split(":")[0], function) in FUNCTIONS}
        places = sorted(functions, key=lambda place: (place.split(":")[0], int(place.split(":")[1])))
        verdicts = list(pool.map(lambda place: judge(place, programs, work), places))
    seen, lines = {}, []
    for place, (statically, at_run_time, is_made_up_for) in zip(places, verdicts):
        key = (place.split(":")[0], functions[place])
        seen[key] = seen.get(key, 0) + 1
        lines.append(f"{key[0]} {key[1]} {seen[key]}: {'refused' if statically else 'compiled'}, {'goes wrong' if at_run_time else 'runs as before'}{'' if is_made_up_for else ', ALSO UNDER THE SCAN OF HALVES'}" + (f"   ({place})" if "--table" in arguments else ""))
    print("\n".join(lines))
    if "--table" in arguments:
        sys.exit(0)
    wanted = [line.split("#")[0].rstrip() for line in open(HERE + "/dropped-protections-expected.txt") if line.split("#")[0].strip()]
    sys.exit(0 if lines == wanted else 1)
