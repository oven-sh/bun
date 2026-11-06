import { expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, readdirSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, tempDir } from "harness";
import { join } from "path";

// These builds take seconds to start Python.
if (isDebug || isASAN) setDefaultTimeout(60_000);

async function run(files: Record<string, string>, cmd: string[] = ["main.js"]) {
  using dir = tempDir("python-import-py", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...cmd],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent("a file is one module, whatever else has its name", async () => {
  const result = await run({
    "a/util.py": `where = "a/util"\nimport helper\nhelper_is = helper.where`,
    "a/helper.py": `where = "a/helper"`,
    "b/util.py": `where = "b/util"`,
    "types.py": `where = "./types.py"\nimport types\nstdlib = hasattr(types, "ModuleType")`,
    "pkg/__init__.py": `where = "pkg"`,
    "pkg/inner.py": `from . import where as parent\nwhere = "pkg.inner"`,
    "counter.py": `count = 0\ndef bump():\n    global count\n    count += 1\n    return count`,
    "uses_counter.py": `import counter\ndef bump(): return counter.bump()`,
    "main.js": `
      import a from "./a/util.py";
      import b from "./b/util.py";
      import t from "./types.py";
      import inner from "./pkg/inner.py";
      import counter from "./counter.py";
      import usesCounter from "./uses_counter.py";
      const again = await import("./b/util.py");
      console.log(a.where, a.helper_is, b.where, t.where, t.stdlib, inner.where, inner.parent, inner.__name__);
      console.log(again.default === b, counter.bump(), usesCounter.bump(), counter.count);
    `,
  });
  expect(result).toEqual({
    stdout: "a/util a/helper b/util ./types.py true pkg.inner pkg pkg.inner\ntrue 1 2 2\n",
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("what a plugin supplies for a .py path is used", async () => {
  const result = await run({
    "real.py": `value = "from disk"`,
    "main.js": `
      Bun.plugin({
        name: "py",
        setup(build) {
          build.onLoad({ filter: /as-js\\.py$/ }, () => ({ contents: "export default 'JavaScript, as without a loader'" }));
          build.onLoad({ filter: /as-python\\.py$/ }, () => ({ contents: "value = 'Python: ' + __file__.rpartition('/')[2]", loader: "python" }));
        },
      });
      const asJS = await import("./as-js.py");
      const asPython = await import("./as-python.py");
      const real = await import("./real.py");
      console.log(asJS.default);
      console.log(asPython.value);
      console.log(real.value);
    `,
    "as-js.py": `value = "never read"`,
    "as-python.py": `value = "never read"`,
  });
  expect(result).toEqual({
    stdout: "JavaScript, as without a loader\nPython: as-python.py\nfrom disk\n",
    stderr: "",
    exitCode: 0,
  });
});

// What else the bundler does with it: boundary/tooling.test.ts.
test.concurrent("the bundler leaves the import of a .py file as it is", async () => {
  using dir = tempDir("python-bundle", {
    "tool.py": `print("a tool")`,
    "entry.js": `import tool from "./tool.py"; console.log(tool);`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.js", "--target=bun", "--outdir=out"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toContain(`warn: "./tool.py" is not bundled`);
  expect(readdirSync(join(String(dir), "out"))).toEqual(["entry.js"]);
  expect(await Bun.file(join(String(dir), "out", "entry.js")).text()).toContain(`from "./tool.py"`);
  expect(exitCode).toBe(0);
});

test("Bun.Transpiler refuses the python loader", () => {
  // @ts-expect-error
  expect(() => new Bun.Transpiler().transformSync("print(1)", "python")).toThrow(
    `loader "python" is not supported in Bun.Transpiler`,
  );
});

test.concurrent.skipIf(!isLinux)("a JavaScript program named python is JavaScript", async () => {
  using dir = tempDir("python-shebang", {
    "python": `#!${bunExe()}\nconsole.log("JavaScript");\n`,
  });
  chmodSync(join(String(dir), "python"), 0o755);
  await using proc = Bun.spawn({
    cmd: [join(String(dir), "python")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "JavaScript\n", stderr: "", exitCode: 0 });
});

test.concurrent("JavaScript may pass a Python function more than it takes", async () => {
  const result = await run({
    "m.py": `
def one(v): return v * 2
class C:
    def __init__(self, k): self.k = k
    def add(self, v): return v + self.k
def star(*a): return len(a)
def two(a, b): return a + b
def strict():
    try: one(1, 2, 3)
    except TypeError as e: return str(e)
`,
    "main.js": `
      import { one, C, star, two, strict } from "./m.py";
      console.log([1, 2, 3].map(one), [1, 2].map(new C(10).add), star(1, 2, 3), two(1, 2, 3));
      try { two(1); } catch (e) { console.log(String(e)); }
      console.log(strict());
    `,
  });
  expect(result).toEqual({
    stdout:
      "[ 2, 4, 6 ] [ 11, 12 ] 3 3\n" +
      "TypeError: two() missing 1 required positional argument: 'b'\n" +
      "one() takes 1 positional argument but 3 were given\n",
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("the traceback of a module that has awaited shows the program's frames only", async () => {
  using dir = tempDir("python-tla-traceback", {
    "main.py": `import asyncio\nawait asyncio.sleep(0)\ndef f(): return 1 / 0\nf()\n`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.py"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr: stderr.replaceAll(String(dir), "<dir>"), exitCode }).toEqual({
    stdout: "",
    stderr:
      "Traceback (most recent call last):\n" +
      '  File "<dir>/main.py", line 4, in <module>\n' +
      "    f()\n" +
      "    ~^^\n" +
      '  File "<dir>/main.py", line 3, in f\n' +
      "    def f(): return 1 / 0\n" +
      "                    ~~^~~\n" +
      "ZeroDivisionError: division by zero\n",
    exitCode: 1,
  });
});

test.concurrent("print() and console.log() to a pipe come out in the order they were called", async () => {
  const result = await run({
    "m.py": `
import js, sys
def say(text): print(text)
def both():
    print("3 python")
    js.console.log("4 javascript, called by python")
    sys.stdout.write("5 python, no newline; ")
    js.console.log("javascript")
    sys.stdout.buffer.write(b"6 python, bytes\\n")
`,
    "main.js": `
      import { say, both } from "./m.py";
      console.log("1 javascript");
      say("2 python");
      both();
      console.log("7 javascript");
      say("8 python");
    `,
  });
  expect(result).toEqual({
    stdout:
      "1 javascript\n2 python\n3 python\n4 javascript, called by python\n" +
      "5 python, no newline; javascript\n6 python, bytes\n7 javascript\n8 python\n",
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("what a module still holds when the program ends is finalized, a holder before what only it holds", async () => {
  // JavaScript holds on to the module, so none of this ever dies.
  const result = await run({
    "m.py": `
import io, os
def say(*words): os.write(1, (" ".join(map(str, words)) + "\\n").encode())
class Raw(io.RawIOBase):
    def __init__(self, name): self.name = name
    def writable(self): return True
    def write(self, data): say(self.name, "write", bytes(data)); return len(data)
    def close(self): say(self.name, "close"); super().close()
class T:
    def __init__(self, name, *holds): self.name = name; self.holds = holds
    def __del__(self): say(self.name)
file = io.BufferedWriter(Raw("raw")); file.write(b"xyz")
holder = T("holder", [T("child", T("grandchild"))])
child_with_a_name = T("child with a name"); its_holder = T("its holder", child_with_a_name)
# What holds one another is entered where it has a name.
raw = Raw("raw that knows its writer"); writer = io.BufferedWriter(raw); raw.owner = writer; del raw; writer.write(b"abc")
raw = Raw("raw with an older holder"); older = T("older holder", raw); other = io.BufferedWriter(raw); raw.owner = other; del raw; other.write(b"def")
child = T("child that knows its parent"); registry = T("registry", child); parent = T("parent", child); child.parent = parent; del child
def hello(): return "hello"
`,
    "main.js": `
      import { hello } from "./m.py";
      console.log(hello());
    `,
  });
  expect(result.stdout.split("\n")).toEqual([
    "hello",
    "raw write b'xyz'",
    "raw close",
    "holder",
    "child",
    "grandchild",
    "child with a name",
    "its holder",
    "raw that knows its writer write b'abc'",
    "raw that knows its writer close",
    "older holder",
    "raw with an older holder write b'def'",
    "raw with an older holder close",
    "registry",
    "parent",
    "child that knows its parent",
    "",
  ]);
  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
});
