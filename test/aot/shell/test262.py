#!/usr/bin/env python3
"""Runs test262, the conformance suite of ECMAScript, through the ahead-of-time compiler.

    JSC=<jsc> TESTAOT=<testaot> FRONT_END=<bun> python3 test/aot/shell/test262.py <test262> [options] <folder under test262/test>...
    python3 test/aot/shell/test262.py <test262> --bun <bun> [options] built-ins language

    <test262>       a checkout of https://github.com/tc39/test262 (WebKit has one in JSTests/test262)
    --bun <bun>     build each batch with `bun build --compile --aot` and run the executable, instead of using the three tools
    --plain         run the same programs in the plain engine (`jsc`, or `bun run` with --bun): a failure there is not the compiler's fault
    --jobs <n>      batches at a time (default 6)
    --batch <n>     tests in a batch (default 40)
    --limit <n>     take only n tests, spread evenly
    --out <file>    write the result of every test that does not pass as JSON: { <test>: [<status>, <detail>] }
    --known <file>  what --out wrote in an earlier run, as that of the Bun from before a change: print only what has changed, and exit with 1
                    if a test that passed no longer does

toolchain.py's docstring says how to build the tools. All of built-ins and language takes three minutes on four cores in the shell.

Many tests are compiled as ONE program, because the front end takes about a second to start: the harness files at the top level, and
each test as the body of a function that is called with `this` = globalThis inside try | catch. A batch that does not compile,
crashes or times out is split in two and tried again, down to single tests.

Everything runs as module code, so only tests that may run in strict mode are taken. Not taken, and counted by reason: the flags
raw, noStrict, module and async; negative tests of the parse and resolution phases, which test the parser; tests whose text uses
eval, Function(), `with` or the host object $262; tests that need one of a dozen harness files that do such things.
One change is made to the harness: verifyProperty() always restores the property it verified, because the tests of a batch share their
built-ins.

The statuses: pass . fail (the detail is what was thrown) . locked (it failed because built-ins cannot be changed) . frontend, engine,
build (a single test that is not compiled, and why) . run (it was compiled and crashed or timed out).
"""
import argparse, concurrent.futures, hashlib, json, os, re, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import toolchain

WORK = os.path.abspath(os.environ.get("WORK", os.path.join(tempfile.gettempdir(), "aot-test262")))
ENV = dict(os.environ)
UNUSABLE_HARNESS = {
    "nativeFunctionMatcher.js", "wellKnownIntrinsicObjects.js", "fnGlobalObject.js", "agent.js", "atomicsHelper.js", "detachArrayBuffer.js", "hidden-constructors.js",
    "tcoHelper.js", "asyncHelpers.js", "doneprintHandle.js", "timer.js", "resizableArrayBufferUtils.js",
}
UNSUPPORTED_FEATURE = r"(?:not compiled yet:|bun compile does not support|--aot does not support|compile\.aot does not support) (.*)"
PRELUDE = """
if (typeof print === "undefined") globalThis.print = function (text) { console.log(text); };
function __run(name, negative, body) {
  try { body.call(globalThis); }
  catch (e) {
    if (negative !== "" && e !== null && typeof e === "object" && e.constructor && e.constructor.name === negative) { print("PASS " + name); return; }
    var text; try { text = String(e); } catch (x) { text = "(an error that cannot be printed)"; }
    print("FAIL " + name + " :: " + text.slice(0, 160).replace(/\\n/g, " ")); return;
  }
  print(negative === "" ? "PASS " + name : "FAIL " + name + " :: expected " + negative);
}
"""


def metadata(text):
    meta = {"includes": [], "flags": [], "negative": None}
    found = re.search(r"/\*---(.*?)---\*/", text, re.S)
    if not found:
        return meta
    yaml = found.group(1)
    for key in ("includes", "flags"):
        inline = re.search(r"^\s*" + key + r":\s*\[(.*?)\]", yaml, re.S | re.M)
        listed = re.search(r"^\s*" + key + r":\s*\n((?:\s+-\s*.*\n?)+)", yaml, re.M)
        if inline:
            meta[key] = [x.strip() for x in inline.group(1).split(",") if x.strip()]
        elif listed:
            meta[key] = [x.strip()[1:].strip() for x in listed.group(1).strip().split("\n")]
    if "negative:" in yaml:
        phase, kind = re.search(r"phase:\s*(\w+)", yaml), re.search(r"type:\s*(\w+)", yaml)
        meta["negative"] = (phase.group(1) if phase else "runtime", kind.group(1) if kind else "Error")
    return meta


def skip_reason(text, meta):
    for flag in ("raw", "noStrict", "module", "async"):
        if flag in meta["flags"]:
            return flag
    if any(flag.startswith("CanBlock") for flag in meta["flags"]):
        return "agent"
    if meta["negative"] and meta["negative"][0] != "runtime":
        return "negative-" + meta["negative"][0]
    body = re.sub(r"/\*---.*?---\*/", "", text, flags=re.S)
    if "$262" in body:
        return "host"
    if re.search(r"\beval\s*\(|\beval\b\s*[;,)=]|\bFunction\s*\(|new\s+Function\b|\(0,\s*eval\)", body):
        return "eval"
    if re.search(r"\bwith\s*\(", body):
        return "with"
    if any(name in UNUSABLE_HARNESS for name in meta["includes"]):
        return "harness"
    if re.search(r"^\s*(import|export)\s", body, re.M):
        return "module"
    return None


harness_files = {}


def harness(name):
    if name not in harness_files:
        text = open(f"{ROOT}/harness/{name}").read()
        if name == "propertyHelper.js":
            text = text.replace("if (options && options.restore) {\n    __defineProperty(obj, name, originalDesc);", "{\n    __defineProperty(obj, name, originalDesc);")
        harness_files[name] = text
    return harness_files[name]


def program(tests):
    includes = ["assert.js", "sta.js"]
    for test in tests:
        includes += [name for name in test["includes"] if name not in includes]
    parts = [harness(name) for name in includes] + [PRELUDE]
    parts += ["__run(%s, %s, function () {\n%s\n});" % (json.dumps(t["name"]), json.dumps(t["negative"] or ""), t["text"]) for t in tests]
    return "\n".join(parts + ['print("END");'])


def describe_exit(code, said):
    return "timeout" if code is None else f"signal {-code}" if code < 0 else said[:160]


def describe_build_failure(code, said):
    unsupported = re.search(UNSUPPORTED_FEATURE, said)
    return describe_exit(code, unsupported.group(1) if unsupported else (re.search(r"error[^\n]*", said) or [said[:120] or "no output"])[0])


def results_of(code, said):
    lines = said.split("\n")
    if "END" not in lines:
        return None, "run", describe_exit(code, said.strip().split("\n")[-1])
    results = {}
    for line in lines:
        if line.startswith("PASS "):
            results[line[5:]] = ("pass", "")
        elif line.startswith("FAIL "):
            name, _, detail = line[5:].partition(" :: ")
            results[name] = ("locked" if "because built-in objects are read" in detail else "fail", detail)
    return results, None, None


def attempt(tests):
    """Returns ({ name: (status, detail) }, None, None), or (None, the stage that failed, why) if the batch as a whole failed."""
    key = hashlib.sha1("\n".join(t["name"] for t in tests).encode()).hexdigest()[:12]
    source, ir, image, executable = (f"{WORK}/{key}.{x}" for x in ("js", "ir", "image", "exe"))
    open(source, "w").write(program(tests))
    try:
        if OPTIONS.plain:
            return results_of(*toolchain.run([OPTIONS.bun, "run", source] if OPTIONS.bun else [JSC, "--useDollarVM=1", "prelude.js", "-m", source], HERE, 120, ENV))
        if OPTIONS.bun:
            code, said = toolchain.run([OPTIONS.bun, "build", "--compile", "--aot", source, "--outfile", executable], WORK, 240, ENV)
            if not os.path.exists(executable):
                return None, "build", describe_build_failure(code, said)
            return results_of(*toolchain.run([executable], WORK, 120, ENV))
        try:
            toolchain.front_end(source, ir, cwd=HERE, seconds=120, env=ENV)
        except toolchain.ToolFailed as failed:
            return None, "frontend", describe_build_failure(failed.code, failed.said)
        try:
            entries = toolchain.compile_image(ir, image, cwd=HERE, seconds=240, env=ENV)
        except toolchain.ToolFailed as failed:
            return None, "engine", describe_exit(failed.code, failed.said.strip().split("\n")[0])
        return results_of(*toolchain.run_image(image, entries[0], ENV, cwd=HERE))
    finally:
        for file in (source, ir, image, executable):
            if os.path.exists(file):
                os.remove(file)


def solve(tests):
    results, stage, why = attempt(tests)
    if results is not None:
        return results
    if len(tests) == 1:
        return {tests[0]["name"]: (stage, why)}
    half = len(tests) // 2
    return {**solve(tests[:half]), **solve(tests[half:])}


def counted(values):
    count = {}
    for value in values:
        count[value] = count.get(value, 0) + 1
    return ", ".join(f"{key} {count[key]}" for key in sorted(count))


parser = argparse.ArgumentParser(usage=__doc__)
parser.add_argument("root")
parser.add_argument("folders", nargs="+")
parser.add_argument("--bun")
parser.add_argument("--plain", action="store_true")
parser.add_argument("--jobs", type=int, default=6)
parser.add_argument("--batch", type=int, default=40)
parser.add_argument("--limit", type=int, default=0)
parser.add_argument("--out")
parser.add_argument("--known")
OPTIONS = parser.parse_args()
ROOT = os.path.abspath(OPTIONS.root)
if not OPTIONS.bun:
    JSC = toolchain.tool("JSC")
    if not OPTIONS.plain:
        toolchain.tool("TESTAOT")
        toolchain.tool("FRONT_END")
os.makedirs(WORK, exist_ok=True)

files = []
for folder in OPTIONS.folders:
    path = f"{ROOT}/test/{folder}"
    if os.path.isfile(path):
        files.append(path)
    for base, _, names in os.walk(path):
        files += [f"{base}/{name}" for name in names if name.endswith(".js") and "_FIXTURE" not in name]
files.sort()
if OPTIONS.limit:
    files = files[:: max(1, len(files) // OPTIONS.limit)][: OPTIONS.limit]
taken, skipped = [], {}
for file in files:
    text = open(file, errors="replace").read()
    meta, name = metadata(text), file[len(ROOT) + 6 :]
    reason = skip_reason(text, meta)
    if reason:
        skipped[name] = reason
    else:
        taken.append({"name": name, "text": text, "includes": meta["includes"], "negative": meta["negative"][1] if meta["negative"] else None})
batches = [taken[i : i + OPTIONS.batch] for i in range(0, len(taken), OPTIONS.batch)]
print(f"{len(files)} files, {len(taken)} taken in {len(batches)} batches, {len(skipped)} not taken", flush=True)

results, started = {}, time.time()
with concurrent.futures.ThreadPoolExecutor(OPTIONS.jobs) as pool:
    for done, batch in enumerate(pool.map(solve, batches), 1):
        results.update(batch)
        if done % 20 == 0:
            print(f"  {done} of {len(batches)} batches, {time.time() - started:.0f} s", flush=True)
if OPTIONS.out:
    json.dump({name: result for name, result in results.items() if result[0] != "pass"}, open(OPTIONS.out, "w"), indent=0, sort_keys=True)
print("results:", counted(status for status, _ in results.values()))
print("not taken:", counted(skipped.values()))

if OPTIONS.known:
    known = json.load(open(OPTIONS.known))
    worse = sorted(name for name, (status, _) in results.items() if status != "pass" and known.get(name, ["pass"])[0] == "pass")
    better = sorted(name for name, (status, _) in results.items() if status == "pass" and known.get(name, ["pass"])[0] != "pass")
    for name in worse:
        print(f"NO LONGER PASSES: {name}: {results[name][0]}: {results[name][1]}")
    print(f"against {OPTIONS.known}: {len(worse)} no longer pass, {len(better)} pass now")
    sys.exit(1 if worse else 0)
else:
    for name, (status, detail) in sorted(results.items()):
        if status not in ("pass", "locked"):
            print(f"{status}: {name}: {detail}")
