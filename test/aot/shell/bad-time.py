#!/usr/bin/env python3
"""Runs the programs in ../programs with quick.py and asks the `jsc` shell, at the end of each, whether its realm "is having a bad time".

JavaScriptCore's name for a state that a realm enters once and never leaves: a store at an index may have to ask a prototype chain, so
every array of the program, alive or still to be made, is given storage that nothing reads or writes in place. A program brings it on
itself with an accessor or a read-only property at an index of an object that others inherit from, or with a Proxy under such an
object. The answers stay right, so no other test sees it: this one is for a program that is brought there by the engine's own doing.

    JSC=<jsc> SEMA=<bun-sema> PLAIN=<any bun> python3 test/aot/shell/bad-time.py [-j <jobs>] [--part <i>/<n>] <program>... | all

    --part <i>/<n>  of `all`: every n-th program, from the i-th on. ../bad-time/*.test.ts deal the programs out so
    the rest        as for quick.py, whose top says how to build the tools

Prints one line per program that ends in that state and is not in bad-time-known.txt, the list of those that mean it, and one per
program of the list that does not end in it; exits with 1 if there is any of the first. A program that does not reach its end is not asked.
"""
import os, stat, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import quick

WRAPPER = '''#!/usr/bin/env python3
import os, signal, subprocess, sys
jsc, answers, arguments = %r, %r, sys.argv[1:]
image = next((argument[len("--aotImagePath="):] for argument in arguments if argument.startswith("--aotImagePath=")), None)
if image is None:
    os.execv(jsc, [jsc, *arguments])
run = subprocess.run([jsc, "--useDollarVM=1", *arguments, "-e", 'print("@bad time: " + $vm.isHavingABadTime(globalThis))'], stdout=subprocess.PIPE)
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
        arguments[arguments.index("all"):] = quick.all_programs()[part - 1::parts]
    if not arguments or "JSC" not in os.environ:
        sys.exit(__doc__)
    known = {line.split()[0] for line in open(HERE + "/bad-time-known.txt") if line.strip() and not line.startswith("#")}
    with tempfile.TemporaryDirectory(prefix="aot-bad-time") as folder:
        wrapper, answers = folder + "/jsc", folder + "/answers.txt"
        open(answers, "w").close()
        open(wrapper, "w").write(WRAPPER % (os.environ["JSC"], answers))
        os.chmod(wrapper, os.stat(wrapper).st_mode | stat.S_IXUSR)
        subprocess.run([sys.executable, HERE + "/quick.py", *arguments], env={**os.environ, "JSC": wrapper, "WORK": folder + "/work"}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        asked = dict(line.rsplit(" ", 1) for line in open(answers).read().split("\n") if line)
    asked = {image.removesuffix(".image").replace(".", "/", 1): answer == "true" for image, answer in asked.items()}
    failures = sorted(name for name, answer in asked.items() if answer and name not in known)
    for name in failures:
        print(f"{name}: has a bad time")
    for name in sorted(name for name, answer in asked.items() if not answer and name in known):
        print(f"{name}: is in bad-time-known.txt and has none")
    print(f"{len(asked)} programs reach their end, {sum(asked.values())} have a bad time, {len(failures)} of them without meaning it")
    sys.exit(1 if failures else 0)
