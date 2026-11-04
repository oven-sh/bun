#!/usr/bin/env python3
"""The scoreboard of the translated tests: see README.md.

    python3 run.py --lib <cpython>/Lib --bun <release build of bun> --out <scratch directory> [-j N] [test_x test_y/test_z ...]

Translates the files of Lib/test (all of them, or those named), runs each translation with `bun test`, runs each original under
the same bun as python3, and writes score.md and score.json into the scratch directory (with --save: the head of score.md beside this file too).
"""

import argparse
import ast
import collections
import concurrent.futures
import json
import os
import re
import resource
import shutil
import signal
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import translate  # noqa: E402

GOOD = ("ok", "skip", "xfail")


def has_tests(path):
    with open(path, "rb") as file:
        try:
            return translate.count_test_methods(ast.parse(file.read())) > 0
        except (SyntaxError, ValueError):
            return False


# What is run in a process of its own, or loaded by other means than `import`.
NOT_LIBRARIES = ("_test_multiprocessing", "_test_eintr", "_test_atexit", "_isolated_sample", "datetimetester", "libregrtest", "support")


def find_modules(lib, wanted):
    """([(module name, path)] of the files that unittest would load tests from, the same of what else has test methods)"""
    root = os.path.join(lib, "test")
    found = []
    libraries = []
    for directory, directories, files in os.walk(root):
        relative = os.path.relpath(directory, root)
        parts = [] if relative == "." else relative.split(os.sep)
        directories[:] = sorted(d for d in directories if d.startswith("test") and os.path.exists(os.path.join(directory, d, "__init__.py")))
        for file in sorted(files):
            if not file.endswith(".py"):
                continue
            path = os.path.join(directory, file)
            if file == "__init__.py":
                if parts and has_tests(path):
                    found.append((".".join(["test", *parts]), path))
            elif file.startswith("test_") or (file.startswith("test") and parts and parts[-1] == "testmock"):
                found.append((".".join(["test", *parts, file[:-3]]), path))
            elif file[:-3] not in NOT_LIBRARIES and has_tests(path):
                libraries.append((".".join(["test", *parts, file[:-3]]), path))
    if wanted:
        names = {w.removesuffix(".py").replace("/", ".") for w in wanted}
        found = [
            (name, path)
            for name, path in found
            if any(name == f"test.{w}" or name.startswith(f"test.{w}.") for w in names)
        ]
    return found, libraries


def read_log(path):
    """{"file": record or None, "tests": {id: record}, "started": id or None, "done": bool}"""
    result = {"file": None, "tests": {}, "started": None, "done": False}
    try:
        with open(path, encoding="utf-8", errors="replace") as file:
            lines = file.readlines()
    except FileNotFoundError:
        return result
    for line in lines:
        try:
            record = json.loads(line)
        except ValueError:
            continue
        kind = record.get("t")
        if kind == "file":
            result["file"] = record
        elif kind == "start":
            result["started"] = record["id"]
        elif kind == "end":
            result["tests"][record["id"]] = record
            result["started"] = None
        elif kind == "done":
            result["done"] = True
    return result


def limit():
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    os.setsid()


def run_process(command, environment, directory, timeout, output_path, log=None, idle=None):
    """"ok", "timeout", or how the process ended. With `idle`: it is also a timeout if the log does not grow for so many seconds."""
    with open(output_path, "ab") as output:
        process = subprocess.Popen(command, env=environment, cwd=directory, stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT, preexec_fn=limit)
        begun = changed = time.time()
        size = -1
        try:
            while True:
                try:
                    status = process.wait(0.5)
                    break
                except subprocess.TimeoutExpired:
                    pass
                now = time.time()
                if idle is not None:
                    try:
                        current = os.path.getsize(log)
                    except OSError:
                        current = -1
                    if current != size:
                        size, changed = current, now
                if now - begun > timeout or (idle is not None and now - changed > idle):
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
                    return "timeout"
        finally:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
    if status < 0:
        return f"signal {signal.Signals(-status).name}"
    return "ok" if status in (0, 1) else f"status {status}"


class Runner:
    def __init__(self, options):
        self.options = options
        self.translation = {"native_async": options.native_async, "native_classes": options.native_classes, "inline_with": options.inline_with}
        self.out = os.path.abspath(options.out)
        self.generated = os.path.join(self.out, "generated")
        self.logs = os.path.join(self.out, "logs")
        self.baseline = os.path.join(self.out, "baseline")
        self.work = os.path.join(self.out, "work")
        for directory in (self.generated, self.logs, self.baseline, self.work):
            os.makedirs(directory, exist_ok=True)
        for name in ("support.ts", "support.py"):
            shutil.copy(os.path.join(HERE, name), os.path.join(self.generated, name))
        # bun under the name that makes it python3
        self.python = os.path.join(self.out, "python3")
        if os.path.lexists(self.python):
            os.unlink(self.python)
        os.symlink(os.path.abspath(options.bun), self.python)

    def environment(self, directory, log):
        environment = {k: v for k, v in os.environ.items() if k not in ("BUN_OPTIONS", "PYTHONPATH", "PYTHONHOME")}
        environment.update(
            BUN_PYTHON_STDLIB=os.path.abspath(self.options.lib),
            BUN_ENABLE_CRASH_REPORTING="0",
            BUN_DEBUG_QUIET_LOGS="1",
            STDLIB_SUITE_LOG=log,
            TMPDIR=directory,
            NO_COLOR="1",
        )
        return environment

    def all_libraries(self, names):
        """Those, and the ones they import."""
        found = []
        stack = list(names)
        while stack:
            name = stack.pop()
            if name not in found and name in self.libraries:
                found.append(name)
                stack += self.library_manifests[name].get("libraries", [])
        return found

    def fresh_directory(self, name):
        directory = os.path.join(self.work, name)
        shutil.rmtree(directory, ignore_errors=True)
        os.makedirs(directory)
        return directory

    def library(self, module, path):
        output = os.path.join(self.generated, module.removeprefix("test.").replace(".", os.sep) + ".ts")
        manifest = translate.translate_file(path, module, output, self.libraries, True, **self.translation)
        if manifest["file"] is not None:
            self.libraries = self.libraries - {module}
        return {"module": module, "manifest": manifest, "seconds": 0, "ended": None}

    def one(self, module, path):
        relative = module.removeprefix("test.").replace(".", os.sep)
        if os.path.basename(path) == "__init__.py":
            relative = os.path.join(relative, "__init__")
        output = os.path.join(self.generated, relative + ".test.ts")
        manifest = translate.translate_file(path, module, output, self.libraries, False, **self.translation)
        record = {"module": module, "manifest": manifest, "seconds": 0, "ended": None}
        translated = [key for key, reason in manifest["tests"].items() if reason == "ok"]
        if manifest["file"] is None and translated:
            log = os.path.join(self.logs, module + ".jsonl")
            console = os.path.join(self.logs, module + ".out")
            for old in (log, console):
                if os.path.exists(old):
                    os.unlink(old)
            begun = time.time()
            # A test that kills the process or never ends is noted, and the file is run again for the tests after it.
            record["died"] = died = {}
            for attempt in range(self.options.attempts):
                directory = self.fresh_directory(module + ".ts")
                environment = self.environment(directory, log)
                run = read_log(log)
                environment["STDLIB_SUITE_SKIP"] = "\n".join([*run["tests"], *died])
                record["ended"] = run_process(
                    [os.path.abspath(self.options.bun), "test", "--timeout", str(self.options.test_timeout * 1000), output],
                    environment, directory, self.options.timeout, console, log, self.options.idle,
                )  # fmt: skip
                shutil.rmtree(directory, ignore_errors=True)
                started = read_log(log)["started"]
                if started is None or started in died:
                    break
                died[started] = record["ended"]
            record["seconds"] = round(time.time() - begun, 1)
            record["run"] = read_log(log)

            log = os.path.join(self.baseline, module + ".jsonl")
            if self.options.rebaseline or not os.path.exists(log):
                if os.path.exists(log):
                    os.unlink(log)
                directory = self.fresh_directory(module + ".py")
                ended = run_process(
                    [self.python, os.path.join(self.generated, "support.py"), module, log, *self.all_libraries(manifest["libraries"])],
                    self.environment(directory, log), directory, self.options.timeout, os.path.join(self.baseline, module + ".out"),
                )  # fmt: skip
                with open(log, "a") as file:
                    file.write(json.dumps({"t": "ended", "how": ended}) + "\n")
                shutil.rmtree(directory, ignore_errors=True)
            record["baseline"] = read_log(log)
        return record


# What is known to be behind a failure, by the file or by the message. The first that fits counts.
CAUSES = [
    ("the test is about its own code: tracing, frames, code objects, bytecode",
     r"^test\.(test_sys_settrace|test_sys_setprofile|test_monitoring|test_bdb|test_pdb|test_trace|test_dis|test_peepholer|test_code|test_frame|test_funcattrs|test_compile|test_opcache|test_profiling\..*|test_cprofile|test_profile|test_tracemalloc|test_traceback|test_inspect\..*|test_annotationlib|test_scope|test_positional_only_arg|test_keywordonlyarg|test_grammar|test_syntax|test_exceptions|test_raise|test_with|test_generators|test_coroutines|test_asyncgen|test_yield_from|test_generator_stop|test_super|test_type_annotations|test_type_params|test_unparse|test_symtable|test_listcomps|test_dictcomps|test_setcomps|test_named_expressions|test_lazy_import.*)$", None),
    ("a function of JavaScript has no code object, closure, defaults, annotations, signature or __dict__",
     None, r"'JSFunction' object has no attribute '__\w+__'|no signature found for builtin <JavaScript function|disassemble JSFunction|<JavaScript function .* is not a Python function|Invalid first argument to `register\(\)`|'\(\*args, \*\*kwargs\)' !="),
    ("a function of JavaScript cannot be pickled, copied by reference or weakly referenced", None, r"cannot pickle 'JSFunction'|weak reference to 'JSFunction'|cannot pickle '_js\."),
    ("a generator of JavaScript is not a generator object of Python's", None, r"'_js\.JSGenerator' object has no attribute|Generator is executing|_js\.JSGenerator"),
    ("a coroutine made of a generator is not a coroutine object of Python's", None, r"'(Coroutine|AsyncGenerator)' object|coroutine object .* at|<class 'support\.|RuntimeWarning not triggered|never awaited"),
    ("to call a coroutine function from JavaScript gives a promise", None, r"JavaScript Promise|'JSPromise' object|attached to a different loop"),
    ("a whole float that a call returns is an int when it goes back", None,
     r"<class 'int'> (!=|is not) <class 'float'>|is not an instance of <class 'float'>|'int' object has no attribute '(hex|is_integer|fromhex)'|must return a float, not int|must be (a )?float, not int|not 'int'.*float"),
    ("no exception is being handled in a `catch`: __context__, sys.exception(), traceback.format_exc()", None,
     r"None is not an instance of <class '\w+(Error|Exception|Exit|Interrupt)'>|'NoneType' object has no attribute '(args|tb_next|tb_frame|tb_lineno|__traceback__|__context__|exc_type|err_msg|with_traceback)'|NoneType: None|None is not (\w*Error|Exception)\("),
    ("what goes by the frame of the caller finds none of the test's", None, r"'support' !=|support\.py' !=|not found as support\.|'__main__' !="),
    ("a call of what cannot be called, and the like, is a TypeError of JavaScript's", None, r"^JS TypeError: .* is not a function"),
    ("a warning given under with() of bun:python is attributed to the frame of with()", None, r"<frozen _bun_python>' !=|'_bun_python' !="),
    ("dir() of a function of JavaScript lists 'arguments', 'caller' and 'callee', which throw", None, r"'arguments', 'callee', and 'caller' cannot be accessed"),
    ("for what JavaScript calls, the loop that Bun runs is the running loop", None, r"BunEventLoop"),
    ("a test that needed JavaScript on a second thread was interrupted and left something behind", None, r"Unexpected handlers: |Event loop stopped before Future completed|RemoteDisconnected"),
    ("a view that was dropped still counts as an export under a frame of the optimizing compilers", None, r"Existing exports of data"),
]
CAUSES = [(title, module and re.compile(module), message and re.compile(message)) for title, module, message in CAUSES]


def cause_of(module, detail):
    text = f"{detail[0]}: {detail[1]}"
    for title, module_pattern, message_pattern in CAUSES:
        if (module_pattern and module_pattern.match(module)) or (message_pattern and message_pattern.search(text)):
            return title
    return None


def normalize(detail):
    kind, message = detail[0], detail[1]
    line = message.strip().split("\n")[0] if message.strip() else ""
    line = re.sub(r"(?<![\w.])/(?:[\w.+\-]+/)+", "…/", line)  # Where the files are is no part of the message.
    line = re.sub(r"0x[0-9a-fA-F]+", "0x…", line)
    line = re.sub(r"\d+(\.\d+)?", "N", line)
    line = re.sub(r"(\[[^\]]{30,}\]|\([^)]{40,}\)|\{[^}]{30,}\})", "…", line)
    return f"{kind}: {line[:140]}"


def summarize(records):
    total = collections.Counter()
    reasons = collections.Counter()
    clusters = collections.defaultdict(list)
    not_interop = collections.defaultdict(list)
    causes = collections.defaultdict(list)
    files = []
    for record in records:
        manifest = record["manifest"]
        module = record["module"]
        counts = collections.Counter()
        counts["methods"] = manifest["methods"]
        if manifest["file"] is not None:
            reasons["the file: " + manifest["file"]] += manifest["methods"]
            counts["left out"] = manifest["methods"]
        else:
            listed = 0
            for reason in manifest["tests"].values():
                listed += 1
                if reason == "ok":
                    counts["translated"] += 1
                else:
                    counts["left out"] += 1
                    reasons[reason] += 1
            # Test methods of classes that are not taken for test cases (in functions, say).
            rest = manifest["methods"] - listed
            if rest > 0:
                counts["left out"] += rest
                reasons["not in a test case at the top of the file"] += rest
        run = record.get("run")
        if run is not None:
            baseline = record["baseline"]["tests"]
            counts["in python"] = len(baseline)

            def problem(identifier, status, detail):
                original = baseline.get(identifier)
                entry = (module, identifier, detail)
                if original is not None and original["status"] not in GOOD:
                    counts["fails in python too"] += 1
                    not_interop[normalize(detail)].append(entry)
                else:
                    counts[status] += 1
                    cause = cause_of(module, detail) if status == "fail" else None
                    if cause:
                        causes[cause].append(entry)
                    else:
                        clusters[normalize(detail)].append(entry)

            if run["file"] is not None and run["file"]["status"] != "skip":
                status = "untranslated" if run["file"]["status"] == "untranslated" else "file error"
                original = record["baseline"]["file"]
                if original is not None and original["status"] == "error":
                    counts["fails in python too"] += counts["translated"]
                elif status == "untranslated":
                    counts["untranslated"] += counts["translated"]
                else:
                    counts["file error"] += counts["translated"]
                    clusters["(the file) " + normalize(run["file"]["detail"])] += [(module, "", run["file"]["detail"])] * max(1, counts["translated"])
            elif run["file"] is None and not run["tests"] and not run["done"] and not record["died"]:
                counts["file error"] += counts["translated"]
                clusters[f"(the file) no test ran: {record['ended']}"] += [(module, "", ["", record["ended"] or "", ""])] * max(1, counts["translated"])
            for identifier, result in run["tests"].items():
                counts["run"] += 1
                status = result["status"]
                if status in GOOD:
                    counts["pass"] += 1
                    original = baseline.get(identifier)
                    if status == "ok" and original is not None and original["status"] not in GOOD:
                        counts["passes here only"] += 1
                elif status in ("untranslated", "thread"):
                    counts[status] += 1
                else:
                    problem(identifier, "fail", result["detail"])
            for identifier, how in record["died"].items():
                counts["run"] += 1
                problem(identifier, "timeout" if how == "timeout" else "crash", ["timeout" if how == "timeout" else "CRASH", how or "", ""])
        counts["seconds"] = record["seconds"]
        total.update(counts)
        files.append({"module": module, "file": manifest["file"], "ended": record["ended"], **counts})
    return total, reasons, clusters, causes, files


def percent(part, whole):
    return f"{100 * part / whole:.1f}%" if whole else "-"


def write_score(directory, records, brief=False):
    """score.md and score.json; brief: only the head of score.md, which is what is kept beside this file."""
    total, reasons, clusters, causes, files = summarize(records)
    ordered = sorted(clusters.items(), key=lambda item: -len(item[1]))
    with open(os.devnull if brief else os.path.join(directory, "score.json"), "w") as file:
        json.dump(
            {
                "total": total,
                "left_out": dict(reasons.most_common()),
                "causes": {title: len(entries) for title, entries in causes.items()},
                "files": files,
                "clusters": [
                    {"message": message, "count": len(entries), "modules": sorted({e[0] for e in entries})[:20], "example": entries[0]}
                    for message, entries in ordered
                ],
            },
            file,
            indent=1,
        )
    lines = [
        "# The tests of CPython's standard library, translated to TypeScript: the score",
        "",
        f"- Files: {len(files)}. Test methods in them: {total['methods']}.",
        f"- Translated: {total['translated']} ({percent(total['translated'], total['methods'])}). Left out: {total['left out']}.",
        f"- Tests run (a method counts once for each class that inherits it): {total['run']}; the originals run {total['in python']} under the same bun.",
        f"- Pass: {total['pass']} ({percent(total['pass'], total['run'])} of those run).",
        f"- Fail: {total['fail']}. Crash: {total['crash']}. Timeout: {total['timeout']}. Need something that was left out: {total['untranslated']}. Need JavaScript on a second thread: {total['thread']}.",
        f"- Fail as the original does under the same bun (no matter of the translation): {total['fails in python too']}.",
        f"- Methods in files that fail to load: {total['file error']}.",
        "",
        "## Why test methods were left out",
        "",
        "| Methods | Reason |",
        "| ---: | --- |",
        *(f"| {count} | {reason} |" for reason, count in reasons.most_common()),
        "",
        "## Failures whose cause is known",
        "",
        "| Tests | Files | Cause | Example |",
        "| ---: | ---: | --- | --- |",
        *(
            f"| {len(entries)} | {len({e[0] for e in entries})} | {title} | {entries[0][0].removeprefix('test.')} {entries[0][1]} |"
            for title, entries in sorted(causes.items(), key=lambda item: -len(item[1]))
        ),
        "",
        "## The other failures, by message",
        "",
        "| Tests | Files | Message | Example |",
        "| ---: | ---: | --- | --- |",
    ]
    for message, entries in ordered[: 40 if brief else 150]:
        text = message.replace("|", "\\|")
        lines.append(f"| {len(entries)} | {len({e[0] for e in entries})} | {text} | {entries[0][0].removeprefix('test.')} {entries[0][1]} |")
    lines += [
        "",
        "## Files",
        "",
        "| File | Methods | Translated | Run | Pass | Fail | Crash, timeout | Left out at run time | As in Python | Seconds |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    if brief:
        del lines[-5:]
        files = []
    for entry in files:
        note = f" ({entry['file']})" if entry["file"] else " (does not load)" if entry.get("file error") else ""
        lines.append(
            f"| {entry['module'].removeprefix('test.')}{note} | {entry['methods']} | {entry.get('translated', 0)} | {entry.get('run', 0)} | {entry.get('pass', 0)} "
            f"| {entry.get('fail', 0)} | {entry.get('crash', 0) + entry.get('timeout', 0)} | {entry.get('untranslated', 0)} | {entry.get('fails in python too', 0)} | {entry['seconds']} |"
        )
    with open(os.path.join(directory, "score.md"), "w") as file:
        file.write("\n".join(lines) + "\n")
    return total, ordered, causes


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--lib", required=True, help="the Lib of a checkout of CPython, with Lib/test")
    parser.add_argument("--bun", required=True, help="a release build of bun")
    parser.add_argument("--out", required=True, help="a scratch directory")
    parser.add_argument("-j", type=int, default=8)
    parser.add_argument("--timeout", type=int, default=300, help="seconds for a file")
    parser.add_argument("--test-timeout", type=int, default=60, help="seconds for a test")
    parser.add_argument("--idle", type=int, default=40, help="seconds without a test ending")
    parser.add_argument("--attempts", type=int, default=12, help="how many tests of a file may crash or hang")
    parser.add_argument("--native-async", action="store_true", help="`async def` is an async function of JavaScript")
    parser.add_argument("--native-classes", action="store_true", help="a class statement is `class extends` where that is the same")
    parser.add_argument("--inline-with", action="store_true", help="`with` is always written out, never a call of with() of bun:python")
    parser.add_argument("--rebaseline", action="store_true", help="run the originals again")
    parser.add_argument("--summarize", action="store_true", help="only write the score of the last run again")
    parser.add_argument("--compare", help="the scratch directory of another run: only say what passes there and not in --out")
    parser.add_argument("--save", action="store_true", help="write the head of score.md beside this file too")
    parser.add_argument("--top", type=int, default=25, help="how many kinds of failure to print")
    parser.add_argument("modules", nargs="*")
    options = parser.parse_args()

    if options.compare:
        compare(options)
        return
    if options.summarize:
        with open(os.path.join(options.out, "records.json")) as file:
            records = json.load(file)
        if options.save:
            write_score(HERE, records, brief=True)
        show(options, *write_score(os.path.abspath(options.out), records), records)
        return
    runner = Runner(options)
    modules, libraries = find_modules(options.lib, options.modules)
    runner.libraries = frozenset(name for name, path in libraries)
    for attempt in range(2):  # The second time, those that cannot be translated are known.
        records = [runner.library(*item) for item in libraries]
    runner.library_manifests = {record["module"]: record["manifest"] for record in records}
    with concurrent.futures.ThreadPoolExecutor(options.j) as pool:
        records += pool.map(lambda item: runner.one(*item), modules)
    with open(os.path.join(runner.out, "records.json"), "w") as file:
        json.dump(records, file)
    total, ordered, causes = write_score(runner.out, records)
    if options.save:
        write_score(HERE, records, brief=True)
    show(options, total, ordered, causes, records)


def compare(options):
    """What passes in the run in --compare and does not in the run in --out, by message."""

    def load(directory):
        with open(os.path.join(directory, "records.json")) as file:
            return {record["module"]: record for record in json.load(file)}

    before, after = load(options.compare), load(options.out)
    clusters = collections.defaultdict(list)
    gained = 0
    for module, record in after.items():
        old = before.get(module, {}).get("run")
        new = record.get("run")
        if not old or not new:
            continue
        if new["file"] is not None and new["file"]["status"] == "error" and old["file"] is None:
            clusters["(the file) " + normalize(new["file"]["detail"])] += [(module, "")] * len(old["tests"])
            continue
        for identifier, result in old["tests"].items():
            now = new["tests"].get(identifier)
            if result["status"] in GOOD:
                if now is None:
                    how = record.get("died", {}).get(identifier)
                    clusters[f"{'not run' if how is None else how}"].append((module, identifier))
                elif now["status"] not in GOOD:
                    clusters[normalize(now["detail"] or [now["status"], "", ""])].append((module, identifier))
            elif now is not None and now["status"] in GOOD:
                gained += 1
    total = sum(map(len, clusters.values()))
    print(f"{total} tests pass there and not here; {gained} pass here and not there")
    for message, entries in sorted(clusters.items(), key=lambda item: -len(item[1]))[: options.top]:
        print(f"{len(entries):5} {message[:150]}   [{entries[0][0].removeprefix('test.')} {entries[0][1]}]")


def show(options, total, ordered, causes, records):
    print(
        f"{len(records)} files, {total['methods']} methods, translated {total['translated']} ({percent(total['translated'], total['methods'])}); "
        f"run {total['run']}, pass {total['pass']} ({percent(total['pass'], total['run'])}), fail {total['fail']}, crash {total['crash']}, timeout {total['timeout']}, "
        f"untranslated {total['untranslated']}, thread {total['thread']}, as in python {total['fails in python too']}, in files that do not load {total['file error']}"
    )
    for title, entries in sorted(causes.items(), key=lambda item: -len(item[1])):
        print(f"{len(entries):5} CAUSE {title}")
    for message, entries in ordered[: options.top]:
        print(f"{len(entries):5} {message[:150]}   [{entries[0][0].removeprefix('test.')} {entries[0][1]}]")


if __name__ == "__main__":
    main()
