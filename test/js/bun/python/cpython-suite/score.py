#!/usr/bin/env python3
"""The scoreboard: CPython's own test suite (Lib/test) under Bun's python3.

    score.py [options] [name ...]

Every test module (Lib/test/test_*.py, and each test_*.py inside the test packages) is run in a process of its own with
`python3 -m test --junit-xml ... name`, several at a time, with a time limit. A module in which a test kills the interpreter or
hangs is run again without that test (regrtest's --ignore), and so on, so that every such test is found and the rest of the
module still counts. What comes out:

    score.md      the table, the totals, the crashes and hangs, the failures grouped by cause, and what changed since the last run
    score.json    the same for programs
    logs/NAME.txt what the run printed, for everything that did not simply pass

Names restrict the run to those modules (prefixes work: `test_asyncio` is the whole package); the results of the others are
kept from the last run.

    --bun PATH      Bun (default: $BUN_EXE, or build/release/bun in this checkout); it is run through a link named python3
    --python CMD    another command in its place
    --lib PATH      CPython's Lib, with Lib/test, which is not in the executable (default: vendor/cpython/Lib in this checkout)
    --oracle        run CPython instead ($PYTHON_ORACLE, or python3.15), and write oracle.json: what passes there is what can be
                    expected to pass. It uses its own installed library, which has to have the tests.
    -j N            processes at a time (default 12)
    --timeout S     seconds for one run of a module (default 300)
    --idle S        seconds without any output after which a run counts as hung (default 75)
    --rounds N      how many times a module is run again without the test that crashed or hung (default 12)
    --tag NAME      write score-NAME.md, score-NAME.json and logs-NAME/ instead (a run with another build, say)
    --list          print the names and exit
"""

import argparse
import collections
import concurrent.futures
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
REPOSITORY = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(HERE)))))
LIB = os.path.join(REPOSITORY, "vendor", "cpython", "Lib")

# Not tests of the language or the library, or hopeless by design. Listed, not run.
EXCLUDED = {
    "test_gdb": "debugs CPython with gdb",
    "test_capi": "the C API",
    "test_cext": "builds an extension module",
    "test_cppext": "builds an extension module",
    "test_peg_generator": "builds CPython's parser generator",
    "test_tools": "tools of the CPython repository",
    "test_freeze": "builds CPython",
    "test_embed": "embeds CPython (needs Programs/_testembed)",
    "test_clinic": "Argument Clinic",
    "test_generated_cases": "CPython's interpreter generator",
    "test_idle": "Tk",
    "test_tkinter": "Tk",
    "test_ttk": "Tk",
    "test_ttk_textonly": "Tk",
    "test_tcl": "Tk",
    "test_turtle": "Tk",
    "test_ctypes": "ctypes",
    "test_winapi": "Windows",
    "test_winreg": "Windows",
    "test_winsound": "Windows",
    "test_winconsoleio": "Windows",
    "test_wmi": "Windows",
    "test_msvcrt": "Windows",
    "test_launcher": "Windows",
    "test_android": "Android",
    "test_apple": "iOS",
}


def portable(text):
    """What is written to the files that are kept says nothing of where things are on this machine."""
    text = text.replace(LIB, "<Lib>").replace(os.path.dirname(LIB), "<cpython>")
    text = re.sub(re.escape(tempfile.gettempdir()) + r"/score-\w+", "<tmp>", text)
    return re.sub(re.escape(tempfile.gettempdir()) + r"/bun-python3-links-\d+/\w+/", "", text)


# Some test files cannot be imported without a helper module of CPython's that is written in C, though few of their tests use it.
# shims/NAME holds a stand-in, written in Python, that is there to be imported: see README.md. It is on the path of the test
# modules listed here and of no others, because test.support and many tests do something sensible when a helper is missing.
SHIMS = {
    "_testmultiphase": ["test_import", "test_importlib", "test_runpy", "test_pkgutil", "test_compileall", "test_pyclbr", "test_unittest.test_discovery"],
    "_testinternalcapi": ["test_class", "test_with"],
    "_testlimitedcapi": ["test_bytes", "test_class"],
    "_testcapi": ["test_traceback"],
}


# What a shim lets through though it needs the real thing, and has no guard of its own. Not run.
IGNORED = {
    # Runs a script in a child that imports test_importlib/util.py, without the shim.
    "test_importlib.extension.test_loader": ["test.test_importlib.extension.test_loader.NonModuleExtensionTests.test_nonmodule_cases"],
}


# Tests that are skipped here for want of a C helper, but not before their setUp() has taken something that only tearDown() gives
# back, which is not run for a test that setUp() skips: every test after them in the module would fail. Not run.
SPOILERS = {
    "test_monitoring": ["test.test_monitoring.TestCApiEventGeneration.*"],
}


def shim_path(name):
    return os.pathsep.join(os.path.join(HERE, "shims", shim) for shim, users in SHIMS.items() if any(name == user or name.startswith(user + ".") for user in users))


def find_tests():
    names = []
    root = os.path.join(LIB, "test")

    def walk(directory, prefix):
        for entry in sorted(os.listdir(directory)):
            path = os.path.join(directory, entry)
            if entry.startswith("test_") and entry.endswith(".py"):
                names.append(prefix + entry[:-3])
            elif os.path.isdir(path) and os.path.exists(os.path.join(path, "__init__.py")):
                # Below the top, a package of tests may be called anything (test_importlib/source).
                if prefix or entry.startswith("test_"):
                    before = len(names)
                    walk(path, prefix + entry + ".")
                    if len(names) == before and entry.startswith("test_"):
                        names.append(prefix + entry)

    walk(root, "")
    return names


def excluded_reason(name):
    return EXCLUDED.get(name.split(".")[0])


CRASH_MARKERS = [
    (re.compile(r"ASSERTION FAILED: (.*)"), "assertion"),
    (re.compile(r"(SHOULD NEVER BE REACHED.*)"), "assertion"),
    (re.compile(r"panic(?:ked)?(?: at |: )(.*)"), "panic"),
    (re.compile(r"(Segmentation fault at address \S+)"), "segv"),
    (re.compile(r"(oh no: Bun has crashed.*)"), "crash"),
    (re.compile(r"(Fatal Python error: .*)"), "fatal"),
    (re.compile(r"(AddressSanitizer: \S+.*)"), "asan"),
    (re.compile(r"(Illegal instruction at address \S+)"), "sigill"),
]


def first_line(text, limit=160):
    for line in text.strip().splitlines():
        line = line.strip()
        if line:
            return line[:limit]
    return ""


def last_exception_line(text):
    """The last line of the last traceback in the output."""
    found = ""
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if re.match(r"^[A-Za-z_][\w.]*(Error|Exception|Warning|Exit|Interrupt|Failed|SkipTest)\b.*", line) or re.match(r"^[A-Za-z_][\w.]*: ", line) and i and lines[i - 1].startswith((" ", "\t")):
            found = line
    return found[:200]


RESULT_WORDS = r"(?:ok|FAIL|ERROR|skipped\b.*|expected failure|unexpected success)"


def unfinished_test(output):
    """The id of the test that had started and not ended when the output stopped."""
    starts = list(re.finditer(r"^\w+ \(([\w.<>]+)\)", output, re.M))
    if not starts:
        return None
    rest = output[starts[-1].end():]
    if re.search(r"\.\.\. .*?" + RESULT_WORDS + r"\s*$", rest, re.M) or re.search(r"^" + RESULT_WORDS + r"$", rest, re.M):
        return None
    return starts[-1].group(1)


def communicate(process, timeout, idle):
    """(output, why it was killed or None)"""
    import selectors
    chunks = []
    started = last = time.monotonic()
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    os.set_blocking(process.stdout.fileno(), False)
    while True:
        now = time.monotonic()
        if now - started > timeout:
            return b"".join(chunks), "time limit"
        if now - last > idle:
            return b"".join(chunks), "no output for %d s" % idle
        if selector.select(1.0):
            data = process.stdout.read()
            if data == b"":
                process.wait()
                return b"".join(chunks), None
            if data:
                chunks.append(data)
                last = time.monotonic()


def run_once(name, python, limits, extra_env, ignored):
    timeout, idle = limits
    work = tempfile.mkdtemp(prefix="score-")
    xml_path = os.path.join(work, "result.xml")
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": work,
        "TMPDIR": work,
        "LANG": "C.UTF-8",
        "TERM": "dumb",
        "BUN_DEBUG_QUIET_LOGS": "1",
        "BUN_CRASH_REPORT_URL": "http://127.0.0.1:1/",
        "BUN_ENABLE_CRASH_REPORTING": "0",
        "DO_NOT_TRACK": "1",
    }
    env.update(extra_env)
    command = python + ["-m", "test", "--junit-xml", xml_path, "--tempdir", work, "-v"]
    for test in ignored:
        command += ["--ignore", test]
    command.append(name)
    started = time.monotonic()
    result = {"name": name}
    process = subprocess.Popen(command, cwd=work, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True,
                               preexec_fn=lambda: __import__("resource").setrlimit(__import__("resource").RLIMIT_CORE, (0, 0)))
    try:
        output, timed_out = communicate(process, timeout, idle)
    finally:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
        process.wait()
        process.stdout.close()
    output = output.decode("utf-8", "replace")
    result["seconds"] = round(time.monotonic() - started, 1)
    result["returncode"] = process.returncode

    cases = []
    if os.path.exists(xml_path):
        try:
            for case in ET.parse(xml_path).getroot().iter("testcase"):
                outcome, detail = "passed", ""
                for child in case:
                    if child.tag in ("error", "failure", "skipped"):
                        outcome = {"error": "error", "failure": "failed", "skipped": "skipped"}[child.tag]
                        kind = child.get("type") or ""
                        message = first_line(child.get("message") or "")
                        detail = (kind + ": " + message) if kind and outcome != "skipped" else message
                        break
                cases.append((case.get("name") or "?", outcome, detail))
        except ET.ParseError:
            pass
    if not cases:
        # It did not get to write the file: what it said as it went along.
        for match in re.finditer(r"^(\w+ \([\w.<>]+\)).*?\.\.\. .*?(ok|FAIL|ERROR|skipped|expected failure|unexpected success)\b", output, re.M | re.S):
            if "\n\n" in match.group(0):
                continue
            outcome = {"ok": "passed", "expected failure": "passed", "FAIL": "failed", "unexpected success": "failed", "ERROR": "error", "skipped": "skipped"}[match.group(2)]
            cases.append((match.group(1), outcome, ""))
    counts = collections.Counter(outcome for _, outcome, _ in cases)
    result.update(ran=len(cases), passed=counts["passed"], failed=counts["failed"], errors=counts["error"], skipped=counts["skipped"])
    result["problems"] = [[case, outcome, detail] for case, outcome, detail in cases if outcome in ("failed", "error")]

    died = process.returncode < 0 or process.returncode in (132, 133, 134, 139)
    crash = None
    if died:
        for pattern, kind in CRASH_MARKERS:
            match = pattern.search(output)
            if match:
                crash = kind + ": " + match.group(1).strip()[:160]
                break
    result["culprit"] = unfinished_test(output) if timed_out or died else None
    if timed_out:
        result["status"] = "timeout"
        result["reason"] = timed_out
    elif died:
        result["status"] = "crashed"
        number = -process.returncode if process.returncode < 0 else process.returncode - 128
        try:
            signame = signal.Signals(number).name
        except ValueError:
            signame = "status %d" % process.returncode
        result["reason"] = "%s; %s" % (signame, crash or "")
    elif not cases:
        if re.search(r"^%s skipped -- |Tests result: (NO TESTS RAN|SUCCESS)|run no tests|skipped \(resource denied\)" % re.escape(name), output, re.M) and process.returncode in (0, 4):
            result["status"] = "skipped"
            match = re.search(r"skipped -- (.*)", output)
            result["reason"] = match.group(1)[:160] if match else "no tests ran"
        else:
            result["status"] = "no result"
            result["reason"] = last_exception_line(output) or first_line(output[-300:])
    elif counts["failed"] or counts["error"] or process.returncode not in (0,):
        result["status"] = "failed"
        if not (counts["failed"] or counts["error"]):
            result["reason"] = last_exception_line(output) or ("exit status %d" % process.returncode)
    else:
        result["status"] = "passed"
    shutil.rmtree(work, ignore_errors=True)
    return result, output


def run_one(name, python, limits, extra_env, rounds):
    """Runs the module, again and again without the tests that kill the interpreter or hang."""
    incidents, outputs = [], []
    seconds = 0
    while True:
        result, output = run_once(name, python, limits, extra_env, [i["test"] for i in incidents] + (IGNORED.get(name, []) if "PYTHONPATH" in extra_env else []) + (SPOILERS.get(name, []) if "BUN_PYTHON_STDLIB" in extra_env else []))
        seconds += result["seconds"]
        outputs.append(output)
        if result["status"] not in ("crashed", "timeout"):
            break
        incidents.append({"test": result["culprit"], "kind": "crash" if result["status"] == "crashed" else "hang", "reason": result["reason"]})
        if not result["culprit"] or len(incidents) > rounds:
            break
    result["seconds"] = round(seconds, 1)
    result["incidents"] = incidents
    if incidents:
        result["status"] = "crashed" if any(i["kind"] == "crash" for i in incidents) else "timeout"
        result["reason"] = "; ".join("%s: %s" % (i["kind"], (i["test"] or "?").split(".", 2)[-1]) for i in incidents)[:300]
    del result["culprit"]
    return result, ("\n\n======== again, without that test ========\n\n").join(outputs)


# ---- Causes ----

CAUSES = [
    ("threads", re.compile(r"can't start new thread|cannot start new thread|threading|_thread\b|ThreadPoolExecutor|RuntimeError: .*thread", re.I)),
    ("missing module: \\1", re.compile(r"(?:ModuleNotFoundError|ImportError): (?:No module named |Standard library module )'?([\w.]+)'?")),
    ("missing name: \\1", re.compile(r"ImportError: cannot import name '(\w+)'")),
    ("missing attribute of module: \\1.\\2", re.compile(r"AttributeError: module '([\w.]+)' has no attribute '(\w+)'")),
    ("missing attribute of type: \\1.\\2", re.compile(r"AttributeError: (?:type object )?'([\w.]+)'(?: object)? has no attribute '(\w+)'")),
    ("not implemented", re.compile(r"NotImplementedError")),
    ("recursion", re.compile(r"RecursionError")),
    ("warnings expected or unexpected", re.compile(r"Warning(?: not triggered|s? not triggered)|DeprecationWarning|ResourceWarning|SyntaxWarning|RuntimeWarning")),
    ("exception not raised", re.compile(r"AssertionError: \w+ not raised")),
    ("message differs", re.compile(r'AssertionError: ".*" does not match|Regex didn\'t match|does not match')),
    ("child process", re.compile(r"Process return code is|stderr not empty|subprocess|CalledProcessError|exit code")),
    ("weak references, finalizers, reference counts", re.compile(r"is not None$|weakref|getrefcount|gc\.|__del__|finaliz", re.I)),
    ("value differs", re.compile(r"AssertionError")),
    ("TypeError", re.compile(r"^TypeError")),
    ("ValueError", re.compile(r"^ValueError")),
    ("AttributeError", re.compile(r"^AttributeError")),
    ("OSError", re.compile(r"^(OSError|FileNotFoundError|PermissionError|\w*Error: \[Errno)")),
]


def cause_of(detail):
    for label, pattern in CAUSES:
        match = pattern.search(detail)
        if match:
            return match.expand(label) if "\\" in label else label
    return detail.split(":")[0][:40] or "?"


def write_reports(results, previous, oracle, directory, title, filename="score.md"):
    order = sorted(results)
    totals = collections.Counter()
    statuses = collections.Counter()
    for name in order:
        r = results[name]
        statuses[r["status"]] += 1
        for key in ("ran", "passed", "failed", "errors", "skipped"):
            totals[key] += r.get(key, 0)

    lines = ["# CPython's test suite under Bun", "", title, ""]
    lines += ["## Totals", "",
              "| modules | " + " | ".join(sorted(statuses)) + " |", "|---|" + "---|" * len(statuses),
              "| %d | " % len(order) + " | ".join(str(statuses[s]) for s in sorted(statuses)) + " |", "",
              "| tests run | passed | failed | errors | skipped |", "|---|---|---|---|---|",
              "| %(ran)d | %(passed)d | %(failed)d | %(errors)d | %(skipped)d |" % totals, ""]
    if oracle:
        expected = sum(o.get("passed", 0) for n, o in oracle.items() if n in results)
        lines += ["CPython itself, on this machine, in the same harness, passes %d tests in these modules: **%.1f%%** of them pass here." % (expected, 100.0 * totals["passed"] / max(expected, 1)), ""]

    def section(kind, heading):
        rows = [(results[n], i) for n in order for i in results[n].get("incidents", []) if i["kind"] == kind]
        if not rows:
            return
        lines.extend(["## %s (%d, in %d modules)" % (heading, len(rows), len({r["name"] for r, _ in rows})), "", "| module | test | what |", "|---|---|---|"])
        for r, i in rows:
            lines.append("| %s | %s | %s |" % (r["name"], (i["test"] or "(not in a test)").replace("test." + r["name"] + ".", ""), (i.get("reason") or "").replace("|", "\\|")))
        lines.append("")

    section("crash", "Tests that kill the interpreter")
    section("hang", "Tests that hang")

    rows = [results[n] for n in order if results[n]["status"] == "no result"]
    if rows:
        groups = collections.defaultdict(list)
        for r in rows:
            groups[cause_of(r.get("reason") or "")].append(r)
        lines += ["## Modules that could not be run at all (%d), by cause" % len(rows), "", "| cause | modules | which |", "|---|---|---|"]
        for cause, members in sorted(groups.items(), key=lambda item: -len(item[1])):
            lines.append("| %s | %d | %s |" % (cause.replace("|", "\\|"), len(members), ", ".join(m["name"] for m in members[:12]) + (" ..." if len(members) > 12 else "")))
        lines.append("")

    causes = collections.Counter()
    where = collections.defaultdict(collections.Counter)
    examples = {}
    for name in order:
        for case, outcome, detail in results[name].get("problems", []):
            cause = cause_of(detail)
            causes[cause] += 1
            where[cause][name.split(".")[0]] += 1
            examples.setdefault(cause, "%s: %s" % (case, detail))
    if causes:
        lines += ["## Failing tests by cause (%d)" % sum(causes.values()), "", "| cause | tests | mostly in | example |", "|---|---|---|---|"]
        for cause, count in causes.most_common(60):
            top = ", ".join("%s (%d)" % item for item in where[cause].most_common(4))
            lines.append("| %s | %d | %s | %s |" % (cause.replace("|", "\\|"), count, top, examples[cause][:150].replace("|", "\\|")))
        lines.append("")

    if previous:
        changed = []
        for name in order:
            old, new = previous.get(name), results[name]
            if not old:
                continue
            if old["status"] != new["status"] or old.get("passed") != new.get("passed"):
                changed.append("| %s | %s, %d passed | %s, %d passed |" % (name, old["status"], old.get("passed", 0), new["status"], new.get("passed", 0)))
        before = sum(r.get("passed", 0) for r in previous.values())
        lines += ["## Since the last run", "", "Tests passed: %d -> %d." % (before, totals["passed"]), ""]
        if changed:
            lines += ["| module | before | now |", "|---|---|---|"] + changed[:200] + [""]

    lines += ["## All modules", "", "| module | status | ran | passed | failed | errors | skipped | CPython passes | seconds | reason |", "|---|---|---|---|---|---|---|---|---|---|"]
    for name in order:
        r = results[name]
        o = oracle.get(name, {}) if oracle else {}
        lines.append("| %s | %s | %d | %d | %d | %d | %d | %s | %s | %s |" % (
            name, r["status"], r.get("ran", 0), r.get("passed", 0), r.get("failed", 0), r.get("errors", 0), r.get("skipped", 0),
            o.get("passed", ""), r.get("seconds", ""), (r.get("reason") or "").replace("|", "\\|")[:140]))
    lines.append("")
    excluded = sorted({n.split(".")[0] for n in find_tests() if excluded_reason(n)})
    lines += ["## Not run", "", "| package | why |", "|---|---|"] + ["| %s | %s |" % (n, EXCLUDED[n]) for n in excluded] + [""]
    with open(os.path.join(directory, filename), "w") as f:
        f.write(portable("\n".join(lines)))
    return totals, statuses


def python_link(binary):
    """Bun is python3 when that is the name it is started under."""
    directory = os.path.join(tempfile.gettempdir(), "bun-python3-links-%d" % os.getuid(), hashlib.sha256(binary.encode()).hexdigest()[:12])
    os.makedirs(directory, exist_ok=True)
    link = os.path.join(directory, "python3")
    if not os.path.islink(link) or os.readlink(link) != binary:
        if os.path.lexists(link):
            os.remove(link)
        os.symlink(binary, link)
    return link


def main():
    global LIB
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("names", nargs="*")
    parser.add_argument("--python")
    parser.add_argument("--bun", default=os.environ.get("BUN_EXE", os.path.join(REPOSITORY, "build", "release", "bun")))
    parser.add_argument("--lib", default=LIB)
    parser.add_argument("--oracle", action="store_true")
    parser.add_argument("-j", type=int, default=12)
    parser.add_argument("--timeout", type=float, default=300)
    parser.add_argument("--idle", type=float, default=75)
    parser.add_argument("--rounds", type=int, default=12)
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--tag")
    options = parser.parse_args()
    LIB = os.path.realpath(options.lib)

    names = [n for n in find_tests() if not excluded_reason(n)]
    if options.names:
        names = [n for n in names if any(n == w or n.startswith(w + ".") for w in options.names)]
    if options.list:
        print("\n".join(names))
        return

    extra_env = {}
    if options.oracle:
        python, target = [os.environ.get("PYTHON_ORACLE", "python3.15")], "oracle.json"
    else:
        python = options.python.split() if options.python else [python_link(os.path.realpath(options.bun))]
        extra_env["BUN_PYTHON_STDLIB"] = LIB
        target = "score-%s.json" % options.tag if options.tag else "score.json"

    path = os.path.join(HERE, target)
    previous = {}
    if os.path.exists(path):
        with open(path) as f:
            previous = json.load(f)["modules"]
    results = dict(previous) if options.names else {}

    logs = os.path.join(HERE, "oracle-logs" if options.oracle else "logs-" + options.tag if options.tag else "logs")
    os.makedirs(logs, exist_ok=True)
    started = time.time()
    done = 0
    with concurrent.futures.ThreadPoolExecutor(options.j) as pool:
        def environment(name):
            path = "" if options.oracle else shim_path(name)
            return dict(extra_env, PYTHONPATH=path) if path else extra_env

        futures = {pool.submit(run_one, n, python, (options.timeout, options.idle), environment(n), options.rounds): n for n in names}
        for future in concurrent.futures.as_completed(futures):
            result, output = future.result()
            results[result["name"]] = result
            done += 1
            log = os.path.join(logs, result["name"] + ".txt")
            if result["status"] == "passed":
                if os.path.exists(log):
                    os.remove(log)
            else:
                with open(log, "w") as f:
                    f.write(output)
            if result["status"] not in ("passed", "skipped") or len(names) < 30:
                print("[%d/%d] %-45s %-9s ran %4d passed %4d  %s" % (done, len(names), result["name"], result["status"], result["ran"], result["passed"], (result.get("reason") or "")[:90]), flush=True)

    with open(path, "w") as f:
        f.write(portable(json.dumps({"when": time.strftime("%Y-%m-%d %H:%M"), "python": [os.path.basename(python[0])] + python[1:], "modules": results}, indent=1, sort_keys=True)) + "\n")
    if options.oracle:
        passed = sum(r.get("passed", 0) for r in results.values())
        print("oracle: %d modules, %d tests passed" % (len(results), passed))
        return
    oracle = {}
    if os.path.exists(os.path.join(HERE, "oracle.json")):
        with open(os.path.join(HERE, "oracle.json")) as f:
            oracle = json.load(f)["modules"]
    title = "Run of %s with `%s`, %d at a time, %d s a module; took %d s." % (time.strftime("%Y-%m-%d %H:%M"), " ".join([os.path.basename(python[0])] + python[1:]), options.j, options.timeout, time.time() - started)
    totals, statuses = write_reports(results, previous, oracle, HERE, title, "score-%s.md" % options.tag if options.tag else "score.md")
    print(dict(statuses))
    print(dict(totals))


if __name__ == "__main__":
    main()
