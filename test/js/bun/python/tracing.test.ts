import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { symlinkSync } from "node:fs";
import { join } from "node:path";

// sys.monitoring, sys.settrace(), sys.setprofile(), and what is built on them.

const { BUN_PYTHON_STDLIB, PYTHONHOME, PYTHONPATH, ...env } = bunEnv;

// These builds take seconds to start Python.
if (isDebug || isASAN) setDefaultTimeout(120_000);

// The modules inside the executable are compiled once for all the tests, not once for each program they start.
const shared = tempDir("python-tracing-shared", {});
afterAll(() => shared[Symbol.dispose]());

/** With arguments that are not the name of a file, under the name python3, which has the command line of CPython. */
async function run(files: Record<string, string>, args: string[] = ["main.py"], stdin = "") {
  using tmp = tempDir("python-tracing", files);
  using bin = tempDir("python-tracing-bin", {});
  const dir = String(tmp);
  let program = bunExe();
  if (args[0].startsWith("-")) {
    program = join(String(bin), "python3");
    symlinkSync(bunExe(), program);
  }
  await using proc = Bun.spawn({
    cmd: [program, ...args],
    env: { ...env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: String(shared) },
    cwd: dir,
    stdin: new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.replaceAll(dir, "<dir>"), stderr: stderr.replaceAll(dir, "<dir>"), exitCode };
}

const printed = (stdout: string) => ({ stdout, stderr: "", exitCode: 0 });

describe.skipIf(isWindows).concurrent("tracing", () => {
  test("a trace function is told of calls, lines, returns and exceptions", async () => {
    const main = `
import sys

def inner(n):
    if n:
        raise ValueError(n)
    return 'done'

def outer():
    total = 0
    for i in range(2):
        total += i
    try:
        inner(1)
    except ValueError:
        pass
    return inner(0)

def trace(frame, event, arg):
    shown = arg[0].__name__ if event == 'exception' else arg
    print(frame.f_code.co_name, event, frame.f_lineno, shown)
    return trace

sys.settrace(trace)
outer()
sys.settrace(None)
outer()
`;
    expect(await run({ "main.py": main })).toEqual(
      printed(
        [
          "outer call 9 None",
          "outer line 10 None",
          "outer line 11 None",
          "outer line 12 None",
          "outer line 11 None",
          "outer line 12 None",
          "outer line 11 None",
          "outer line 13 None",
          "outer line 14 None",
          "inner call 4 None",
          "inner line 5 None",
          "inner line 6 None",
          "inner exception 6 ValueError",
          "inner return 6 None",
          "outer exception 14 ValueError",
          "outer line 15 None",
          "outer line 16 None",
          "outer line 17 None",
          "inner call 4 None",
          "inner line 5 None",
          "inner line 7 None",
          "inner return 7 done",
          "outer return 17 done",
          "",
        ].join("\n"),
      ),
    );
  });

  test("a trace function can read and change the variables of the frame, and say where to go on", async () => {
    const main = `
import sys

def f():
    x = 1
    y = 2
    print('skipped')
    return x, y

def trace(frame, event, arg):
    if event == 'line' and frame.f_lineno == 7:
        print(dict(frame.f_locals))
        frame.f_locals['x'] = 'changed'
        frame.f_lineno = 8
    return trace

sys.settrace(trace)
print(f())
`;
    expect(await run({ "main.py": main })).toEqual(printed("{'x': 1, 'y': 2}\n('changed', 2)\n"));
  });

  test("a profile function is told of calls of built-in functions too", async () => {
    const main = `
import sys

def f():
    return len('abc')

def profile(frame, event, arg):
    print(frame.f_code.co_name, event, getattr(arg, '__name__', arg))

sys.setprofile(profile)
f()
sys.setprofile(None)
`;
    expect(await run({ "main.py": main })).toEqual(
      printed("f call None\nf c_call len\nf c_return len\nf return 3\n<module> c_call setprofile\n"),
    );
  });

  test("each thread has its own trace function", async () => {
    const main = `
import sys, threading

def work():
    return 1

def trace(frame, event, arg):
    if frame.f_code is work.__code__:
        print(threading.current_thread().name, event)
        return trace

threading.settrace(trace)
thread = threading.Thread(target=work, name='other')
thread.start()
thread.join()
work()
print(sys.gettrace())
`;
    expect(await run({ "main.py": main })).toEqual(printed("other call\nother line\nother return\nNone\n"));
  });

  test("sys.monitoring tells tools of events, until they say DISABLE", async () => {
    const main = `
import sys
m = sys.monitoring
E = m.events

def f(n):
    total = 0
    for i in range(n):
        total += len('ab')
    return total

def show(name, result=None):
    def callback(code, *args):
        if code is f.__code__:
            print(name, *[getattr(a, '__name__', a) for a in args[name != 'LINE':]])
            return result
    return callback

m.use_tool_id(3, 'test')
for name in ('PY_START', 'PY_RETURN', 'CALL', 'C_RETURN'):
    m.register_callback(3, getattr(E, name), show(name))
m.register_callback(3, E.LINE, show('LINE', m.DISABLE))
m.set_events(3, E.PY_START | E.PY_RETURN | E.CALL | E.LINE)
f(2)
m.set_events(3, 0)
f(2)
m.free_tool_id(3)
`;
    expect(await run({ "main.py": main })).toEqual(
      printed(
        [
          "PY_START",
          "LINE 7",
          "LINE 8",
          "CALL range 2",
          "C_RETURN range 2",
          "LINE 9",
          "CALL len ab",
          "C_RETURN len ab",
          "LINE 8",
          "CALL len ab",
          "C_RETURN len ab",
          "LINE 10",
          "PY_RETURN 4",
          "",
        ].join("\n"),
      ),
    );
  });

  test("once tracing is switched off the code is as it was", async () => {
    const main = `
import sys

def f(n):
    total = 0
    for i in range(n):
        total += i
    return total

def replaced():
    return sum(place[-1] for place in sys.monitoring._places(f.__code__))

def trace(frame, event, arg):
    return trace

f(1)
print(replaced())
sys.settrace(trace)
f(1)
print(replaced() > 0)
sys.settrace(None)
print(replaced(), f(3))
sys.setprofile(lambda *args: None)
print(replaced() > 0)
sys.setprofile(None)
print(replaced(), f(3))
sys.monitoring.use_tool_id(0, 'test')
sys.monitoring.set_local_events(0, f.__code__, sys.monitoring.events.LINE)
print(replaced() > 0)
sys.monitoring.free_tool_id(0)
print(replaced(), f(3))
`;
    expect(await run({ "main.py": main })).toEqual(printed("0\nTrue\n0 3\nTrue\n0 3\nTrue\n0 3\n"));
  });

  test("what a tool has disabled is as the compiler left it while the loop still runs", async () => {
    const main = `
import sys

M = sys.monitoring
E = M.events

def one(x): return x + 1

def f(n):
    total = 0
    for i in range(n):
        if i % 2:
            total += one(i)
        else:
            total -= 1
        while total > 100:
            total -= 100
        if i == n - 1:
            print(replaced(f), replaced(one))
    return total

def replaced(function):
    return [place[1] for place in M._places(function.__code__) if place[-1]]

M.use_tool_id(1, 'test')
wanted = E.LINE | E.BRANCH_LEFT | E.BRANCH_RIGHT | E.PY_RETURN
for event in (E.LINE, E.BRANCH_LEFT, E.BRANCH_RIGHT, E.PY_RETURN):
    M.register_callback(1, event, lambda *args: M.DISABLE)
M.set_local_events(1, f.__code__, wanted)
M.set_local_events(1, one.__code__, wanted)
print(f(300))
print(replaced(f), replaced(one))
`;
    // All that is waited for is the way out of the loop, which is told of where it leads.
    expect(await run({ "main.py": main })).toEqual(printed("['op_py_ret'] []\n100\n[] []\n"));
  });

  test("pdb stops at a breakpoint, shows a variable, steps and goes on", async () => {
    const program = `def double(n):
    result = n * 2
    return result

total = 0
for i in range(3):
    total += double(i)
print('total', total)
`;
    const commands = ["b 2, n == 1", "c", "p n", "n", "p result", "w", "cl 1", "c", "q", ""].join("\n");
    const { stdout, stderr, exitCode } = await run({ "program.py": program }, ["-m", "pdb", "program.py"], commands);
    expect(stderr).toBe("");
    expect(stdout).toContain("> <dir>/program.py(1)<module>()\n-> def double(n):");
    expect(stdout).toContain("Breakpoint 1 at <dir>/program.py:2");
    expect(stdout).toContain("> <dir>/program.py(2)double()\n-> result = n * 2\n(Pdb) 1\n");
    expect(stdout).toContain("> <dir>/program.py(3)double()\n-> return result\n(Pdb) 2\n");
    expect(stdout).toContain("  <dir>/program.py(7)<module>()\n-> total += double(i)\n> <dir>/program.py(3)double()");
    expect(stdout).toContain("total 6\nThe program finished and will be restarted");
    expect(exitCode).toBe(0);
  });

  test("breakpoint() enters the debugger", async () => {
    const main = `
def f():
    x = 41
    breakpoint()
    return x + 1

print(f())
`;
    const { stdout, stderr, exitCode } = await run({ "main.py": main }, ["main.py"], "p x\nx = 1\nc\n");
    expect(stderr).toBe("");
    // On the line it is written on, not the next.
    expect(stdout).toStartWith("> <dir>/main.py(4)f()\n-> breakpoint()\n");
    expect(stdout).toContain("(Pdb) 41\n");
    expect(stdout).toEndWith("2\n");
    expect(exitCode).toBe(0);
  });

  test("a signal finds a loop on the line it goes back from", async () => {
    const main = `
import itertools, signal

def handler(signum, frame):
    raise KeyboardInterrupt

def loop():
    for i in itertools.count():
        x = i
        y = x

signal.signal(signal.SIGALRM, handler)
signal.setitimer(signal.ITIMER_REAL, 0.01)
try:
    loop()
except KeyboardInterrupt as e:
    print(e.__traceback__.tb_next.tb_lineno)
`;
    expect(await run({ "main.py": main })).toEqual(printed("10\n"));
  });

  test("workers and the main thread trace at the same time", async () => {
    const program = `
import sys

def f(n):
    total = 0
    for i in range(n):
        if i % 3:
            total += i
    return total

events = []
def tracer(frame, event, arg):
    events.append(event)
    return tracer

lines = []
monitoring = sys.monitoring
for turn in range(20):
    sys.settrace(tracer); f(5); sys.settrace(None)
    monitoring.use_tool_id(1, "test")
    monitoring.register_callback(1, monitoring.events.LINE, lambda code, line: lines.append(line))
    monitoring.set_events(1, monitoring.events.LINE)
    f(5)
    monitoring.set_events(1, 0)
    monitoring.free_tool_id(1)
    f(100)
result = f"{len(events)} {len(lines)}"
`;
    const trace = `
import { dict, exec } from "python:builtins";
export function trace() {
  const globals = dict();
  exec(${JSON.stringify(program)}, globals);
  return String(globals.result);
}
`;
    const worker = `
import { trace } from "./trace.ts";
self.onmessage = () => postMessage(trace());
`;
    const main = `
import { trace } from "./trace.ts";
const workers = [1, 2].map(() => new Worker(new URL("./worker.ts", import.meta.url).href));
const answers = workers.map(worker => new Promise(resolve => {
  worker.onmessage = event => resolve(event.data);
  worker.postMessage("go");
}));
console.log(JSON.stringify([trace(), ...(await Promise.all(answers))]));
for (const worker of workers) worker.terminate();
`;
    const files = { "main.ts": main, "worker.ts": worker, "trace.ts": trace };
    const { stdout, stderr, exitCode } = await run(files, ["main.ts"]);
    expect(stderr).toBe("");
    const [first, ...rest] = JSON.parse(stdout);
    expect(first).toMatch(/^[1-9]\d* [1-9]\d*$/);
    expect(rest).toEqual([first, first]);
    expect(exitCode).toBe(0);
  });

  test("code that ran under a tool goes when it is dropped, in the same collection as any other", async () => {
    const tools = `
import sys

def trace(frame, event, argument):
    return trace

def start(code, offset):
    pass

def run(tool, count):
    body = "def f():" + "".join(chr(10) + "    x = %d" % i for i in range(50)) + chr(10)
    for n in range(count):
        namespace = {}
        exec(compile(body, "f%d" % n, "exec"), namespace)
        if tool == "settrace":
            sys.settrace(trace)
        elif tool == "monitoring":
            sys.monitoring.use_tool_id(2, "test")
            sys.monitoring.register_callback(2, sys.monitoring.events.PY_START, start)
            sys.monitoring.set_events(2, sys.monitoring.events.PY_START)
        namespace["f"]()
        sys.settrace(None)
        if tool == "monitoring":
            sys.monitoring.set_events(2, 0)
            sys.monitoring.free_tool_id(2)
`;
    const main = `
import { heapStats } from "bun:jsc";
import { run } from "./tools.py";
const count = () => {
  Bun.gc(true);
  return heapStats().objectTypeCounts.UnlinkedFunctionCodeBlock ?? 0;
};
const left = [];
for (const tool of ["none", "settrace", "monitoring"]) {
  run(tool, 3);
  const before = count();
  run(tool, 200);
  left.push(count() - before < 100);
}
console.log(JSON.stringify(left));
`;
    expect(await run({ "main.ts": main, "tools.py": tools }, ["main.ts"])).toEqual(printed("[true,true,true]\n"));
  });

  test("cProfile counts calls", async () => {
    const main = `
import cProfile

def leaf(n):
    return len(str(n))

def top():
    return sum(leaf(i) for i in range(3))

profiler = cProfile.Profile()
profiler.runcall(top)
counts = {getattr(e.code, 'co_name', e.code): e.callcount for e in profiler.getstats()}
for name in sorted(counts):
    print(name, counts[name])
`;
    expect(await run({ "main.py": main })).toEqual(
      printed(
        [
          "<built-in method builtins.len> 3",
          "<built-in method builtins.sum> 1",
          "<genexpr> 4",
          "<method 'disable' of '_lsprof.Profiler' objects> 1",
          "leaf 3",
          "top 1",
          "",
        ].join("\n"),
      ),
    );
  });

  test("the trace module counts lines", async () => {
    const main = `
import trace

def f(n):
    total = 0
    for i in range(n):
        total += i
    return total

tracer = trace.Trace(count=1, trace=0)
tracer.runfunc(f, 3)
for (filename, line), count in sorted(tracer.results().counts.items()):
    if filename == __file__:
        print(line, count)
`;
    expect(await run({ "main.py": main })).toEqual(printed("5 1\n6 4\n7 3\n8 1\n"));
  });
});
