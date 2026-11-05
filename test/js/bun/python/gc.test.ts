import { expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isWindows, tempDir } from "harness";

// These builds take seconds to start Python.
if (isDebug || isASAN) setDefaultTimeout(60_000);

async function run(main: string, env: Record<string, string> = {}) {
  using dir = tempDir("python-gc", { "main.py": main });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.py"],
    env: { ...bunEnv, ...env },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent("del and gc.collect() free an object, whatever registers it went through", async () => {
  const { stdout, stderr, exitCode } = await run(`
import gc, weakref

class A: pass

a = A(); r = weakref.ref(a); del a; gc.collect(); print(r())

def variable():
    b = A(); r = weakref.ref(b); del b; gc.collect(); print(r())
variable()

def temporary():
    r = weakref.ref(A()); gc.collect(); print(r())
temporary()

def element():
    x = [A()]
    r = weakref.ref(x[0])
    x.clear()
    gc.collect()
    print(r())
element()

def named():
    # A variable keeps its object, used again or not.
    c = A(); r = weakref.ref(c); gc.collect(); print(r() is not None)
named()

def argument(x, r):
    del x
    gc.collect()
    return r()
def caller():
    d = A()
    return argument(d, weakref.ref(d)) is d
print(caller())
`);
  expect(stderr).toBe("");
  expect(stdout).toBe("None\nNone\nNone\nNone\nTrue\nTrue\n");
  expect(exitCode).toBe(0);
});

test.concurrent("finalizers run once, see live objects, and may resurrect", async () => {
  const { stdout, stderr, exitCode } = await run(`
import gc, weakref

class Node:
    def __init__(self, name): self.name = name; self.other = None
    def __del__(self): print("del", self.name, self.other.name if self.other else None)

n = Node("single"); del n; gc.collect()

a, b = Node("a"), Node("b"); a.other, b.other = b, a
del a, b; gc.collect()
print("cycle collected")

kept = []
class Phoenix:
    def __del__(self): print("rising"); kept.append(self)
p = Phoenix(); r = weakref.ref(p); del p; gc.collect()
print(len(kept), r() is None)
kept.clear(); gc.collect()
print("gone for good")

class Bad:
    def __del__(self): raise ValueError("in __del__")
x = Bad(); del x; gc.collect()
print("still running")

def generator():
    try:
        yield 1
    finally:
        print("generator closed")
g = generator(); next(g); del g; gc.collect()

last = Node("at exit")
print("end")
`);
  expect(stdout).toBe(
    [
      "del single None",
      "del a b",
      "del b a",
      "cycle collected",
      "rising",
      "1 False",
      "gone for good",
      "still running",
      "generator closed",
      "end",
      "del at exit None",
      "",
    ].join("\n"),
  );
  expect(stderr).toContain("ValueError: in __del__");
  expect(exitCode).toBe(0);
});

test.concurrent("finalizers and weak reference callbacks run without gc.collect(), at a safe point", async () => {
  const { stdout, stderr, exitCode } = await run(`
import weakref

log = []
class A:
    def __del__(self): log.append("del")
class B: pass

def churn():
    A()
    w = weakref.ref(B(), lambda r: log.append("callback"))
    n = 0
    while len(log) < 2:
        [n] * 10000
        n += 1
    return w()
print(churn(), sorted(log))
`);
  expect(stderr).toBe("");
  expect(stdout).toBe("None ['callback', 'del']\n");
  expect(exitCode).toBe(0);
});

// The kernel counts the wakes that the event loop has not looked at yet, and shows the number.
test
  .skipIf(!isLinux)
  .concurrent("a collection wakes the event loop once, not for each weak reference callback", async () => {
    const { stdout, stderr, exitCode } = await run(`
import gc, os, weakref

def wakes():
    total = 0
    for fd in os.listdir("/proc/self/fd"):
        try:
            if os.readlink("/proc/self/fd/" + fd) != "anon_inode:[eventfd]":
                continue
            with open("/proc/self/fdinfo/" + fd) as f:
                for line in f:
                    if line.startswith("eventfd-count:"):
                        total += int(line.split()[1], 16)
        except OSError:
            pass
    return total

class C: pass
called = 0
def callback(reference):
    global called
    called += 1

objects = [C() for _ in range(5000)]
references = [weakref.ref(o, callback) for o in objects]
before = wakes()
del objects
gc.collect()
print(called, wakes() - before)
`);
    expect(stderr).toBe("");
    const [called, wakes] = stdout.trim().split(" ").map(Number);
    expect(called).toBe(5000);
    expect(wakes).toBeGreaterThan(0);
    expect(wakes).toBeLessThan(10);
    expect(exitCode).toBe(0);
  });

test.concurrent("an object is finalized before what it refers to", async () => {
  const { stdout, stderr, exitCode } = await run(`
import gc, os, tempfile
log = []
class Node:
    def __init__(self, name, *children):
        self.name = name; self.children = list(children); self.closed = False
    def __del__(self):
        log.append((self.name, [c.name + ("(closed)" if c.closed else "") for c in self.children]))
        self.closed = True

def show(title):
    gc.collect()
    print(title, log); log.clear()

c = Node("child"); p = Node("parent", c); del c, p
show("the child was made first:")
p = Node("parent"); p.children.append(Node("child")); del p
show("the parent was made first:")
a = Node("a"); b = Node("b"); a.children.append(b); b.extra = {"k": [Node("c")]}; b.children.append(b.extra["k"][0]); del a, b
show("three levels:")
d = Node("d"); l = Node("l", d); r = Node("r", d); t = Node("t", l, r); del d, l, r, t
gc.collect(); print("a diamond:", log[0], sorted(log[1:3]), log[3]); log.clear()
x = Node("x"); y = Node("y", x); x.children.append(y); x.children.append(Node("hanging")); del x, y
gc.collect(); print("a cycle:", sorted(n for n, _ in log), log[-1][0]); log.clear()

keep = []
class Phoenix(Node):
    def __del__(self):
        super().__del__(); keep.append(self)
p = Phoenix("phoenix", Node("its child")); del p
show("a parent that finds itself a home keeps its child:")
print(keep[0].children[0].closed)
keep.clear()
show("until it goes:")

head = None
for i in range(2000):
    head = Node(str(i), *([head] if head else []))
del head
gc.collect()
print("a chain:", len(log), [n for n, _ in log[:3]], [n for n, _ in log[-2:]], all("(closed)" not in "".join(c) for _, c in log))

path = tempfile.mktemp()
class Writer:
    def __init__(self, file): self.file = file
    def __del__(self): self.file.write("written by __del__"); self.file.close()
Writer(open(path, "w"))
gc.collect()
print(open(path).read())
os.remove(path)
`);
  expect(stderr).toBe("");
  expect(stdout).toBe(
    [
      "the child was made first: [('parent', ['child']), ('child', [])]",
      "the parent was made first: [('parent', ['child']), ('child', [])]",
      "three levels: [('a', ['b']), ('b', ['c']), ('c', [])]",
      "a diamond: ('t', ['l', 'r']) [('l', ['d']), ('r', ['d'])] ('d', [])",
      "a cycle: ['hanging', 'x', 'y'] hanging",
      "a parent that finds itself a home keeps its child: [('phoenix', ['its child'])]",
      "False",
      "until it goes: [('its child', [])]",
      "a chain: 2000 ['1999', '1998', '1997'] ['1', '0'] True",
      "written by __del__",
      "",
    ].join("\n"),
  );
  expect(exitCode).toBe(0);
});

test.concurrent("what a suspended generator keeps is a value, whatever the stack held", async () => {
  // The list of the comprehension is made in a register that earlier calls used for the frames of their callees, inside the
  // range of the handler that cleans up after the comprehension.
  const { stdout, stderr, exitCode } = await run(`
import gc

def f(*a, **k):
    return len(a) + len(k)

def gen(xs):
    a = yield f(1, 2, 3, 4, 5, x=f(1))
    b = yield f(xs, b"some data")
    yield f(a, b, (yield f(*[f(x, x) for x in xs])))
    try:
        yield f(f(1), [x for x in xs], *[f(x, x) for x in xs])
    finally:
        yield f(xs, k={x: f(x) for x in xs})

kept = []
for _ in range(20):
    g = gen([1, 2, 3])
    kept.append(g)
    out = []
    for v in g:
        gc.collect()
        out.append(v)
print(out)
suspended = [gen([1]) for _ in range(50)]
for n in range(3):
    for g in suspended: next(g)
    gc.collect()
print(len(suspended))
`);
  expect(stderr).toBe("");
  expect(stdout).toBe("[6, 2, 3, 3, 5, 2]\n50\n");
  expect(exitCode).toBe(0);
});

// It takes seconds of work for the difference to show, which these builds would make minutes.
test.concurrent("a generator that has been suspended for long has no code block any more", async () => {
  // The collector lets go of a code block that has not run for some seconds and is on no stack. With this option, at once.
  const { stdout, stderr, exitCode } = await run(
    `import gc, inspect, traceback

def g():
    a = 1
    b = [2]
    yield a
    c = lambda: b
    yield b
    yield 3

async def co(future):
    x = 5
    await future
    return x

async def ag():
    y = 6
    yield y
    yield y + 1

def outer():
    z = 7
    yield from g()

class Future:
    def __await__(self):
        yield self
    def __repr__(self):
        return 'Future()'

x = g(); next(x)
o = outer(); next(o)
c = co(Future()); c.send(None)
a = ag()
try:
    a.asend(None).send(None)
except StopIteration:
    pass
looped = g(); next(looped)
closed = g(); next(closed)
thrown = g(); next(thrown)
fresh = g()
del g, co, ag, outer
for i in range(4):
    gc.collect()

for name, frame in (('x', x.gi_frame), ('o', o.gi_frame), ('c', c.cr_frame), ('a', a.ag_frame)):
    print(name, frame.f_lineno, frame.f_lasti > 0, frame.f_locals, frame.f_code.co_name, frame.f_back)
print('fresh', fresh.gi_frame.f_lineno, fresh.gi_frame.f_locals)
print(inspect.getgeneratorlocals(x), inspect.getgeneratorstate(x), inspect.getcoroutinelocals(c), inspect.getcoroutinestate(c))
print(o.gi_yieldfrom.gi_frame.f_lineno, o.gi_yieldfrom.gi_frame.f_locals)
print(traceback.format_stack(x.gi_frame)[-1].split(', ', 1)[1].strip())
x.gi_frame.f_locals['a'] = 10
print(x.gi_frame.f_locals['a'], next(x), x.gi_frame.f_lineno, sorted(x.gi_frame.f_locals))
print(next(o), c.cr_frame.f_lineno, [v for v in looped], list(fresh))
try:
    c.send(None)
except StopIteration as e:
    print('returned', e.value)
print(closed.close(), closed.gi_frame)
try:
    thrown.throw(KeyError('k'))
except KeyError as e:
    print([(entry.name, entry.lineno) for entry in traceback.extract_tb(e.__traceback__)])
`,
    { BUN_JSC_forceCodeBlockToJettisonDueToOldAge: "1" },
  );
  expect(stderr).toBe("");
  expect(stdout).toBe(`x 6 True {'a': 1, 'b': [2]} g None
o 23 True {'z': 7} outer None
c 13 True {'future': Future(), 'x': 5} co None
a 18 True {'y': 6} ag None
fresh 3 {}
{'a': 1, 'b': [2]} GEN_SUSPENDED {'future': Future(), 'x': 5} CORO_SUSPENDED
6 {'a': 1, 'b': [2]}
line 6, in g
    yield a
10 [2] 8 ['a', 'b', 'c']
[2] 13 [[2], 3] [1, [2], 3]
returned 5
None None
[('<module>', 62), ('g', 6)]
`);
  expect(exitCode).toBe(0);
});

test.skipIf(isDebug || isASAN || isWindows)(
  "idle threads do not collect again and again beside a thread that works",
  async () => {
    const { stdout, stderr, exitCode } = await run(`
import argparse, collections, gc, hashlib, inspect, io, os, select, threading, time, tokenize

# For a given time, not a given amount of work: what is counted comes so many times a second, on a fast machine and on a slow one.
def full_collections_during(work):
    before = gc.get_stats()[2]["collections"]
    work(time.monotonic() + 1.5)
    return gc.get_stats()[2]["collections"] - before

# Generators and lists that live for a while.
source = inspect.getsource(argparse)
def tokenizes(end):
    kept = collections.deque(maxlen=20)
    while time.monotonic() < end:
        kept.append(list(tokenize.generate_tokens(io.StringIO(source).readline))[:200])

# Nearly all the time in native code, without the GIL.
class A:
    def __del__(self):
        pass
data = bytes(32 * 1024 * 1024)
def hashes(end):
    kept = collections.deque(maxlen=200)
    while time.monotonic() < end:
        kept.extend(A() for j in range(20))
        hashlib.sha256(data).digest()

heap = [[i] for i in range(600000)]   # So that a full collection takes a while.
condition = threading.Condition()
def waits():
    with condition:
        condition.wait()
threading.Thread(target=waits, daemon=True).start()
threading.Thread(target=select.select, args=([os.pipe()[0]], [], []), daemon=True).start()
print(full_collections_during(tokenizes), full_collections_during(hashes))
`);
    expect(stderr).toBe("");
    const [whileTokenizing, whileHashing] = stdout.trim().split(" ").map(Number);
    // A handful: the engine's own, and those of the idle threads, which have a twentieth of the time. One every 50 ms or so was 22
    // while tokenizing, and 9 to 21 while hashing.
    expect(whileTokenizing).toBeLessThan(10);
    expect(whileHashing).toBeLessThan(8);
    expect(exitCode).toBe(0);
  },
  30_000,
);

test.skipIf(isDebug || isASAN || isWindows)(
  "a thread that polls and drops something each time round does not collect all the time",
  async () => {
    const { stdout, stderr, exitCode } = await run(`
import gc, time
class C: pass
class D:
    def __del__(self):
        global finalized
        finalized += 1
finalized = 0
heap = [C() for _ in range(1000000)]   # So that a full collection takes a while.
before = gc.get_stats()[2]["collections"]
for i in range(700):
    D()
    time.sleep(0.001)
print(gc.get_stats()[2]["collections"] - before, finalized > 0)
`);
    expect(stderr).toBe("");
    const [collections, finalized] = stdout.trim().split(" ");
    // The short waits add up to a long one, so it does collect. One collection for every 50 ms of waiting was 22 and more.
    expect(finalized).toBe("True");
    expect(Number(collections)).toBeLessThan(8);
    expect(exitCode).toBe(0);
  },
  30_000,
);
