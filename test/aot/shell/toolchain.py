"""The command lines of the three tools that compile and run a program without Bun: the front end, `testaot` and the `jsc` shell.

    $FRONT_END compile <entry> --no-builtin-modules --aot-out=<program> --aot-threads=1 [<flag>...]
    $TESTAOT compile <program> --output=<image> [--<JSC option>=<value>...] references=narrow [<option word>...]
    $TESTAOT print <program> [--until=<PassID>] references=narrow [<option word>...]
    $JSC --aotImagePath=<image> [--<JSC option>=<value>...] -e <text of prelude.js> -e "runCompiledEntryPoint(<id>)"

The front end is a Bun. It writes the program as IR and goes on to build an executable, so it also gets `--outfile <file>`.
`testaot compile` writes the image and prints `entry <index> <id>` for each entry point. `testaot print` prints the IR as text: as read,
or after the first run of a pass. `testaot list options` prints the option words, `testaot list passes` the names of the passes.

Each tool is an executable file named by an environment variable:

    FRONT_END   a Bun built from this tree
    TESTAOT     BUN_WEBKIT_PATH=<WebKit> bun scripts/build.ts --profile=release-local --target=testaot   (build/release-local/testaot)
    JSC         BUN_WEBKIT_PATH=<WebKit> bun scripts/build.ts --profile=release-local --target=jsc       (build/release-local/jsc)
    PLAIN       any Bun
"""
import contextlib, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OPTIMIZED = "NumberLiteralStrings"  # PassID: the last pass that changes a function body in form Prepared
PLACED = "CheckPlacement"  # PassID: the last pass of the pipeline

os.environ.update(NO_COLOR="1", BUN_ENABLE_CRASH_REPORTING="0", BUN_DEBUG_QUIET_LOGS="1")

# A tool that dies of a signal is a verdict here ("died of signal 11"). Its core file says nothing more, and a runner that looks for core files takes each for a failure of the test file.
with contextlib.suppress(ImportError):
    import resource

    resource.setrlimit(resource.RLIMIT_CORE, (0, resource.getrlimit(resource.RLIMIT_CORE)[1]))


class ToolFailed(Exception):
    """A tool did not produce its output. `code`: its exit code, negative for a signal, None for a timeout. `said`: what it printed."""

    def __init__(self, code, said):
        super().__init__(code, said)
        self.code, self.said = code, said


def tool(name):
    if name not in os.environ:
        sys.exit(f"{name} is not set.\n{__doc__}")
    if not os.path.isfile(os.environ[name]) or not os.access(os.environ[name], os.X_OK):
        sys.exit(f"{name}: {os.environ[name]} is not an executable file.\n{__doc__}")
    return os.path.abspath(os.environ[name])


def run(command, cwd=None, seconds=120, env=None, stderr=subprocess.STDOUT):
    """Returns (exit code, stdout and stderr together). The exit code is negative for a signal and None for a timeout.

    With stderr=subprocess.PIPE the text is stdout alone if the exit code is 0, and stderr alone otherwise."""
    try:
        done = subprocess.run(command, cwd=cwd, env=env, timeout=seconds, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=stderr)
        code = done.returncode
    except subprocess.TimeoutExpired as expired:
        done, code = expired, None
    said = done.stderr if stderr == subprocess.PIPE and code != 0 else done.stdout
    return code, (said or b"").decode(errors="replace")


def shell_environment(env):
    """For `testaot` and `jsc`, which exit without destroying their VM: LeakSanitizer would report that."""
    return {**env, "ASAN_OPTIONS": env["ASAN_OPTIONS"] + ":detect_leaks=0"} if "ASAN_OPTIONS" in env else env


def run_environment(options):
    """os.environ plus "env" of <program>.json. The shell reads JSC_<name> where Bun reads BUN_JSC_<name>."""
    env = options.get("env", {})
    return {**os.environ, **env, **{name[len("BUN_"):]: value for name, value in env.items() if name.startswith("BUN_JSC_")}}


def split_flags(flags):
    """Splits the "build" flags of <program>.json into (flags for the front end, option words for `testaot`). Bundler flags are dropped."""
    front_end_flags, words = [], []
    for flag in flags:
        if flag == "--aot-huge-heap":
            words.append("references=wide")
        elif flag == "--aot-erase-types":
            front_end_flags.append(flag)
        elif flag.startswith("--aot-type-errors="):
            front_end_flags.append(flag)
            words.append(flag[len("--aot-"):])
        elif flag.startswith("--aot-"):
            words.append(flag[len("--aot-"):])
    return front_end_flags, words


def _remove_file(path):
    with contextlib.suppress(FileNotFoundError):
        os.remove(path)


def front_end(source, out, flags=(), *, cwd=None, seconds=120, env=None):
    """Writes the IR of `source` to `out`, or raises ToolFailed.

    Only the file counts, not the exit code: a Bun goes on to its own engine, which has host built-ins and rejects this program."""
    _remove_file(out)
    command = [tool("FRONT_END"), "compile", source, "--no-builtin-modules", "--aot-out=" + out, "--aot-threads=1", *flags, "--outfile", out + ".executable"]
    code, said = run(command, cwd, seconds, env)
    _remove_file(out + ".executable")
    if not os.path.isfile(out):
        raise ToolFailed(code, said)


def compile_image(program, image, words=(), options=(), *, cwd=None, seconds=300, env=None):
    """Compiles the IR in `program` to `image`. Returns the ids of the entry points, in order, or raises ToolFailed.

    Bun ships narrow references and the default is wide. A scalar option takes its last word, so references=wide in `words` wins."""
    _remove_file(image)
    command = [tool("TESTAOT"), "compile", program, "--output=" + image, *options, "references=narrow", *words]
    code, said = run(command, cwd, seconds, shell_environment(env or os.environ), subprocess.PIPE)
    entries = re.findall(r"^entry \d+ (\d+)$", said, re.M)
    if code != 0 or not os.path.isfile(image) or not entries:
        raise ToolFailed(code, said)
    return [int(entry) for entry in entries]


def print_program(program, until=None, words=(), *, cwd=None, seconds=120):
    """Returns the IR text of `program`: as read, or after the first run of the pass `until`. Raises ToolFailed."""
    command = [tool("TESTAOT"), "print", program, *(["--until=" + until] if until else []), "references=narrow", *words]
    code, said = run(command, cwd, seconds, shell_environment(os.environ), subprocess.PIPE)
    if code != 0:
        raise ToolFailed(code, said)
    return said


def run_image(image, entry, env=None, options=(), *, after=(), cwd=None, seconds=120, under=()):
    """Runs an entry point of `image` in the shell. Returns (exit code, stdout and stderr together).

    `under` is a command that takes the shell's command line as its last arguments.
    The statements in `after` run once the module has been evaluated, top-level awaits included, and not at all if it throws.
    They wait on the module's promise because the shell does not drain microtasks between two -e scripts."""
    script = f"runCompiledEntryPoint({entry})"
    if after:
        script += ".then(() => {\n" + ";\n".join(after) + "\n})"
    command = [*under, tool("JSC"), "--aotImagePath=" + image, *options, "-e", open(HERE + "/prelude.js").read(), "-e", script]
    return run(command, cwd, seconds, shell_environment(env or os.environ))


def run_ir_test(text, test_file, directives, *, cwd=None, seconds=300):
    """Writes `test_file`, the directives above the IR text, and runs it. Returns (passed, what `testaot` printed).

    This is how a script checks a statistic or the kind of a diagnostic by enum name, without reading a message:
    ["RUN: compile", "OPTIONS: references=narrow drop-guard=GetSlot:0", "STATISTIC: GuardsDropped >= 1"]
    A run without a DIAGNOSTIC: directive fails if the build reports anything."""
    with open(test_file, "w", encoding="utf-8") as file:
        file.write("".join(f"# {directive}\n" for directive in directives) + text)
    code, said = run([tool("TESTAOT"), "run", test_file], cwd, seconds, shell_environment(os.environ))
    return code == 0, said
