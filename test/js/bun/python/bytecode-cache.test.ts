import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { existsSync, readdirSync, readFileSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// A module is compiled once: importlib keeps the code in a .pyc file, as in CPython.

const { BUN_PYTHON_STDLIB, PYTHONHOME, PYTHONPATH, ...env } = bunEnv;

// These builds take seconds to start Python.
if (isDebug || isASAN) setDefaultTimeout(120_000);

// The modules inside the executable are compiled once for all the tests, not once for each program they start.
const shared = tempDir("python-pyc-shared", {});
afterAll(() => shared[Symbol.dispose]());

async function run(
  dir: string,
  args: string[] = ["main.py"],
  extraEnv: Record<string, string> = {},
  program = bunExe(),
) {
  await using proc = Bun.spawn({
    cmd: [program, ...args],
    env: { ...env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: String(shared), ...extraEnv },
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.replaceAll(dir, "<dir>"), stderr: stderr.replaceAll(dir, "<dir>"), exitCode };
}

const printed = (stdout: string) => ({ stdout, stderr: "", exitCode: 0 });

/** Other text in the file, which looks untouched to whoever goes by its size and time. */
function replaceUnnoticed(path: string, text: string) {
  const { atime, mtime, size } = statSync(path);
  expect(Buffer.byteLength(text)).toBe(size);
  writeFileSync(path, text);
  utimesSync(path, atime, mtime);
}

const files = { "main.py": "import mod\n", "mod.py": "print('first')\n" };
const cached = (dir: string, name = "mod") => join(dir, "__pycache__", `${name}.bun-315.pyc`);

describe.skipIf(isWindows).concurrent("compiled code is kept in files", () => {
  test("the second run does not read the source", async () => {
    using tmp = tempDir("python-pyc", files);
    const dir = String(tmp);
    expect(await run(dir)).toEqual(printed("first\n"));
    expect(readdirSync(join(dir, "__pycache__"))).toEqual(["mod.bun-315.pyc"]);
    replaceUnnoticed(join(dir, "mod.py"), "print('other')\n");
    expect(await run(dir)).toEqual(printed("first\n"));
  });

  test("a source that has changed is compiled again", async () => {
    using tmp = tempDir("python-pyc", files);
    const dir = String(tmp);
    expect(await run(dir)).toEqual(printed("first\n"));
    writeFileSync(join(dir, "mod.py"), "print('the second')\n");
    expect(await run(dir)).toEqual(printed("the second\n"));
    replaceUnnoticed(join(dir, "mod.py"), "print('the third.')\n");
    expect(await run(dir)).toEqual(printed("the second\n"));
  });

  test("a file that is damaged, cut short or somebody else's is written anew", async () => {
    using tmp = tempDir("python-pyc", files);
    const dir = String(tmp);
    expect(await run(dir)).toEqual(printed("first\n"));
    const good = readFileSync(cached(dir));
    const flipped = (at: number) => {
      const copy = Buffer.from(good);
      copy[at] ^= 0x40;
      return copy;
    };
    const bad: Record<string, Buffer> = {
      empty: Buffer.alloc(0),
      "only part of the header": good.subarray(0, 10),
      "only the start of the code": good.subarray(0, 17),
      "half of it": good.subarray(0, good.length >> 1),
      "all but the last byte": good.subarray(0, good.length - 1),
      "a byte too many": Buffer.concat([good, Buffer.from([0])]),
      "another build's": flipped(0),
      "another build's that has the same magic number": flipped(20),
      "damaged at the start of the code": flipped(16 + 1 + 28 + 2),
      "damaged in the middle": flipped(good.length >> 1),
      "damaged at the end": flipped(good.length - 1),
      // 3.14's magic number, and the start of a code object as CPython writes it.
      "CPython's": Buffer.concat([
        Buffer.from([0x2b, 0x0e, 0x0d, 0x0a]),
        good.subarray(4, 16),
        Buffer.from([0xe3, 0, 0, 0, 0]),
      ]),
    };
    for (const [what, contents] of Object.entries(bad)) {
      writeFileSync(cached(dir), contents);
      expect({ what, ...(await run(dir)) }).toEqual({ what, ...printed("first\n") });
      expect({ what, isGood: readFileSync(cached(dir)).equals(good) }).toEqual({ what, isGood: true });
    }

    // What is whole, but is no code, is a mistake that nobody makes by accident. As in CPython, it is reported.
    for (const [rest, error] of [
      ["", "EOFError: EOF read where object expected"],
      ["N", "ImportError: Non-code object in '<dir>/__pycache__/mod.bun-315.pyc'"],
    ]) {
      writeFileSync(cached(dir), Buffer.concat([good.subarray(0, 16), Buffer.from(rest)]));
      const { stdout, stderr, exitCode } = await run(dir);
      expect({ stdout, error: stderr.trimEnd().split("\n").at(-1), exitCode }).toEqual({
        stdout: "",
        error,
        exitCode: 1,
      });
    }
  });

  test("nothing is written if that is not wanted, or cannot be done", async () => {
    using tmp = tempDir("python-pyc", {
      ...files,
      "blocked/main.py": files["main.py"],
      "blocked/mod.py": files["mod.py"],
    });
    const dir = String(tmp);
    expect(await run(dir, ["main.py"], { PYTHONDONTWRITEBYTECODE: "1" })).toEqual(printed("first\n"));
    expect(existsSync(join(dir, "__pycache__"))).toBe(false);

    symlinkSync(bunExe(), join(dir, "python3"));
    expect(await run(dir, ["-B", "main.py"], {}, join(dir, "python3"))).toEqual(printed("first\n"));
    expect(existsSync(join(dir, "__pycache__"))).toBe(false);

    writeFileSync(join(dir, "blocked", "__pycache__"), "not a directory");
    expect(await run(join(dir, "blocked"))).toEqual(printed("first\n"));
  });

  test("PYTHONPYCACHEPREFIX, -O", async () => {
    using tmp = tempDir("python-pyc", {
      "main.py": "import mod\n",
      "mod.py": "assert False, 'checked'\nprint(__debug__, __spec__.cached)\n",
    });
    const dir = String(tmp);
    const prefix = { PYTHONPYCACHEPREFIX: join(dir, "elsewhere"), PYTHONOPTIMIZE: "1" };
    for (let i = 0; i < 2; i++)
      expect(await run(dir, ["main.py"], prefix)).toEqual(
        printed("False <dir>/elsewhere<dir>/mod.bun-315.opt-1.pyc\n"),
      );
    expect(existsSync(join(dir, "__pycache__"))).toBe(false);
    expect(existsSync(join(dir, "elsewhere", dir, "mod.bun-315.opt-1.pyc"))).toBe(true);
    // Code compiled with other options is other code.
    const { stderr, exitCode } = await run(dir);
    expect(stderr).toEndWith("AssertionError: checked\n");
    expect(exitCode).toBe(1);
  });

  test("a .pyc file without its source is a module", async () => {
    using tmp = tempDir("python-pyc", {
      "make.py": "import py_compile; print(py_compile.compile('mod.py', cfile='alone.pyc'))",
      "mod.py": "def where(): return __file__, where.__code__.co_filename\n",
      "main.py": "import alone; print(alone.where(), type(alone.__loader__).__name__)",
    });
    const dir = String(tmp);
    expect(await run(dir, ["make.py"])).toEqual(printed("alone.pyc\n"));
    expect(await run(dir)).toEqual(printed("('<dir>/alone.pyc', 'mod.py') SourcelessFileLoader\n"));
  });

  test("a .pyc file is a program", async () => {
    using tmp = tempDir("python-pyc", {
      "make.py":
        "import py_compile; py_compile.compile('program.py', cfile='program.pyc'); py_compile.compile('program.py', cfile='renamed')",
      "program.py": "import sys; print(__name__, __file__, type(__loader__).__name__, sys.argv)\n",
      "bad.pyc": "not compiled code",
    });
    const dir = String(tmp);
    symlinkSync(bunExe(), join(dir, "python3"));
    const python3 = (...args: string[]) => run(dir, args, {}, join(dir, "python3"));
    expect(await python3("make.py")).toEqual(printed(""));
    expect(await python3("program.pyc", "a")).toEqual(
      printed("__main__ <dir>/program.pyc SourcelessFileLoader ['program.pyc', 'a']\n"),
    );
    expect(await python3("renamed")).toEqual(printed("__main__ <dir>/renamed SourcelessFileLoader ['renamed']\n"));
    expect(await python3("bad.pyc")).toEqual({
      stdout: "",
      stderr: "RuntimeError: Bad magic number in .pyc file\n",
      exitCode: 1,
    });
  });

  test("a .pyc file that goes by the contents of the source", async () => {
    using tmp = tempDir("python-pyc", {
      ...files,
      "make.py":
        "import py_compile, sys; py_compile.compile('mod.py', invalidation_mode=py_compile.PycInvalidationMode[sys.argv[1]])",
    });
    const dir = String(tmp);
    expect(await run(dir, ["make.py", "CHECKED_HASH"])).toEqual(printed(""));
    const flags = () => readFileSync(cached(dir)).readUInt32LE(4);
    expect(flags()).toBe(0b11);
    expect(await run(dir)).toEqual(printed("first\n"));
    replaceUnnoticed(join(dir, "mod.py"), "print('other')\n");
    expect(await run(dir)).toEqual(printed("other\n"));
    expect(flags()).toBe(0b11);

    expect(await run(dir, ["make.py", "UNCHECKED_HASH"])).toEqual(printed(""));
    expect(flags()).toBe(0b01);
    writeFileSync(join(dir, "mod.py"), "print('not looked at')\n");
    expect(await run(dir)).toEqual(printed("other\n"));
  });

  test("the modules inside the executable have their code in the user's cache directory", async () => {
    using tmp = tempDir("python-pyc", {
      "main.py": "import os, json, sys; print(json.__spec__.cached, sys.pycache_prefix)",
    });
    const dir = String(tmp);
    const expected = printed("/$bunfs/python/lib/python3.15/json/__pycache__/__init__.bun-315.pyc None\n");
    const cache = { BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(dir, "cache") };
    expect(await run(dir, ["main.py"], cache)).toEqual(expected);
    const builds = readdirSync(join(dir, "cache", "@py@"));
    expect(builds).toEqual([expect.stringMatching(/^[0-9a-f]{16}$/)]);
    const library = join(dir, "cache", "@py@", builds[0], "python", "lib");
    const inCache = (...path: string[]) => readdirSync(join(library, ...path, "__pycache__"));
    expect(inCache("python3.15")).toContain("os.bun-315.pyc");
    expect(inCache("python3.15", "json")).toContain("decoder.bun-315.pyc");
    // These two are loaded before there is an importlib to do it.
    expect(inCache("python3.15", "importlib")).toEqual(
      expect.arrayContaining(["_bootstrap.bun-315.pyc", "_bootstrap_external.bun-315.pyc"]),
    );
    expect(inCache("bun")).toContain("_bun_import.bun-315.pyc");

    const written = (directory: string): Record<string, number> =>
      Object.fromEntries(
        readdirSync(directory, { recursive: true, withFileTypes: true })
          .filter(entry => entry.isFile())
          .map(entry => [join(entry.parentPath, entry.name), statSync(join(entry.parentPath, entry.name)).mtimeMs]),
      );
    const before = written(library);
    expect(await run(dir, ["main.py"], cache)).toEqual(expected);
    expect(written(library)).toEqual(before);

    // No cache, and no place for one.
    expect(await run(dir, ["main.py"], { BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" })).toEqual(expected);
    expect(await run(dir, ["main.py"], { BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(dir, "main.py") })).toEqual(expected);
  });

  test("code out of a file is what the compiler made", async () => {
    using tmp = tempDir("python-pyc", {
      "main.py": "import mod\n",
      "helper.py": "value = 'helped'\n",
      "mod.py": `"""About the module."""
import asyncio, inspect, traceback
lazy import helper

CONSTANTS = (1, 2.0, -0.0, 1.5, 10 ** 30, "text", "é\\U0001f600", b"bytes", 3j, None, True, ..., (4, (5.0,)), frozenset({6}))

def function(a, /, b=2, *rest, c, d: int = 4, **more) -> "result":
    "About the function."
    local = a + b
    return lambda: (local, rest, c, d, more)

class Class(dict, metaclass=type):
    "About the class."
    attribute: str = "value"
    __slots__ = ("slot",)
    def method(self, x=CONSTANTS[1]):
        return __class__, super().__repr__(), x
    @property
    def computed(self): return [i * j for i in range(2) for j in range(3) if j in {1, 2}]

def generator(n):
    try:
        received = yield from range(n)
        yield received
    finally:
        print("generator closed")

async def coroutine():
    async def numbers():
        for i in range(2):
            await asyncio.sleep(0)
            yield i
    return [i async for i in numbers()]

def fails(x):
    match x:
        case {"key": [first, *_]} if first: return first
        case _:
            assert x[1:2] == "never", f"{x!r:>5}"

def show(code, depth=0):
    print(" " * depth, code.co_name, code.co_qualname, code.co_filename, code.co_firstlineno, code.co_argcount, code.co_posonlyargcount,
          code.co_kwonlyargcount, code.co_flags, code.co_varnames, code.co_cellvars, code.co_freevars, code.co_names,
          [c for c in code.co_consts if not inspect.iscode(c)], list(code.co_lines())[:3], list(code.co_positions())[:2])
    for constant in code.co_consts:
        if inspect.iscode(constant):
            show(constant, depth + 1)

print(__doc__, __name__, __file__, __spec__.cached, type(__loader__).__name__)
print(CONSTANTS, [type(c).__name__ for c in CONSTANTS])
print(function(1, c=3)(), function(1, 2, 3, c=4, e=5)(), function.__doc__, function.__defaults__, function.__kwdefaults__, function.__annotations__)
print(inspect.signature(function), Class.__doc__, Class.__annotations__, Class().method(), Class().computed)
print(list(generator(2)), asyncio.run(coroutine()), fails({"key": [7]}), helper.value)
try:
    fails("abc")
except AssertionError:
    traceback.print_exc(file=__import__("sys").stdout)
print(inspect.getsource(fails), inspect.getsourcelines(Class.method)[1])
for f in function, Class.method, generator, coroutine, fails:
    show(f.__code__)
`,
    });
    const dir = String(tmp);
    const cold = await run(dir);
    expect(cold.stderr).toBe("");
    expect(cold.stdout).toContain("AssertionError: 'abc'");
    expect(cold.stdout).toContain(
      "About the module. mod <dir>/mod.py <dir>/__pycache__/mod.bun-315.pyc SourceFileLoader\n",
    );
    expect(cold.exitCode).toBe(0);
    expect(existsSync(cached(dir))).toBe(true);
    expect(await run(dir)).toEqual(cold);
  });

  test("a directory that has moved", async () => {
    using tmp = tempDir("python-pyc", {
      "main.py": "import sys; sys.path.insert(0, sys.argv[1]); import mod; mod.outer()()",
      "one/mod.py":
        "def outer():\n    def inner(): print(__file__, inner.__code__.co_filename, outer.__code__.co_filename)\n    return inner\n",
    });
    const dir = String(tmp);
    expect(await run(dir, ["main.py", "one"])).toEqual(printed("<dir>/one/mod.py <dir>/one/mod.py <dir>/one/mod.py\n"));
    symlinkSync(join(dir, "one"), join(dir, "two"));
    expect(await run(dir, ["main.py", "two"])).toEqual(printed("<dir>/two/mod.py <dir>/two/mod.py <dir>/two/mod.py\n"));
  });

  test("marshal", async () => {
    using tmp = tempDir("python-pyc", {
      "main.py": `
import marshal, io, importlib.util, sys
def f(x, y=1):
    "doc"
    def g(): return x + y
    return g
code = f.__code__
data = marshal.dumps(code)
again = marshal.loads(data)
print(type(again).__name__, again == code, again is code, hash(again) == hash(code), again.co_consts[0], again.co_filename == __file__)
print(type(f)(again, globals())(2, 3)(), marshal.dumps(again) == data, marshal.loads(marshal.dumps(marshal.loads(data))) == code)
pair = marshal.loads(marshal.dumps([code, code, (code,)]))
print(pair[0] is pair[1], pair[0] is pair[2][0], pair[0] == code)
print(marshal.load(io.BytesIO(data + b"rest")) == code, marshal.loads(marshal.dumps(code.replace(co_flags=code.co_flags | 0x100))).co_flags == code.co_flags | 0x100)
module = compile("a = 1\\ndef h(): return a\\n", "<made up>", "exec")
namespace = {}
exec(marshal.loads(marshal.dumps(module)), namespace)
print(namespace["h"](), namespace["h"].__code__.co_filename, eval(marshal.loads(marshal.dumps(compile("6 * 7", "<e>", "eval")))))
def error(function, *args, **kwargs):
    try:
        return function(*args, **kwargs)
    except Exception as e:
        return type(e).__name__, str(e)
print(error(marshal.dumps, code, allow_code=False), error(marshal.loads, data, allow_code=False))
for bad in data[:1], data[:20], data[:29], data[:-1], data[:1] + bytes(28), data[:1] + bytes(28) + data[29:], data[:40] + bytes([data[40] ^ 1]) + data[41:], data[:5] + bytes([data[5] ^ 1]) + data[6:], b"c" + data[1:]:
    print(error(marshal.loads, bad))
print(len(importlib.util.MAGIC_NUMBER), importlib.util.MAGIC_NUMBER[2:], sys.implementation.cache_tag, importlib.util.cache_from_source("a/b.py"))
`,
    });
    expect(await run(String(tmp))).toEqual(
      printed(`code True False True doc True
5 True True
True True True
True True
1 <made up> 42
('ValueError', 'marshalling code objects is disallowed') ('ValueError', 'unmarshalling code objects is disallowed')
('EOFError', 'marshal data too short')
('EOFError', 'marshal data too short')
('EOFError', 'marshal data too short')
('EOFError', 'marshal data too short')
('ValueError', 'bad marshal data (code object of another build)')
('ValueError', 'bad marshal data (code object of another build)')
('ValueError', 'bad marshal data (damaged code object)')
('ValueError', 'bad marshal data (code object of another build)')
('ValueError', 'bad marshal data (the bytecode of CPython does not run here)')
4 b'\\r\\n' bun-315 a/__pycache__/b.bun-315.pyc
`),
    );
  });
});
