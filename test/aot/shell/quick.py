#!/usr/bin/env python3
"""Runs the programs in ../programs without building Bun.

Each program goes through the TypeScript front end (bun-sema), then JavaScriptCore's ahead-of-time compiler (with its graphs
validated after every phase), and the compiled program then runs in the `jsc` shell. Use this while working on the compiler:
all programs take about five minutes, one takes a second. The real test is `bun test test/aot`, which needs a full Bun.

    JSC=<jsc> SEMA=<bun-sema> PLAIN=<any bun> test/aot/shell/quick.py [-j <jobs>] <program>... | all

    jsc         BUN_WEBKIT_PATH=<WebKit> bun scripts/build.ts --profile=release-local --target=jsc   (build/release-local/jsc)
    bun-sema    BUN_CODEGEN_DIR=$PWD/build/release-local/codegen cargo build --release -p bun_sema_standalone
    <program>   its path under ../programs without the extension, e.g. strings/replace-all

Other environment variables:
    PROGRAMS            the folder of programs (default: ../programs)
    WORK                where intermediate files go (default: <temporary directory>/aot-quick); those of a failure are kept
    BUN_SEMA_TS_LIB     TypeScript's lib folder (default: node_modules/typescript/lib of this repository)

Prints one line per program and exits with 1 if any line is a failure:
    same            the output equals <program>.expected.txt or, if there is none, the output of `$PLAIN run <file>`
    DIFFERS         followed by the start of the diff; a run that is killed or dies of a signal always counts as different
    NO IR           the front end rejected the program
    NOT COMPILED    JavaScriptCore's compiler rejected it
    skipped         the shell cannot judge it; the line says why
"""
import difflib, json, os, re, subprocess, sys, tempfile
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
PROGRAMS = os.path.realpath(os.environ.get("PROGRAMS", HERE + "/../programs"))
WORK = os.environ.get("WORK", os.path.join(tempfile.gettempdir(), "aot-quick"))
EXTENSIONS = ("ts", "tsx", "js")


def tool(name):
    if name not in os.environ:
        sys.exit(f"{name} is not set.\n{__doc__}")
    if not os.access(os.environ[name], os.X_OK):
        sys.exit(f"{name}: {os.environ[name]} is not an executable file.")
    return os.environ[name]


def all_programs():
    found = set()
    for topic in sorted(os.listdir(PROGRAMS)):
        folder = os.path.join(PROGRAMS, topic)
        if not os.path.isdir(folder):
            continue
        for entry in os.listdir(folder):
            name, _, extension = entry.rpartition(".")
            if os.path.isdir(os.path.join(folder, entry)):
                found.add(f"{topic}/{entry}")
            elif extension in EXTENSIONS and not entry.endswith(".d.ts"):
                found.add(f"{topic}/{name}")
    return sorted(found)


def first_existing(paths):
    return next((path for path in paths if os.path.isfile(path)), None)


def run(command, cwd, seconds, env=None):
    """Returns (exit code, stdout and stderr together). The exit code is negative for a signal and None for a timeout."""
    try:
        done = subprocess.run(command, cwd=cwd, env=env, timeout=seconds, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        return done.returncode, done.stdout.decode(errors="replace")
    except subprocess.TimeoutExpired as expired:
        return None, (expired.stdout or b"").decode(errors="replace")


def without_times(output):
    # A duration that a program measures is not part of its behavior.
    return re.sub(r" [0-9]+ms$", "", output, flags=re.M)


def why_skipped(base, options, compiler_options):
    if os.path.isfile(base + ".build-errors.txt"):
        return "`bun build --aot` is expected to reject it"
    if os.path.isfile(base + ".todo.txt"):
        reason = open(base + ".todo.txt").readline().strip()
        # The shell has the functions that such a program is waiting for.
        if "jsc shell" not in reason:
            return "todo: " + reason[:100]
    if options.get("reference") == "compiled":
        return "it needs the bundler"
    if "paths" in compiler_options:
        return "it imports a bare module specifier"
    if "skipInShell" in options:
        return options["skipInShell"]
    return None


def one(program):
    base = os.path.join(PROGRAMS, program)
    entry = first_existing([f"{base}.{x}" for x in EXTENSIONS] + [f"{base}/main.{x}" for x in EXTENSIONS])
    if entry is None:
        return "NO IR: there is no such program"
    # main.<ext> of such a program only imports jsc-shell-functions.ts first, and the shell has those functions itself.
    source = first_existing([f"{base}/program.{x}" for x in EXTENSIONS]) or entry
    options = json.load(open(base + ".json")) if os.path.isfile(base + ".json") else {}
    tsconfig = base + "/tsconfig.json"
    compiler_options = json.load(open(tsconfig)).get("compilerOptions", {}) if os.path.isfile(tsconfig) else {}
    skipped = why_skipped(base, options, compiler_options)
    if skipped:
        return "skipped: " + skipped

    cwd = os.path.dirname(source)
    work = os.path.join(WORK, program.replace("/", "."))
    ir, image, host_module = work + ".ir", work + ".image", HERE + "/stub.js"
    for stale in (ir, image):
        if os.path.exists(stale):
            os.remove(stale)
    env = {**os.environ, **options.get("env", {})}

    flags = ["--allowJs", "--resolveJsonModule", "--no-builtin-modules"]
    if compiler_options.get("strict"):
        flags.append("--strict")
    if compiler_options.get("strictVariableInitialization") is False:
        flags += ["--strictVariableInitialization", "false"]
    _, said = run([SEMA, "cli", source, *flags, "--aot", "--aot-out=" + ir], cwd, 60)
    if not os.path.isfile(ir):
        return "NO IR: " + " | ".join(said.strip().split("\n")[:2])[:200]

    # The host module imports the modules that are not compiled, so that they are linked and evaluated before the program runs.
    _, dump = run([JSC, "--useDollarVM=1", HERE + "/dump.js", "--", ir, "read"], cwd, 60)
    external = sorted(set(re.findall(r'GetExternalModule ("[^"]*")', dump)))
    if external:
        host_module = work + ".host.js"
        open(host_module, "w").write("".join(f"import {name};\n" for name in external) + "0;\n")

    code, said = run([JSC, "--useDollarVM=1", "--validateGraphAtEachPhase=true", "--numberOfAOTCompilerThreads=2", HERE + "/image.js", "--", ir, image, host_module], cwd, 300)
    if not os.path.isfile(image):
        return f"NOT COMPILED (exit code {code}): " + " ".join(said.split("\n")[:3])[:300]

    code, output = run([JSC, "--aotImagePath=" + image, HERE + "/prelude.js", "-m", host_module], cwd, 120, env)
    output = without_times(output)
    if code is None or code < 0:
        return f"DIFFERS: {'timed out' if code is None else f'died of signal {-code}'}: " + " | ".join(output.strip().split("\n")[-2:])[:220]

    if os.path.isfile(base + ".expected.txt"):
        expected = open(base + ".expected.txt", errors="replace").read()
    else:
        expected = without_times(run([PLAIN, "run", entry], cwd, 60, env)[1])
    if output != expected:
        open(work + ".output", "w").write(output)
        diff = [line for line in difflib.unified_diff(expected.split("\n"), output.split("\n"), lineterm="", n=0) if not line.startswith(("---", "+++", "@@"))]
        return f"DIFFERS (exit code {code}): " + " | ".join(line[:110] for line in diff[:3])
    for path in (ir, image, work + ".host.js", work + ".output"):
        if os.path.exists(path):
            os.remove(path)
    return f"same ({output.count(chr(10))} lines)"


if __name__ == "__main__":
    arguments = sys.argv[1:]
    jobs = 8
    if arguments[:1] == ["-j"]:
        jobs, arguments = int(arguments[1]), arguments[2:]
    if not arguments:
        sys.exit(__doc__)
    JSC, SEMA, PLAIN = tool("JSC"), tool("SEMA"), tool("PLAIN")
    os.environ.update(TZ="Etc/UTC", NO_COLOR="1", BUN_ENABLE_CRASH_REPORTING="0")
    os.environ.setdefault("BUN_SEMA_TS_LIB", os.path.realpath(HERE + "/../../../node_modules/typescript/lib"))
    os.makedirs(WORK, exist_ok=True)
    programs = all_programs() if arguments == ["all"] else arguments
    failed = 0
    with ThreadPoolExecutor(jobs) as pool:
        for program, verdict in zip(programs, pool.map(one, programs)):
            print(f"{program}: {verdict}", flush=True)
            failed += not verdict.startswith(("same", "skipped"))
    sys.exit(1 if failed else 0)
