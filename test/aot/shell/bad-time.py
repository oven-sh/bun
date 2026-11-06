#!/usr/bin/env python3
"""Runs the programs in ../programs with quick.py and asks the `jsc` shell, at the end of each, whether its realm "is having a bad time".

That is JavaScriptCore's name for a state that a realm enters once and never leaves: an indexed store may have to consult the prototype
chain, so every array of the program, existing or future, uses SlowPutArrayStorage, which has no inline fast path. A program causes it
with an accessor or a read-only property at an index of an object that others inherit from, or with a Proxy in the prototype chain of such
an object. The output stays correct, so no other test notices. This test finds a program that gets there because of the engine.

    JSC=<jsc> TESTAOT=<testaot> FRONT_END=<bun> PLAIN=<any bun> python3 test/aot/shell/bad-time.py [-j <jobs>] [--part <i>/<n>] <program>... | all

    --part <i>/<n>  with `all`: every n-th program, starting at the i-th, and all of $WRITTEN (quick.py). ../bad-time/*.test.ts split the programs this way
    the rest        as for quick.py. toolchain.py's docstring says how to build the tools

Prints one line per program that ends in that state and is not in bad-time-known.txt, which lists the programs that cause it on purpose,
one per listed program that does not end in it, and one per program that dies of a signal. Exits with 1 if there is a line of the first or the
last kind. A program that does not reach its end is not asked.
"""
import os, stat, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import quick, toolchain

WRAPPER = '''#!/usr/bin/env python3
import os, signal, subprocess, sys
jsc, answers, arguments = %r, %r, sys.argv[1:]
image = next((argument[len("--aotImagePath="):] for argument in arguments if argument.startswith("--aotImagePath=")), None)
if image is None:
    os.execv(jsc, [jsc, *arguments])
arguments = [argument + '.then(() => print("@bad time: " + $vm.isHavingABadTime(globalThis)))' if argument.startswith("runCompiledEntryPoint(") else argument for argument in arguments]
run = subprocess.run([jsc, "--useDollarVM=1", *arguments], stdout=subprocess.PIPE)
lines = run.stdout.split(b"\\n")
for answer in (b"true", b"false"):
    if b"@bad time: " + answer in lines:
        lines.remove(b"@bad time: " + answer)
        with open(answers, "a") as file:
            file.write(os.path.basename(image) + " " + answer.decode() + "\\n")
sys.stdout.buffer.write(b"\\n".join(lines))
sys.stdout.flush()
if run.returncode < 0:
    signal.signal(-run.returncode, signal.SIG_DFL)
    os.kill(os.getpid(), -run.returncode)
sys.exit(run.returncode)
'''

if __name__ == "__main__":
    arguments = sys.argv[1:]
    if "--part" in arguments:
        at = arguments.index("--part")
        part, parts = map(int, arguments[at + 1].split("/"))
        del arguments[at:at + 2]
        arguments[arguments.index("all"):] = quick.all_programs()[part - 1::parts] + quick.written_programs()
    if not arguments:
        sys.exit(__doc__)
    jsc = toolchain.tool("JSC")
    for name in ("TESTAOT", "FRONT_END", "PLAIN"):
        toolchain.tool(name)
    known = {line.split()[0] for line in open(HERE + "/bad-time-known.txt") if line.strip() and not line.startswith("#")}
    with tempfile.TemporaryDirectory(prefix="aot-bad-time") as folder:
        wrapper, answers = folder + "/jsc", folder + "/answers.txt"
        open(answers, "w").close()
        open(wrapper, "w").write(WRAPPER % (jsc, answers))
        os.chmod(wrapper, os.stat(wrapper).st_mode | stat.S_IXUSR)
        verdicts = subprocess.run([sys.executable, HERE + "/quick.py", *arguments], env={**os.environ, "JSC": wrapper, "WORK": folder + "/work"}, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).stdout.decode(errors="replace")
        asked = dict(line.rsplit(" ", 1) for line in open(answers).read().split("\n") if line)
    asked = {image.removesuffix(".image").replace(".", "/", 1): answer == "true" for image, answer in asked.items()}
    failures = sorted(name for name, answer in asked.items() if answer and name not in known)
    for name in failures:
        print(f"{name}: has a bad time")
    died = [line for line in verdicts.split("\n") if ": DIFFERS: died of signal " in line]
    for line in died:
        print(line)
    for name in sorted(name for name, answer in asked.items() if not answer and name in known):
        print(f"{name}: is in bad-time-known.txt and has none")
    print(f"{len(asked)} programs reach their end, {sum(asked.values())} have a bad time, {len(failures)} of them without meaning it")
    sys.exit(1 if failures or died else 0)
