#!/usr/bin/env python3
"""Runs the programs in ../programs without building Bun.

Each program goes through three tools: the front end (a Bun) lowers it to IR, `testaot` compiles the IR to an image, with B3, Air
and compressed references validated, and the `jsc` shell runs the image. Use this while working on the compiler: all programs take
about five minutes, one takes a second. The real test is `bun test test/aot`, which needs a full Bun.

    JSC=<jsc> TESTAOT=<testaot> FRONT_END=<bun> PLAIN=<any bun> test/aot/shell/quick.py [-j <jobs>] <program>... | all

    the tools   toolchain.py's docstring says how to build them
    <program>   its path under ../programs without the extension, e.g. strings/replace-all

Other environment variables:
    PROGRAMS        the folder of programs (default: ../programs)
    WRITTEN         a second folder of programs, for those that a script writes and nobody keeps: `bun test/aot/generate.ts all <folder>`. `all` takes what lies there too
    WORK            where intermediate files go (default: <temporary directory>/aot-quick); the files of a failure are not deleted
    WORDS           option words added to every compile, after the program's own, separated by blanks (`testaot list options`)
    RUN_OPTIONS     options of `jsc` for the run of an image, separated by blanks
    RUN_SECONDS     how long the run of an image may take, and the run of `$PLAIN` that it is compared with (default: 120)

Prints one line per program and exits with 1 if any line is a failure:
    same            the output equals <program>.expected.txt or, if there is none, the output of `$PLAIN run <file>`
    DIFFERS         followed by the start of the diff; a run that is killed or dies of a signal always counts as different. After a death by a signal the image runs
                    again under where-it-died.py, which says where it died
    NO IR           the front end rejected the program
    NOT COMPILED    the engine rejected it
    skipped         the shell cannot judge it; the line says why

A program with a .build-errors.txt is skipped: front end and engine stop at the errors that `bun compile` reports.
"""
import difflib, json, os, re, sys, tempfile
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import toolchain

PROGRAMS = os.path.realpath(os.environ.get("PROGRAMS", HERE + "/../programs"))
WRITTEN = os.path.realpath(os.environ["WRITTEN"]) if os.environ.get("WRITTEN") else None
WORK = os.path.abspath(os.environ.get("WORK", os.path.join(tempfile.gettempdir(), "aot-quick")))
EXTENSIONS = ("ts", "tsx", "js", "mts", "cts", "mjs", "cjs")
MAIN_EXTENSIONS = ("cjs", "cts", "js", "mjs", "mts", "ts", "tsx")
# The files in the folder of a topic that programs load and that are no programs themselves, as in ../run-programs.ts.
HELPERS = (
    "commonjs/describe-object.cjs",
    "strings/regexps-built-at-start.cjs",
    "untyped-speed/commonjs-package/lib/format.js",
    "untyped-speed/commonjs-package/lib/queue.js",
    "untyped-speed/commonjs-package/lib/util.js",
)


def all_programs(root=PROGRAMS):
    found = set()

    # As `find` in ../run-programs.ts: a folder with a main.<ext> is one program, any other folder holds programs.
    def find(folder, name):
        if any(os.path.isfile(f"{folder}/main.{x}") for x in MAIN_EXTENSIONS):
            return found.add(name)
        for entry in os.listdir(folder):
            stem, _, extension = entry.rpartition(".")
            if os.path.isdir(os.path.join(folder, entry)):
                find(os.path.join(folder, entry), f"{name}/{entry}")
            elif extension in EXTENSIONS and not re.search(r"\.d\.[cm]?ts$", entry) and f"{name}/{entry}" not in HELPERS:
                found.add(f"{name}/{stem}")

    for topic in sorted(os.listdir(root)):
        if os.path.isdir(os.path.join(root, topic)):
            find(os.path.join(root, topic), topic)
    return sorted(found)


def written_programs():
    """Those of $WRITTEN that ../programs does not have."""
    return sorted(set(all_programs(WRITTEN)) - set(all_programs())) if WRITTEN else []


def first_existing(paths):
    return next((path for path in paths if os.path.isfile(path)), None)


def without_times(output):
    # A duration that a program measures is not part of its behavior.
    return re.sub(r" [0-9]+ms$", "", output, flags=re.M)


def skip_reason(base, options, compiler_options):
    if os.path.isfile(base + ".build-errors.txt"):
        return "the build rejects it"
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


def where_it_died(ir, image, words, build_env, entry, env, has_own_environment, cwd):
    """What the machine can say about a death by a signal without a debugger, for a machine that only a continuous build has. It stays on the line of the verdict."""
    run_options, said = os.environ.get("RUN_OPTIONS", "").split(), ""
    if has_own_environment:
        code, _ = toolchain.run_image(image, entry, dict(os.environ), run_options, cwd=cwd)
        said += " | without the environment of its .json: " + ("timed out" if code is None else f"died of signal {-code}" if code < 0 else f"exit code {code}")
    try:
        toolchain.compile_image(ir, image, words, cwd=cwd, env={**build_env, **os.environ, "JSC_aotMapFilePath": image + ".map"})
    except toolchain.ToolFailed:
        return said
    follower = [sys.executable, HERE + "/where-it-died.py", "--image", image, "--map", image + ".map"]
    return said + " | " + " ".join(toolchain.run_image(image, entry, env, run_options, cwd=cwd, seconds=200, under=follower)[1].split("\n")).strip()


def run_program(program):
    for root in filter(None, (PROGRAMS, WRITTEN)):
        base = os.path.join(root, program)
        entry = first_existing([f"{base}.{x}" for x in EXTENSIONS] + [f"{base}/main.{x}" for x in MAIN_EXTENSIONS])
        if entry is not None:
            break
    else:
        return "NO IR: there is no such program"
    # main.<ext> of such a program only imports jsc-shell-functions.ts first, and the shell has those functions itself.
    source = first_existing([f"{base}/program.{x}" for x in EXTENSIONS]) or entry
    options = json.load(open(base + ".json")) if os.path.isfile(base + ".json") else {}
    tsconfig = base + "/tsconfig.json"
    compiler_options = json.load(open(tsconfig)).get("compilerOptions", {}) if os.path.isfile(tsconfig) else {}
    skipped = skip_reason(base, options, compiler_options)
    if skipped:
        return "skipped: " + skipped

    cwd = os.path.dirname(source)
    work = os.path.join(WORK, program.replace("/", "."))
    ir, image = work + ".ir", work + ".image"
    env = toolchain.run_environment(options)

    front_flags, words = toolchain.split_flags(options.get("build", []))
    try:
        toolchain.front_end(source, ir, front_flags, cwd=cwd, seconds=60)
    except toolchain.ToolFailed as failed:
        return "NO IR: " + " | ".join(failed.said.strip().split("\n")[:2])[:200]

    build_env = {name[len("BUN_"):] if name.startswith("BUN_JSC_") else name: value for name, value in options.get("buildEnv", {}).items()}
    words = ["check=validate-back-end,validate-references", "threads=2", *words, *os.environ.get("WORDS", "").split()]
    try:
        entries = toolchain.compile_image(ir, image, words, cwd=cwd, env={**build_env, **os.environ})
    except toolchain.ToolFailed as failed:
        return f"NOT COMPILED (exit code {failed.code}): " + " ".join(failed.said.split("\n")[:3])[:300]

    code, output = toolchain.run_image(image, entries[0], env, os.environ.get("RUN_OPTIONS", "").split(), cwd=cwd, seconds=int(os.environ.get("RUN_SECONDS", 120)))
    output = without_times(output)
    needed = re.search(r"^AOT: the program needs the host's (.*), and this realm has no host$", output, re.M)
    if needed:
        return "skipped: it needs the host's " + needed.group(1)
    # The shell answers "bun" with the `Bun` of prelude.js, and has no other module of Bun's.
    needed = re.search(r"^Exception: SyntaxError: Export named '(.*)' not found in module 'bun'\.$", output, re.M)
    if needed:
        return "skipped: it needs the host's Bun." + needed.group(1)
    needed = re.search(r"^Exception: Error: Cannot find module '((?:bun|node):.*)'$", output, re.M)
    if needed:
        return "skipped: it needs the host's " + needed.group(1)
    # The images here are built without the engine's library, so its functions run as text, which a program that sets crashIfInterpreterIsUsed forbids. A function of the program has a path in front of the colon.
    text = re.search(r"^crashIfInterpreterIsUsed: Function (\S+) at :1$", output, re.M)
    if text:
        return f"skipped: the engine's {text.group(1)} is no compiled code here"
    if code is None or code < 0:
        verdict = f"DIFFERS: {'timed out' if code is None else f'died of signal {-code}'}: " + " | ".join(output.strip().split("\n")[-2:])[:220]
        if code is None:
            return verdict
        verdict += where_it_died(ir, image, words, build_env, entries[0], env, bool(options.get("env")), cwd)
        return verdict

    if os.path.isfile(base + ".expected.txt"):
        expected = open(base + ".expected.txt", errors="replace").read()
    else:
        seconds = int(os.environ.get("RUN_SECONDS", 120))
        plain_code, expected = toolchain.run([PLAIN, "run", entry], cwd, seconds, env)
        if plain_code is None:
            return f"skipped: `$PLAIN run` did not end within {seconds} s, so there is nothing to compare with"
        expected = without_times(expected)
    if output != expected:
        open(work + ".output", "w").write(output)
        diff = [line for line in difflib.unified_diff(expected.split("\n"), output.split("\n"), lineterm="", n=0) if not line.startswith(("---", "+++", "@@"))]
        return f"DIFFERS (exit code {code}): " + " | ".join(line[:110] for line in diff[:3])
    for path in (ir, image, work + ".output"):
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
    for name in ("JSC", "TESTAOT", "FRONT_END"):
        toolchain.tool(name)
    PLAIN = toolchain.tool("PLAIN")
    os.environ["TZ"] = "Etc/UTC"
    os.makedirs(WORK, exist_ok=True)
    programs = all_programs() + written_programs() if arguments == ["all"] else arguments
    failed = 0
    with ThreadPoolExecutor(jobs) as pool:
        for program, verdict in zip(programs, pool.map(run_program, programs)):
            print(f"{program}: {verdict}", flush=True)
            failed += not verdict.startswith(("same", "skipped"))
    sys.exit(1 if failed else 0)
