import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isWindows, tempDir } from "harness";

// Python's standard library is in the executable. Programs see it as a directory that cannot be written to.
const root = "/$bunfs/python";
const library = `${root}/lib/python3.15`;

// Each of these says where else the library is.
const { BUN_PYTHON_STDLIB, PYTHONHOME, PYTHONPATH, ...env } = bunEnv;

// These builds take seconds to start Python, which imports `site`, and more to import what imports `re`.
if (isDebug || isASAN) setDefaultTimeout(60_000);

async function runIn(dir: string, file: string, extraEnv: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), file],
    // Whoever runs the tests may have a site-packages directory of their own, which would be on sys.path.
    env: { ...env, HOME: dir, ...extraEnv },
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.replaceAll(dir, "<dir>"), stderr: stderr.replaceAll(dir, "<dir>"), exitCode };
}

async function run(files: Record<string, string>) {
  using dir = tempDir("python-stdlib", files);
  return await runIn(String(dir), Object.keys(files)[0]);
}

const lines = (...all: string[]) => all.map(line => line + "\n").join("");

// `posix` is not written for Windows yet.
describe.skipIf(isWindows).concurrent("the standard library in the executable", () => {
  test("modules are imported from it", async () => {
    const result = await run({
      "main.py": `
import sys, os, email.errors, colorsys
print(sys.prefix, sys.exec_prefix, sys.base_prefix, sys.base_exec_prefix, sys.platlibdir)
print(sys.path)
for module in os, email, email.errors, colorsys:
    print(module.__name__, module.__file__)
print(email.__path__, colorsys.rgb_to_hsv(1, 0, 0))
`,
    });
    expect(result).toEqual({
      stdout: lines(
        `${root} ${root} ${root} ${root} lib`,
        `['<dir>', '${library}']`,
        `os ${library}/os.py`,
        `email ${library}/email/__init__.py`,
        `email.errors ${library}/email/errors.py`,
        `colorsys ${library}/colorsys.py`,
        `['${library}/email'] (0.0, 1.0, 1)`,
      ),
      stderr: "",
      exitCode: 0,
    });
  });

  test("a module of JavaScript imports Python that imports from it", async () => {
    const result = await run({
      "main.js": `
import { where, hsv } from "./colors.py";
console.log(where(), hsv(1, 0, 0));
`,
      "colors.py": `
import colorsys
def where(): return colorsys.__file__
def hsv(r, g, b): return str(colorsys.rgb_to_hsv(r, g, b))
`,
    });
    expect(result).toEqual({ stdout: `${library}/colorsys.py (0.0, 1.0, 1)\n`, stderr: "", exitCode: 0 });
  });

  test("the files can be read like any others", async () => {
    const result = await run({
      "main.py": `
import sys, posix, mmap, _io
path = sys._stdlib_dir + "/os.py"
text = open(path).read()
print(text.startswith('r"""OS routines'), len(text) > 40000)

status = posix.stat(path)
print(oct(status.st_mode), status.st_size == len(text.encode()), status.st_mtime > 1.7e9, status.st_nlink)
print(posix.stat(path) == status, posix.lstat(path) == status, posix.stat(sys._stdlib_dir + "/re/__init__.py").st_ino == status.st_ino)
for other in (sys._stdlib_dir + "/json/../os.py", sys._stdlib_dir + "//./os.py", "/tmp/../$bunfs/python/lib/python3.15/os.py"):
    print(posix.stat(other) == status)
print([posix.access(path, mode) for mode in (posix.F_OK, posix.R_OK, posix.W_OK, posix.X_OK)], posix.access(sys._stdlib_dir, posix.X_OK))

with open(path, "rb") as file:
    opened = posix.fstat(file.fileno())
    print(oct(opened.st_mode), opened.st_size == status.st_size, opened.st_mtime == status.st_mtime)
    file.seek(4)
    print(file.read(11), file.name == path)
    print(mmap.mmap(file.fileno(), 0, access=mmap.ACCESS_READ)[4:15])

fd = posix.open(path, posix.O_RDONLY)
print(posix.pread(fd, 11, 4), posix.get_inheritable(fd))
try:
    posix.write(fd, b"x")
except OSError as error:
    print(type(error).__name__, error.errno)
posix.close(fd)

with _io.open_code(path) as file:
    print(file.read(7))
print(open(path.encode(), "rb").read(7))
`,
    });
    expect(result).toEqual({
      stdout: lines(
        "True True",
        "0o100444 True True 1",
        "True True False",
        "True",
        "True",
        "True",
        "[True, True, False, False] True",
        "0o100444 True True",
        "b'OS routines' True",
        "b'OS routines'",
        "b'OS routines' False",
        "OSError 9",
        `b'r"""OS '`,
        `b'r"""OS '`,
      ),
      stderr: "",
      exitCode: 0,
    });
  });

  test("the directories can be listed", async () => {
    const result = await run({
      "main.py": `
import sys, posix
library = sys._stdlib_dir
print(sorted(posix.listdir(library + "/json")))
print(sorted(posix.listdir(library.encode() + b"/json"))[:2])
print(posix.listdir("/$bunfs"), posix.listdir(sys.prefix), posix.listdir(sys.prefix + "/lib"), posix.listdir(sys.prefix + "/lib/"))
print(oct(posix.stat(library).st_mode), oct(posix.stat("/$bunfs").st_mode), posix.stat(library + "/") == posix.stat(library))

with posix.scandir(library) as entries:
    entries = {entry.name: entry for entry in entries}
for name in "json", "os.py":
    entry = entries[name]
    print(entry.path, entry.is_dir(), entry.is_file(), entry.is_symlink(), entry.stat() == posix.stat(entry.path), entry.inode() == entry.stat().st_ino)
print(sorted(entries) == sorted(posix.listdir(library)), len(entries) > 150)
# CPython's own tests, and what needs Tk, are left out.
print([name for name in ("test", "idlelib", "tkinter", "turtledemo", "__pycache__", "site-packages") if name in entries])
`,
    });
    expect(result).toEqual({
      stdout: lines(
        "['__init__.py', '__main__.py', 'decoder.py', 'encoder.py', 'scanner.py', 'tool.py']",
        "[b'__init__.py', b'__main__.py']",
        "['python'] ['lib'] ['bun', 'python3.15'] ['bun', 'python3.15']",
        "0o40555 0o40555 True",
        `${library}/json True False False True True`,
        `${library}/os.py False True False True True`,
        "True True",
        "[]",
      ),
      stderr: "",
      exitCode: 0,
    });
  });

  test("nothing can be written", async () => {
    const result = await run({
      "main.py": `
import sys, posix, errno
library = sys._stdlib_dir
path = library + "/os.py"
outside = posix.getcwd() + "/outside"
open(outside, "w").close()
for name, attempt in {
    "open w": lambda: open(path, "w"),
    "open a": lambda: open(path, "a"),
    "open r+": lambda: open(path, "r+"),
    "open new": lambda: open(library + "/new.py", "w"),
    "open x": lambda: open(library + "/new.py", "x"),
    "posix.open": lambda: posix.open(path, posix.O_WRONLY),
    "mkdir": lambda: posix.mkdir(library + "/new"),
    "remove": lambda: posix.remove(path),
    "rmdir": lambda: posix.rmdir(library + "/json"),
    "rename from": lambda: posix.rename(path, outside),
    "rename to": lambda: posix.rename(outside, library + "/new.py"),
    "replace": lambda: posix.replace(outside, path),
    "link": lambda: posix.link(outside, library + "/new.py"),
    "symlink": lambda: posix.symlink(outside, library + "/new.py"),
    "chmod": lambda: posix.chmod(path, 0o644),
    "chown": lambda: posix.chown(path, 0, 0),
    "utime": lambda: posix.utime(path),
    "truncate": lambda: posix.truncate(path, 0),
}.items():
    try:
        attempt()
        print(name, "succeeded")
    except OSError as error:
        print(name, type(error).__name__, errno.errorcode[error.errno], error.filename.replace(library, "<library>"))
print(posix.access(outside, posix.F_OK), posix.access(library + "/new.py", posix.F_OK), len(open(path).read()) > 40000)
`,
    });
    expect(result).toEqual({
      stdout: lines(
        "open w OSError EROFS <library>/os.py",
        "open a OSError EROFS <library>/os.py",
        "open r+ OSError EROFS <library>/os.py",
        "open new OSError EROFS <library>/new.py",
        "open x OSError EROFS <library>/new.py",
        "posix.open OSError EROFS <library>/os.py",
        "mkdir OSError EROFS <library>/new",
        "remove OSError EROFS <library>/os.py",
        "rmdir OSError EROFS <library>/json",
        "rename from OSError EROFS <library>/os.py",
        "rename to OSError EROFS <library>/new.py",
        "replace OSError EROFS <library>/os.py",
        "link OSError EROFS <library>/new.py",
        "symlink OSError EROFS <library>/new.py",
        "chmod OSError EROFS <library>/os.py",
        "chown OSError EROFS <library>/os.py",
        "utime OSError EROFS <library>/os.py",
        "truncate OSError EROFS <library>/os.py",
        "True False True",
      ),
      stderr: "",
      exitCode: 0,
    });
  });

  test("what is wrong with a path is the error, as on a disk", async () => {
    const result = await run({
      "main.py": `
import sys, posix, errno
library = sys._stdlib_dir
path = library + "/os.py"
for name, attempt in {
    "open missing": lambda: open(library + "/missing.py"),
    "stat missing": lambda: posix.stat(library + "/missing.py"),
    "stat in a file": lambda: posix.stat(path + "/x"),
    "stat file/": lambda: posix.stat(path + "/"),
    "listdir missing": lambda: posix.listdir(library + "/missing"),
    "listdir file": lambda: posix.listdir(path),
    "scandir file": lambda: posix.scandir(path),
    "open directory": lambda: open(library),
    "readlink": lambda: posix.readlink(path),
    "chdir": lambda: posix.chdir(library),
    "chdir missing": lambda: posix.chdir(library + "/missing"),
    "remove missing": lambda: posix.remove(library + "/missing.py"),
    "mkdir existing": lambda: posix.mkdir(library + "/json"),
    "mkdir in missing": lambda: posix.mkdir(library + "/missing/new"),
    "mkdir in a file": lambda: posix.mkdir(path + "/new"),
    "beside python": lambda: posix.stat("/$bunfs/pythonic"),
    "beside the root": lambda: posix.stat("/$bunfsx"),
    ${isLinux ? `"listxattr": lambda: posix.listxattr(path),` : ""}
}.items():
    try:
        attempt()
        print(name, "succeeded")
    except OSError as error:
        print(name, type(error).__name__, errno.errorcode[error.errno])
`,
    });
    expect(result).toEqual({
      stdout: lines(
        "open missing FileNotFoundError ENOENT",
        "stat missing FileNotFoundError ENOENT",
        "stat in a file NotADirectoryError ENOTDIR",
        "stat file/ NotADirectoryError ENOTDIR",
        "listdir missing FileNotFoundError ENOENT",
        "listdir file NotADirectoryError ENOTDIR",
        "scandir file NotADirectoryError ENOTDIR",
        "open directory IsADirectoryError EISDIR",
        "readlink OSError EINVAL",
        "chdir OSError ENOTSUP",
        "chdir missing FileNotFoundError ENOENT",
        "remove missing FileNotFoundError ENOENT",
        "mkdir existing FileExistsError EEXIST",
        "mkdir in missing FileNotFoundError ENOENT",
        "mkdir in a file NotADirectoryError ENOTDIR",
        "beside python FileNotFoundError ENOENT",
        "beside the root FileNotFoundError ENOENT",
        // What shutil.copy2() takes for "there are none".
        ...(isLinux ? ["listxattr OSError ENOTSUP"] : []),
      ),
      stderr: "",
      exitCode: 0,
    });
  });

  test("tracebacks show its lines", async () => {
    const result = await run({
      "main.py": `
import colorsys
colorsys.rgb_to_hsv(1, 2, "3")
`,
    });
    expect({ ...result, stderr: result.stderr.replace(/line \d+, in rgb/, "line N, in rgb") }).toEqual({
      stdout: "",
      stderr: lines(
        "Traceback (most recent call last):",
        `  File "<dir>/main.py", line 3, in <module>`,
        `    colorsys.rgb_to_hsv(1, 2, "3")`,
        "    ~~~~~~~~~~~~~~~~~~~^^^^^^^^^^^",
        `  File "${library}/colorsys.py", line N, in rgb_to_hsv`,
        "    maxc = max(r, g, b)",
        "TypeError: '>' not supported between instances of 'str' and 'int'",
      ),
      exitCode: 1,
    });
  });

  test("os and os.path work on it", async () => {
    const result = await run({
      "main.py": `
import os
library = os.path.dirname(os.__file__)
for where, directories, files in os.walk(library + "/xml"):
    print(where, directories, len(files))
for path in (library + "/json/../os.py", library + "//./os.py", "/tmp/../$bunfs/python/lib/python3.15/os.py"):
    print(os.path.samefile(path, os.__file__), os.path.realpath(path, strict=True))
print(os.path.samefile(os.__file__, os.path.__file__), os.path.samefile(os.__file__, __file__))
for path in (os.__file__, library, library + "/missing", os.__file__ + "/"):
    print(os.path.exists(path), os.path.isfile(path), os.path.isdir(path), os.path.islink(path))
print(os.path.getsize(os.__file__) > 40000, os.path.ismount("/$bunfs"), os.path.ismount(library))
os.makedirs(library + "/json", exist_ok=True)
try:
    os.makedirs(library + "/a/b")
except OSError as error:
    print(error)
`,
    });
    expect(result).toEqual({
      stdout: lines(
        `${library}/xml ['dom', 'etree', 'parsers', 'sax'] 2`,
        `${library}/xml/dom [] 8`,
        `${library}/xml/etree [] 5`,
        `${library}/xml/parsers [] 2`,
        `${library}/xml/sax [] 6`,
        `True ${library}/os.py`,
        `True ${library}/os.py`,
        `True ${library}/os.py`,
        "False False",
        "True True False False",
        "True False True False",
        "False False False False",
        "False False False False",
        "True True False",
        `[Errno 30] Read-only file system: '${library}/a'`,
      ),
      stderr: "",
      exitCode: 0,
    });
  });

  test("importlib finds and loads what is in it", async () => {
    const result = await run({
      "main.py": `
import sys, importlib.machinery, importlib.util
finder = importlib.machinery.FileFinder(sys._stdlib_dir, (importlib.machinery.SourceFileLoader, [".py"]))
spec = finder.find_spec("colorsys")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
print(spec.origin, module.__file__, module.rgb_to_hsv(1, 0, 0))
print(spec.loader.get_source("colorsys").splitlines()[0])
print(finder.find_spec("pydoc_data").submodule_search_locations, finder.find_spec("missing"))
print(b"CSS file for pydoc" in spec.loader.get_data(sys._stdlib_dir + "/pydoc_data/_pydoc.css"))
`,
    });
    expect(result).toEqual({
      stdout: lines(
        `${library}/colorsys.py ${library}/colorsys.py (0.0, 1.0, 1)`,
        `"""Conversion functions between RGB and other color systems.`,
        `['${library}/pydoc_data'] None`,
        "True",
      ),
      stderr: "",
      exitCode: 0,
    });
  });

  test("importlib.resources reads its data files", async () => {
    const result = await run({
      "main.py": `
import importlib.resources
files = importlib.resources.files("pydoc_data")
print(sorted(file.name for file in files.iterdir()))
sheet = files / "_pydoc.css"
print(sheet, sheet.is_file(), "CSS file for pydoc" in sheet.read_text())
with importlib.resources.as_file(sheet) as path:
    print(path)
`,
    });
    expect(result).toEqual({
      stdout: lines(
        "['__init__.py', '_pydoc.css', 'module_docs.py', 'topics.py']",
        `${library}/pydoc_data/_pydoc.css True True`,
        `${library}/pydoc_data/_pydoc.css`,
      ),
      stderr: "",
      exitCode: 0,
    });
  });

  test("linecache reads its lines", async () => {
    const result = await run({
      "main.py": `
import os, linecache
print(repr(linecache.getline(os.__file__, 1)))
linecache.checkcache()
print(repr(linecache.getline(os.__file__, 1)))
`,
    });
    const line = `'r"""OS routines for NT or Posix depending on what system we\\'re on.\\n'`;
    expect(result).toEqual({ stdout: lines(line, line), stderr: "", exitCode: 0 });
  });

  test("shutil copies out of it", async () => {
    const result = await run({
      "main.py": `
import os, shutil
copy = shutil.copy2(os.__file__, "copy.py")
print(open(copy).read() == open(os.__file__).read(), os.stat(copy).st_mtime == os.stat(os.__file__).st_mtime)
tree = shutil.copytree(os.path.dirname(os.__file__) + "/json", "tree")
print(sorted(os.listdir(tree)), oct(os.stat(tree).st_mode))
os.chmod(tree, 0o755)
`,
    });
    expect(result).toEqual({
      stdout: lines(
        "True True",
        "['__init__.py', '__main__.py', 'decoder.py', 'encoder.py', 'scanner.py', 'tool.py'] 0o40555",
      ),
      stderr: "",
      exitCode: 0,
    });
  });

  test("sysconfig and site know where things are", async () => {
    const result = await run({
      "main.py": `
import sysconfig, site
paths = sysconfig.get_paths()
print(paths["stdlib"], paths["platstdlib"], paths["purelib"], paths["data"])
print(site.getsitepackages(), sysconfig.get_python_version(), sysconfig.is_python_build())
`,
    });
    expect(result).toEqual({
      stdout: lines(
        `${library} ${library} ${library}/site-packages ${root}`,
        `['${library}/site-packages'] 3.15 False`,
      ),
      stderr: "",
      exitCode: 0,
    });
  });

  test("$BUN_PYTHON_STDLIB is a directory to use instead", async () => {
    using dir = tempDir("python-stdlib", {
      "copy.py": `
import os
library = os.path.dirname(os.__file__)
for where, directories, files in os.walk(library):
    copy = "library" + where.removeprefix(library)
    os.mkdir(copy)
    for name in files:
        with open(where + "/" + name, "rb") as source, open(copy + "/" + name, "wb") as destination:
            destination.write(source.read())
open("library/only_here.py", "w").close()
`,
      "main.py": `
import sys, os, only_here
print(sys._stdlib_dir, sys.path[1:], os.__file__, only_here.__file__)
`,
    });
    expect(await runIn(String(dir), "copy.py")).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    expect(await runIn(String(dir), "main.py", { BUN_PYTHON_STDLIB: `${dir}/library` })).toEqual({
      stdout: "<dir>/library ['<dir>/library'] <dir>/library/os.py <dir>/library/only_here.py\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // It is importlib that gives a module written in C++ its __spec__. Once a thread has been started, an import asks for that of a module that is in sys.modules.
  test("without a library the modules in the executable are imported, and have no __spec__", async () => {
    using dir = tempDir("python-stdlib", {
      "main.js": `
const { dict, exec } = require("python:builtins");
exec(\`
import _thread, sys
lock = _thread.allocate_lock()
lock.acquire()
_thread.start_new_thread(lock.release, ())
lock.acquire()
import _imp, math
print(_imp.__spec__, math.__spec__, math.__loader__, "_frozen_importlib" in sys.modules, flush=True)
\`, dict());
`,
      "library/empty": "",
    });
    expect(await runIn(String(dir), "main.js", { BUN_PYTHON_STDLIB: `${dir}/library` })).toEqual({
      stdout: "None None None False\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("what a program puts into sys.modules in the place of importlib._bootstrap is not asked for a __spec__", async () => {
    const result = await run({
      "main.py": `
import sys, types
class Importer:
    @staticmethod
    def find_spec(*arguments): raise ValueError("find_spec of the fake")
fake = types.ModuleType("_frozen_importlib")
fake._imp, fake.BuiltinImporter = 1, Importer
sys.modules["_frozen_importlib"] = fake
import _heapq, _bisect
print(_heapq.__spec__.name, _heapq.__spec__.origin, _bisect.__loader__.__name__)
`,
    });
    expect(result).toEqual({ stdout: "_heapq built-in BuiltinImporter\n", stderr: "", exitCode: 0 });
  });
});

test.concurrent("a file with nothing in it is a program, and a module", async () => {
  expect(await run({ "main.py": "" })).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  expect(await run({ "main.py": "import nothing\nprint(nothing.__file__)", "nothing.py": "" })).toEqual({
    stdout: "<dir>/nothing.py\n",
    stderr: "",
    exitCode: 0,
  });
});
