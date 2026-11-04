import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isWindows, tempDir } from "harness";
import { closeSync, mkdirSync, openSync, readFileSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";

// Started under the name python3, Bun has the command line of CPython.

const { BUN_PYTHON_STDLIB, PYTHONHOME, PYTHONPATH, ...env } = bunEnv;

// These builds take seconds to start Python.
if (isDebug || isASAN) setDefaultTimeout(60_000);

type Options = { files?: Record<string, string>; env?: Record<string, string>; stdin?: string; name?: string };

async function python(args: string[], { files = {}, env: extraEnv = {}, stdin, name = "python3" }: Options = {}) {
  using dir = tempDir("python-cli", files);
  using bin = tempDir("python-cli-bin", {});
  // A name with a directory is inside `files`.
  const program = join(String(name.includes("/") ? dir : bin), name);
  mkdirSync(dirname(program), { recursive: true });
  symlinkSync(bunExe(), program);
  await using proc = Bun.spawn({
    cmd: [program, ...args],
    // Whoever runs the tests may have a site-packages directory of their own, which would be on sys.path.
    env: { ...env, HOME: String(dir), ...extraEnv },
    cwd: String(dir),
    stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const clean = (text: string) => text.replaceAll(String(dir), "<dir>").replaceAll(String(bin), "<bin>");
  // Tracebacks do not mark the place in the line yet.
  const withoutMarks = (text: string) => text.replace(/^ +[~^]+\n/gm, "");
  return { stdout: clean(stdout), stderr: withoutMarks(clean(stderr)), exitCode: proc.signalCode ?? exitCode };
}

const lines = (...all: string[]) => all.map(line => line + "\n").join("");

const showArguments = "import sys; print(sys.argv, sys.orig_argv, repr(sys.path[0]), __name__)";
// Those that are not what they are without any option.
const showFlags = `
import sys
usual = dict(debug=0, inspect=0, interactive=0, optimize=0, dont_write_bytecode=0, no_user_site=0, no_site=0, ignore_environment=0,
             verbose=0, bytes_warning=0, quiet=0, hash_randomization=1, isolated=0, dev_mode=False, utf8_mode=1,
             warn_default_encoding=0, safe_path=False, int_max_str_digits=4300, gil=1, thread_inherit_context=0,
             context_aware_warnings=0, lazy_imports=-1)
print({name: getattr(sys.flags, name) for name in usual if getattr(sys.flags, name) != usual[name]})
`;

describe.skipIf(isWindows).concurrent("python3", () => {
  describe("what to run", () => {
    test("-c", async () => {
      expect(await python(["-c", showArguments, "a", "-b"])).toEqual({
        stdout: `['-c', 'a', '-b'] ['<bin>/python3', '-c', '${showArguments}', 'a', '-b'] '' __main__\n`,
        stderr: "",
        exitCode: 0,
      });
    });

    test("a script", async () => {
      expect(
        await python(["sub/main.py", "-c", "x"], { files: { "sub/main.py": showArguments + "; print(__file__)" } }),
      ).toEqual({
        stdout: lines(
          "['sub/main.py', '-c', 'x'] ['<bin>/python3', 'sub/main.py', '-c', 'x'] '<dir>/sub' __main__",
          "<dir>/sub/main.py",
        ),
        stderr: "",
        exitCode: 0,
      });
    });

    test("-m with a module and with a package", async () => {
      const files = {
        "mod.py": showArguments,
        "pkg/__init__.py": "print('pkg is imported')",
        "pkg/__main__.py": showArguments + "; print(__package__, __spec__.name)",
      };
      expect(await python(["-m", "mod", "a"], { files })).toEqual({
        stdout: "['<dir>/mod.py', 'a'] ['<bin>/python3', '-m', 'mod', 'a'] '<dir>' __main__\n",
        stderr: "",
        exitCode: 0,
      });
      expect(await python(["-m", "pkg"], { files })).toEqual({
        stdout: lines(
          "pkg is imported",
          "['<dir>/pkg/__main__.py'] ['<bin>/python3', '-m', 'pkg'] '<dir>' __main__",
          "pkg pkg.__main__",
        ),
        stderr: "",
        exitCode: 0,
      });
    });

    test("-m with what cannot be run", async () => {
      expect(await python(["-m", "nothing_of_that_name"])).toEqual({
        stdout: "",
        stderr: "<bin>/python3: No module named nothing_of_that_name\n",
        exitCode: 1,
      });
      expect(await python(["-m", "pkg"], { files: { "pkg/__init__.py": "" } })).toEqual({
        stdout: "",
        stderr: "<bin>/python3: No module named pkg.__main__; 'pkg' is a package and cannot be directly executed\n",
        exitCode: 1,
      });
    });

    test("standard input", async () => {
      expect(await python([], { stdin: showArguments })).toEqual({
        stdout: "[''] ['<bin>/python3'] '' __main__\n",
        stderr: "",
        exitCode: 0,
      });
      expect(await python(["-", "a"], { stdin: showArguments })).toEqual({
        stdout: "['-', 'a'] ['<bin>/python3', '-', 'a'] '' __main__\n",
        stderr: "",
        exitCode: 0,
      });
    });

    test("a directory and an archive with a __main__.py", async () => {
      const files = { "app/__main__.py": showArguments + "; import beside", "app/beside.py": "print(__file__)" };
      expect(await python(["app", "a"], { files })).toEqual({
        stdout: lines("['app', 'a'] ['<bin>/python3', 'app', 'a'] '<dir>/app' __main__", "<dir>/app/beside.py"),
        stderr: "",
        exitCode: 0,
      });
      const packAndRun = `
import subprocess, sys, zipfile
with zipfile.ZipFile("app.zip", "w", zipfile.ZIP_DEFLATED) as archive:
    archive.write("app/__main__.py", "__main__.py")
    archive.write("app/beside.py", "beside.py")
sys.exit(subprocess.run([sys.executable, "app.zip", "a"]).returncode)
`;
      expect(await python(["-c", packAndRun], { files })).toEqual({
        stdout: lines(
          "['app.zip', 'a'] ['<bin>/python3', 'app.zip', 'a'] '<dir>/app.zip' __main__",
          "<dir>/app.zip/beside.py",
        ),
        stderr: "",
        exitCode: 0,
      });
      expect(await python(["empty"], { files: { "empty/other.py": "" } })).toEqual({
        stdout: "",
        stderr: "<bin>/python3: can't find '__main__' module in '<dir>/empty'\n",
        exitCode: 1,
      });
    });

    test("a file that is not there", async () => {
      expect(await python(["missing.py"])).toEqual({
        stdout: "",
        stderr: "<bin>/python3: can't open file '<dir>/missing.py': [Errno 2] No such file or directory\n",
        exitCode: 2,
      });
    });

    test("-x skips the first line", async () => {
      expect(
        await python(["-x", "main.py"], { files: { "main.py": "this is not Python\nprint('second line')\n1/0\n" } }),
      ).toEqual({
        stdout: "second line\n",
        stderr: lines(
          "Traceback (most recent call last):",
          '  File "<dir>/main.py", line 3, in <module>',
          "    1/0",
          "ZeroDivisionError: division by zero",
        ),
        exitCode: 1,
      });
    });

    const awaits = "import asyncio\nawait asyncio.sleep(0)\nprint('awaited')";
    test.each([
      ["-c", ["-c", awaits], {}],
      ["a script", ["main.py"], { files: { "main.py": awaits } }],
      ["standard input", [], { stdin: awaits }],
    ] as [string, string[], Options][])("await at the top level of %s", async (_, args, options) => {
      expect(await python(args, options)).toEqual({ stdout: "awaited\n", stderr: "", exitCode: 0 });
    });
  });

  describe("names", () => {
    test.each(["python", "python3.15"])("%s is Python", async name => {
      expect(await python(["-c", "import sys; print(sys.executable)"], { name })).toEqual({
        stdout: `<bin>/${name}\n`,
        stderr: "",
        exitCode: 0,
      });
    });

    test.skipIf(!isLinux)("the file that is executed counts, whatever argv[0] says", async () => {
      const program = `
import subprocess, sys
sys.exit(subprocess.run(["<stdin>", "-c", "import sys; print(sys.orig_argv[0])"], executable=sys.executable).returncode)
`;
      expect(await python(["-c", program])).toEqual({ stdout: "<stdin>\n", stderr: "", exitCode: 0 });
    });

    test.skipIf(!isLinux)("a link of another name that leads here by way of python3 is Python", async () => {
      const program = `
import os, subprocess, sys
os.mkdir("links")
os.symlink(sys.executable, "links/first")
os.symlink("first", "links/second")
for link in "links/first", "links/second", os.path.abspath("links/second"):
    subprocess.run([link, "-c", "print('ran')"], check=True)
subprocess.run(["second", "-c", "print('found on PATH')"], check=True, env={**os.environ, "PATH": os.path.abspath("links")})
`;
      expect(await python(["-c", program])).toEqual({
        stdout: lines("ran", "ran", "ran", "found on PATH"),
        stderr: "",
        exitCode: 0,
      });
    });

    test("python2 is not", async () => {
      const result = await python(["-p", "1 + 1"], { name: "python2" });
      expect(result).toEqual({ stdout: "2\n", stderr: "", exitCode: 0 });
    });
  });

  describe("information", () => {
    test("--version", async () => {
      for (const option of ["-V", "--version"]) {
        const { stdout, ...rest } = await python([option]);
        expect(stdout).toMatch(/^Python 3\.15\.\d+\n$/);
        expect(rest).toEqual({ stderr: "", exitCode: 0 });
      }
      const { stdout } = await python(["-VV"]);
      expect(stdout).toMatch(/^Python 3\.15\.\d+ \(.*\) \[.*\]\n$/);
    });

    test("--help", async () => {
      for (const option of ["-h", "-?", "--help"]) {
        const { stdout, ...rest } = await python([option]);
        expect(stdout).toStartWith("usage: <bin>/python3 [option] ... [-c cmd | -m mod | file | -] [arg] ...\n");
        expect(stdout).toContain("\n-X opt ");
        expect(rest).toEqual({ stderr: "", exitCode: 0 });
      }
      expect((await python(["--help-env"])).stdout).toContain("\nPYTHONPATH ");
      expect((await python(["--help-xoptions"])).stdout).toContain("\n-X importtime");
      const all = (await python(["--help-all"])).stdout;
      expect(all).toContain("\nPYTHONPATH ");
      expect(all).toContain("\n-X importtime");
    });

    test("mistakes", async () => {
      const usage = lines(
        "usage: <bin>/python3 [option] ... [-c cmd | -m mod | file | -] [arg] ...",
        "Try `python -h' for more information.",
      );
      expect(await python(["-z"])).toEqual({ stdout: "", stderr: "Unknown option: -z\n" + usage, exitCode: 2 });
      expect(await python(["--nothing"])).toEqual({
        stdout: "",
        stderr: "Unknown option: --nothing\n" + usage,
        exitCode: 2,
      });
      expect(await python(["-c"])).toEqual({
        stdout: "",
        stderr: "Argument expected for the -c option\n" + usage,
        exitCode: 2,
      });
      expect(await python(["--check-hash-based-pycs", "sometimes", "-c", "pass"])).toEqual({
        stdout: "",
        stderr: lines("--check-hash-based-pycs must be one of 'default', 'always', or 'never'") + usage,
        exitCode: 2,
      });
    });
  });

  describe("options", () => {
    test.each([
      [[], {}, "{}"],
      [
        ["-d", "-q", "-B", "-s", "-P"],
        {},
        "{'debug': 1, 'dont_write_bytecode': 1, 'no_user_site': 1, 'quiet': 1, 'safe_path': True}",
      ],
      [["-OO", "-bb"], {}, "{'optimize': 2, 'bytes_warning': 2}"],
      [["-sE"], {}, "{'no_user_site': 1, 'ignore_environment': 1}"],
      [["-I"], {}, "{'no_user_site': 1, 'ignore_environment': 1, 'isolated': 1, 'safe_path': True}"],
      [["-S"], {}, "{'no_site': 1}"],
      [["-X", "dev"], {}, "{'dev_mode': True}"],
      [["-X", "utf8=0"], {}, "{'utf8_mode': 0}"],
      [
        ["-X", "int_max_str_digits=0", "-X", "warn_default_encoding"],
        {},
        "{'warn_default_encoding': 1, 'int_max_str_digits': 0}",
      ],
      [["-X", "lazy_imports=all"], {}, "{'lazy_imports': 1}"],
      [
        [],
        {
          PYTHONDEBUG: "1",
          PYTHONOPTIMIZE: "2",
          PYTHONDONTWRITEBYTECODE: "x",
          PYTHONNOUSERSITE: "1",
          PYTHONSAFEPATH: "1",
          PYTHONDEVMODE: "1",
          PYTHONHASHSEED: "0",
          PYTHONINTMAXSTRDIGITS: "1000",
        },
        "{'debug': 1, 'optimize': 2, 'dont_write_bytecode': 1, 'no_user_site': 1, 'hash_randomization': 0, 'dev_mode': True, 'safe_path': True, 'int_max_str_digits': 1000}",
      ],
      [["-E"], { PYTHONDEBUG: "1", PYTHONOPTIMIZE: "2", PYTHONDEVMODE: "1" }, "{'ignore_environment': 1}"],
      [["-O"], { PYTHONOPTIMIZE: "2" }, "{'optimize': 2}"],
    ] as [string[], Record<string, string>, string][])("sys.flags with %j %j", async (options, env, expected) => {
      expect(await python([...options, "-c", showFlags], { env })).toEqual({
        stdout: expected + "\n",
        stderr: "",
        exitCode: 0,
      });
    });

    test("-O and -OO", async () => {
      const program = `
def f():
    "documented"
    assert False, "asserted"
    return __debug__
try:
    print(f(), f.__doc__)
except AssertionError as e:
    print(e, f.__doc__)
`;
      expect((await python(["-c", program])).stdout).toBe("asserted documented\n");
      expect((await python(["-O", "-c", program])).stdout).toBe("False documented\n");
      expect((await python(["-OO", "-c", program])).stdout).toBe("False None\n");
    });

    test("-W, PYTHONWARNINGS and -X", async () => {
      expect(
        await python(
          [
            "-W",
            "error::UserWarning",
            "-Wignore",
            "-X",
            "a",
            "-X",
            "b=c=d",
            "-X",
            "dev",
            "-b",
            "-c",
            "import sys; print(sys.warnoptions, sys._xoptions)",
          ],
          { env: { PYTHONWARNINGS: "default::DeprecationWarning,always" } },
        ),
      ).toEqual({
        stdout:
          "['default', 'default::DeprecationWarning', 'always', 'error::UserWarning', 'ignore', 'default::BytesWarning'] {'a': True, 'b': 'c=d', 'dev': True}\n",
        stderr: "",
        exitCode: 0,
      });
      expect(
        await python([
          "-W",
          "error",
          "-c",
          "import warnings\ntry: warnings.warn('w')\nexcept UserWarning as e: print('raised', e)",
        ]),
      ).toEqual({
        stdout: "raised w\n",
        stderr: "",
        exitCode: 0,
      });
    });

    test("-S does not import site", async () => {
      const program = "import sys; print('site' in sys.modules, hasattr(__builtins__, 'exit'))";
      expect((await python(["-c", program])).stdout).toBe("True True\n");
      expect((await python(["-S", "-c", program])).stdout).toBe("False False\n");
      expect(await python(["-S", "-c", "import nothing_of_that_name"])).toEqual({
        stdout: "",
        stderr: lines(
          "Traceback (most recent call last):",
          '  File "<string>", line 1, in <module>',
          "    import nothing_of_that_name",
          "ModuleNotFoundError: No module named 'nothing_of_that_name'. Site initialization is disabled, did you forget to add the site-packages directory to sys.path or to enable your virtual environment?",
        ),
        exitCode: 1,
      });
    });

    test("PYTHONPATH, -E, -I and -P", async () => {
      const files = {
        "lib/found.py": "",
        "main.py": "import sys; print([p for p in sys.path if p.startswith('<dir>'.replace('<dir>', sys.argv[1]))])",
      };
      const run = async (...options: string[]) => {
        using dir = tempDir("python-cli-path", {});
        return (
          await python([...options, "main.py", "/"], { files, env: { PYTHONPATH: `${dir}/one:${dir}/two` } })
        ).stdout
          .replaceAll(String(dir), "<path>")
          .replace(/, '\/\$bunfs[^']*'/g, "");
      };
      expect(await run()).toBe("['<dir>', '<path>/one', '<path>/two']\n");
      expect(await run("-P")).toBe("['<path>/one', '<path>/two']\n");
      expect(await run("-E")).toBe("['<dir>']\n");
      expect(await run("-I")).toMatch(/^\[('\/\$bunfs[^']*')?\]\n$/);
    });

    test("an archive on PYTHONPATH", async () => {
      const program = `
import os, subprocess, sys, zipfile
with zipfile.ZipFile("lib.zip", "w") as archive:
    archive.writestr("inside.py", "print(__file__)")
environment = {**os.environ, "PYTHONPATH": os.path.abspath("lib.zip")}
sys.exit(subprocess.run([sys.executable, "-c", "import inside"], env=environment).returncode)
`;
      expect(await python(["-c", program])).toEqual({ stdout: "<dir>/lib.zip/inside.py\n", stderr: "", exitCode: 0 });
    });

    test("-u", async () => {
      const program =
        "import sys; print(sys.stdout.write_through, type(sys.stdout.buffer).__name__, sys.stderr.write_through, type(sys.stdin.buffer).__name__)";
      expect((await python(["-c", program])).stdout).toBe("False BufferedWriter False BufferedReader\n");
      expect((await python(["-u", "-c", program])).stdout).toBe("True FileIO True BufferedReader\n");
      expect((await python(["-c", program], { env: { PYTHONUNBUFFERED: "1" } })).stdout).toBe(
        "True FileIO True BufferedReader\n",
      );
    });

    test("PYTHONIOENCODING", async () => {
      const program = "import sys; print(sys.stdout.encoding, sys.stdout.errors, sys.stderr.errors, '\\xe9\\u20ac')";
      const result = await python(["-c", program], { env: { PYTHONIOENCODING: "latin-1:replace" } });
      expect(result.stdout).toBe("iso8859-1 replace backslashreplace �?\n");
    });

    test("-X cpu_count and -X pycache_prefix", async () => {
      expect(
        await python([
          "-X",
          "cpu_count=3",
          "-X",
          "pycache_prefix=/somewhere",
          "-c",
          "import os, sys; print(os.cpu_count(), os.process_cpu_count(), sys.pycache_prefix)",
        ]),
      ).toEqual({ stdout: "3 3 /somewhere\n", stderr: "", exitCode: 0 });
    });

    test("-X importtime", async () => {
      const { stderr, ...rest } = await python(["-S", "-X", "importtime", "-c", "import colorsys"]);
      expect(stderr).toStartWith("import time: self [us] | cumulative | imported package\n");
      expect(stderr).toMatch(/\nimport time: +\d+ \| +\d+ \| colorsys\n$/);
      expect(rest).toEqual({ stdout: "", exitCode: 0 });
    });

    test("-X warn_default_encoding", async () => {
      expect(
        await python(["-X", "warn_default_encoding", "-c", "open('main.py').close()"], { files: { "main.py": "" } }),
      ).toEqual({
        stdout: "",
        stderr: "<string>:1: EncodingWarning: 'encoding' argument not specified\n",
        exitCode: 0,
      });
    });

    test("values that make no sense", async () => {
      expect(await python(["-c", "pass"], { env: { PYTHONHASHSEED: "many" } })).toEqual({
        stdout: "",
        stderr: lines(
          'Fatal Python error: config_init_hash_seed: PYTHONHASHSEED must be "random" or an integer in range [0; 4294967295]',
          "Python runtime state: preinitialized",
          "",
        ),
        exitCode: 1,
      });
      expect(await python(["-X", "int_max_str_digits=5", "-c", "pass"])).toEqual({
        stdout: "",
        stderr: lines(
          "Fatal Python error: config_init_int_max_str_digits: -X int_max_str_digits: invalid limit; must be >= 640 or 0 for unlimited.",
          "Python runtime state: preinitialized",
          "",
        ),
        exitCode: 1,
      });
    });

    test("Bun's own configuration does not apply", async () => {
      expect(
        await python(["-c", "import sys, os; print(sys.orig_argv[1:2], os.environ.get('FROM_DOTENV'))"], {
          files: { ".env": "FROM_DOTENV=1", "bunfig.toml": 'preload = ["./nothing-of-that-name.js"]' },
          env: { BUN_OPTIONS: "--smol" },
        }),
      ).toEqual({ stdout: "['-c'] None\n", stderr: "", exitCode: 0 });
    });
  });

  describe("how it ends", () => {
    test.each([
      ["import sys; sys.exit()", "", 0],
      ["import sys; sys.exit(3)", "", 3],
      ["import sys; sys.exit('said so')", "said so\n", 1],
      ["raise SystemExit(None)", "", 0],
      ["exit(4)", "", 4],
      ["import os; os._exit(5)", "", 5],
    ] as [string, string, number][])("%s", async (program, stderr, exitCode) => {
      expect(await python(["-c", program])).toEqual({ stdout: "", stderr, exitCode });
    });

    test("an exception", async () => {
      expect(await python(["-c", "def f():\n    raise ValueError('no')\nf()"])).toEqual({
        stdout: "",
        stderr: lines(
          "Traceback (most recent call last):",
          '  File "<string>", line 3, in <module>',
          "    f()",
          '  File "<string>", line 2, in f',
          "    raise ValueError('no')",
          "ValueError: no",
        ),
        exitCode: 1,
      });
    });

    // Where both go to one file: what a script or standard input has printed comes before the traceback. After -c and -m it is
    // still in the buffer of sys.stdout, and follows when the interpreter ends.
    test.each([
      ["a script", ["main.py"], undefined, true],
      ["standard input", [], "print('printed'); 1 / 0\n", true],
      ["-c", ["-c", "print('printed'); 1 / 0"], undefined, false],
      ["-m", ["-m", "main"], undefined, false],
      ["a directory", ["."], undefined, false],
      ["bun main.py", ["main.py"], undefined, true],
    ] as [string, string[], string | undefined, boolean][])(
      "the traceback and what is left in sys.stdout: %s",
      async (name, args, stdin, printedFirst) => {
        using dir = tempDir("python-cli-order", {
          "main.py": "print('printed'); 1 / 0\n",
          "__main__.py": "print('printed'); 1 / 0\n",
        });
        const program = name.startsWith("bun") ? bunExe() : join(String(dir), "python3");
        if (program !== bunExe()) symlinkSync(bunExe(), program);
        const output = openSync(join(String(dir), "output"), "a");
        try {
          await using proc = Bun.spawn({
            cmd: [program, ...args],
            env: { ...env, HOME: String(dir) },
            cwd: String(dir),
            stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
            stdout: output,
            stderr: output,
          });
          const exitCode = await proc.exited;
          const written = readFileSync(join(String(dir), "output"), "utf8").split("\n");
          expect([written[0], written.at(-2)]).toEqual(
            printedFirst
              ? ["printed", "ZeroDivisionError: division by zero"]
              : ["Traceback (most recent call last):", "printed"],
          );
          expect(exitCode).toBe(1);
        } finally {
          closeSync(output);
        }
      },
    );

    test("a syntax error", async () => {
      expect(await python(["main.py"], { files: { "main.py": "print('not run')\nx = = 1\n" } })).toEqual({
        stdout: "",
        stderr: lines('  File "<dir>/main.py", line 2', "    x = = 1", "SyntaxError: invalid syntax"),
        exitCode: 1,
      });
    });

    test("KeyboardInterrupt", async () => {
      const result = await python(["-c", "raise KeyboardInterrupt"]);
      expect(result.stderr).toEndWith("KeyboardInterrupt\n");
      expect(result.exitCode).toBe("SIGINT");
    });

    test.skipIf(!isLinux)("output that cannot be written", async () => {
      const program =
        "import subprocess, sys; print(subprocess.run([sys.executable, '-c', 'print(1)'], stdout=open('/dev/full', 'w'), stderr=subprocess.DEVNULL).returncode)";
      expect((await python(["-c", program])).stdout).toBe("120\n");
    });

    test("atexit and finalizers run", async () => {
      const program = `
import atexit
class C:
    def __del__(self): print("finalized")
c = C()
atexit.register(print, "at exit")
raise SystemExit(7)
`;
      expect(await python(["-c", program])).toEqual({ stdout: "at exit\nfinalized\n", stderr: "", exitCode: 7 });
    });
  });

  describe("interactive", () => {
    test("-i reads statements from standard input", async () => {
      const stdin = lines(
        "1 + 1",
        "_ * 3",
        "def f():",
        "    return 'f'",
        "",
        "f()",
        "undefined",
        "x = = 1",
        "None",
        "import sys; sys.ps1 = 'next: '",
        "'last'",
      );
      expect(await python(["-i", "-q"], { stdin })).toEqual({
        stdout: lines("2", "6", "'f'", "'last'"),
        stderr:
          ">>> >>> >>> ... ... >>> >>> " +
          lines(
            "Traceback (most recent call last):",
            '  File "<stdin>", line 1, in <module>',
            "    undefined",
            "NameError: name 'undefined' is not defined",
          ) +
          ">>> " +
          lines('  File "<stdin>", line 1', "    x = = 1", "SyntaxError: invalid syntax") +
          ">>> >>> next: next: \n",
        exitCode: 0,
      });
    });

    test("the banner", async () => {
      const { stderr, ...rest } = await python(["-i"], { stdin: "" });
      expect(stderr).toMatch(
        /^Python 3\.15\.\d+ \(.*\) \[.*\] on \w+\nType "help", "copyright", "credits" or "license" for more information\.\n>>> \n$/,
      );
      expect(rest).toEqual({ stdout: "", exitCode: 0 });
    });

    test("-i after the program, which left its variables", async () => {
      expect(
        await python(["-i", "-c", "x = 5; raise SystemExit(3)"], { stdin: "x\nimport sys; type(sys.last_exc)\n" }),
      ).toEqual({
        stdout: lines("5", "<class 'SystemExit'>"),
        stderr:
          lines(
            "Traceback (most recent call last):",
            '  File "<string>", line 1, in <module>',
            "    x = 5; raise SystemExit(3)",
            "SystemExit: 3",
          ) + ">>> >>> >>> \n",
        exitCode: 0,
      });
      expect(await python(["-i", "-c", "y = 6"], { stdin: "y\nexit(9)\n'not reached'\n" })).toEqual({
        stdout: "6\n",
        stderr: ">>> >>> ",
        exitCode: 9,
      });
    });

    test("await", async () => {
      // What one statement starts is still there for the next.
      const stdin = lines(
        "import asyncio",
        "async def start(): return asyncio.create_task(asyncio.sleep(0, 'slept'))",
        "",
        "task = await start()",
        "await task",
      );
      expect(await python(["-i", "-q"], { stdin })).toEqual({
        stdout: "'slept'\n",
        stderr: ">>> >>> ... >>> >>> >>> \n",
        exitCode: 0,
      });
    });

    test("PYTHONSTARTUP is for interactive use", async () => {
      const options = {
        files: { "startup.py": "print('started'); from_startup = 1" },
        env: { PYTHONSTARTUP: "startup.py" },
      };
      expect((await python(["-i", "-q"], { ...options, stdin: "from_startup\n" })).stdout).toBe("started\n1\n");
      expect((await python(["-c", "print('from_startup' in globals())"], options)).stdout).toBe("False\n");
      expect((await python([], { ...options, stdin: "print('from_startup' in globals())" })).stdout).toBe("False\n");
      expect((await python(["-E", "-i", "-q"], { ...options, stdin: "'from_startup' in globals()\n" })).stdout).toBe(
        "False\n",
      );
    });
  });

  describe("sys.executable", () => {
    const child =
      "import subprocess, sys; print(subprocess.run([sys.executable, '-c', 'import sys; print(sys.argv, sys.flags.isolated)', 'a'], capture_output=True, text=True).stdout, end='')";

    test("is the name it was started under", async () => {
      expect(await python(["-c", "import sys; print(sys.executable)\n" + child])).toEqual({
        stdout: lines("<bin>/python3", "['-c', 'a'] 0"),
        stderr: "",
        exitCode: 0,
      });
    });

    test("of `bun main.py` is a python3 too", async () => {
      using dir = tempDir("python-cli-bun", {
        "main.py":
          "import os, sys\nprint(os.path.basename(sys.executable), sys.executable == sys._base_executable, os.path.realpath(sys.executable) == os.path.realpath(sys.argv[1]), sys.orig_argv[1:])\n" +
          child,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "main.py", bunExe()],
        env,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout: stdout.replaceAll(bunExe(), "<bun>"), stderr, exitCode }).toEqual({
        stdout: lines("python3 True True ['main.py', '<bun>']", "['-c', 'a'] 0"),
        stderr: "",
        exitCode: 0,
      });
    });

    test("in a virtual environment", async () => {
      expect(
        await python(
          [
            "-c",
            "import sys, inside; print(sys.executable, sys.prefix, sys.exec_prefix, sys.prefix != sys.base_prefix)",
          ],
          {
            name: "env/bin/python3",
            files: {
              "env/pyvenv.cfg": "home = /nowhere\n",
              "env/lib/python3.15/site-packages/inside.py": "print(__file__)",
            },
          },
        ),
      ).toEqual({
        stdout: lines(
          "<dir>/env/lib/python3.15/site-packages/inside.py",
          "<dir>/env/bin/python3 <dir>/env <dir>/env True",
        ),
        stderr: "",
        exitCode: 0,
      });
    });

    test("a virtual environment links to the python3 that made it", async () => {
      const show = "import sys; print(sys.executable, sys._base_executable, sys.prefix)";
      expect(
        await python([
          "-c",
          `
import os, subprocess, sys, venv
print(sys.executable == sys._base_executable)
venv.create("env", symlinks=True)
print(os.readlink("env/bin/python3"))
print([line for line in open("env/pyvenv.cfg") if line.startswith("home")])
print(subprocess.run(["env/bin/python", "-c", ${JSON.stringify(show)}], capture_output=True, text=True).stdout)
`,
        ]),
      ).toEqual({
        stdout: lines(
          "True",
          "<bin>/python3",
          "['home = <bin>\\n']",
          // There is no <bin>/python.
          "<dir>/env/bin/python <bin>/python3 <dir>/env",
          "",
        ),
        stderr: "",
        exitCode: 0,
      });
    });

    test("is found on PATH", async () => {
      using bin = tempDir("python-cli-path-bin", {});
      symlinkSync(bunExe(), join(String(bin), "python3"));
      await using proc = Bun.spawn({
        cmd: ["python3", "-c", "import sys; print(sys.executable)"],
        env: { ...env, PATH: `${bin}:${env.PATH}` },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: `${bin}/python3\n`, stderr: "", exitCode: 0 });
    });
  });

  describe("on a terminal", () => {
    // Each step waits for some text to appear after the last step's, then types.
    type Terminal = NonNullable<Bun.Subprocess["terminal"]>;
    async function onTerminal(
      args: string[],
      steps: [string, string | ((terminal: Terminal) => void)][],
      { files = {}, env: extraEnv = {} }: Options = {},
    ) {
      using dir = tempDir("python-cli-terminal", files);
      using bin = tempDir("python-cli-terminal-bin", {});
      const program = join(String(bin), "python3");
      symlinkSync(bunExe(), program);
      let output = "";
      let seen = 0;
      let waiting: { text: string; resolve: () => void } | undefined;
      const look = () => {
        if (!waiting) return;
        const at = output.indexOf(waiting.text, seen);
        if (at < 0) return;
        seen = at + waiting.text.length;
        const { resolve } = waiting;
        waiting = undefined;
        resolve();
      };
      const decoder = new TextDecoder();
      const closed = Promise.withResolvers<void>();
      const proc = Bun.spawn({
        cmd: [program, ...args],
        env: { ...env, HOME: String(dir), TERM: "xterm", NO_COLOR: "1", ...extraEnv },
        cwd: String(dir),
        terminal: {
          cols: 80,
          rows: 24,
          data(_terminal, chunk) {
            output += decoder.decode(chunk, { stream: true });
            look();
          },
          exit() {
            closed.resolve();
          },
        },
      });
      for (const [text, keys] of steps) {
        const found = Promise.withResolvers<void>();
        waiting = { text, resolve: found.resolve };
        look();
        const ended = await Promise.race([found.promise.then(() => false), proc.exited.then(() => true)]);
        if (ended) break;
        if (typeof keys === "string") proc.terminal!.write(keys);
        else keys(proc.terminal!);
      }
      const exitCode = await proc.exited;
      await closed.promise;
      proc.terminal!.close();
      return { output: output.replaceAll("\r\n", "\n"), exitCode: proc.signalCode ?? exitCode };
    }

    const withoutEscapes = (text: string) => text.replace(/\x1b(\[[0-9;?]*[a-zA-Z@]|[=>])/g, "");

    test("Ctrl-C raises KeyboardInterrupt", async () => {
      const { output, exitCode } = await onTerminal(["main.py"], [["ready", "\x03"]], {
        files: {
          "main.py": `
import signal, time
print(signal.getsignal(signal.SIGINT).__name__, signal.getsignal(signal.SIGTERM) == signal.SIG_DFL)
try:
    print("ready", flush=True)
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    print("caught")
`,
        },
      });
      expect(output).toBe("default_int_handler True\nready\n^Ccaught\n");
      expect(exitCode).toBe(0);
    });

    test("a KeyboardInterrupt that nobody catches: the traceback, and the process dies of the signal", async () => {
      const { output, exitCode } = await onTerminal(
        ["-c", "import time; print('ready', flush=True); time.sleep(1000)"],
        [["ready", "\x03"]],
      );
      expect(output).toStartWith("ready\n^CTraceback (most recent call last):\n");
      expect(output).toEndWith("\nKeyboardInterrupt\n");
      expect(exitCode).toBe("SIGINT");
    });

    test.each([
      ["the interactive interpreter", {}, 0],
      // As in CPython: a KeyboardInterrupt that it has reported is what the process dies of in the end.
      ["the plain interactive interpreter", { PYTHON_BASIC_REPL: "1" }, "SIGINT"],
    ])("Ctrl-C in %s", async (_name, extraEnv, status) => {
      const { output, exitCode } = await onTerminal(
        ["-q"],
        [
          [">>> ", "abc\x03"],
          ["KeyboardInterrupt", ""],
          [">>> ", "import time; print('sleeps'); time.sleep(1000)\r"],
          ["sleeps\r\n", "\x03"],
          ["KeyboardInterrupt", ""],
          [">>> ", "print(6 * 7)\r"],
          ["42", ""],
          [">>> ", "\x04"],
        ],
        { env: extraEnv },
      );
      expect(output).toContain("42");
      expect(exitCode).toBe(status);
    });

    test("lines with nothing to run in the plain interactive interpreter", async () => {
      const { output, exitCode } = await onTerminal(
        ["-q"],
        [
          [">>> ", "\r"],
          [">>> ", "# nothing\r"],
          [">>> ", "   \r"],
          [">>> ", "print(6 * 7)\r"],
          ["42", ""],
          [">>> ", "\x04"],
        ],
        { env: { PYTHON_BASIC_REPL: "1" } },
      );
      // The line editor moves the cursor about.
      const lines = withoutEscapes(output)
        .split(/[\r\n]+/)
        .filter(line => line !== "");
      expect(lines).toEqual([">>> ", ">>> # nothing", ">>>    ", ">>> print(6 * 7)", "42", ">>> "]);
      expect(exitCode).toBe(0);
    });

    test("input(): the terminal edits the line, Ctrl-D ends the input, Ctrl-C interrupts", async () => {
      const { output, exitCode } = await onTerminal(
        ["main.py"],
        [
          ["? ", "abc\x7fd\r"],
          ["then? ", "\u00e9\u20ac\r"],
          ["end? ", "\x04"],
          ["end? ", "\x03"],
        ],
        {
          files: {
            "main.py": `
import sys
print(repr(input("? ")))
sys.stdout.write("no newline, "); print(repr(input("then? ")))
for i in range(2):
    try: print(repr(input("end? ")))
    except (EOFError, KeyboardInterrupt) as e: print(type(e).__name__)
`,
          },
        },
      );
      expect(output).toBe(
        "? abc\b \bd\n'abd'\nno newline, then? \u00e9\u20ac\n'\u00e9\u20ac'\nend? EOFError\nend? ^CKeyboardInterrupt\n",
      );
      expect(exitCode).toBe(0);
    });

    test("getpass() does not show what is typed, and puts the terminal back", async () => {
      const { output, exitCode } = await onTerminal(
        ["main.py"],
        [
          ["Password: ", "secret\r"],
          ["Stars: ", "ab\x7fc\r"],
          ["shown? ", "yes\r"],
        ],
        {
          files: {
            "main.py": `
import getpass, termios
before = termios.tcgetattr(0)
print(repr(getpass.getpass()))
print(repr(getpass.getpass("Stars: ", echo_char="*")))
print(termios.tcgetattr(0) == before)
print(repr(input("shown? ")))
`,
          },
        },
      );
      expect(output).toStartWith("Password: \n'secret'\nStars: *");
      expect(output).toEndWith("*\n'ac'\nTrue\nshown? yes\n'yes'\n");
      expect(output).not.toContain("ab");
      expect(exitCode).toBe(0);
    });

    test.each([
      ["a terminal", { NO_COLOR: "" }, true],
      ["NO_COLOR", { NO_COLOR: "1" }, false],
      ["PYTHON_COLORS=0", { NO_COLOR: "", PYTHON_COLORS: "0" }, false],
      ["a terminal that has none", { NO_COLOR: "", TERM: "dumb" }, false],
      ["FORCE_COLOR on such a terminal", { NO_COLOR: "", TERM: "dumb", FORCE_COLOR: "1" }, true],
    ])("colours in a traceback: %s", async (_name, extraEnv, colours) => {
      const { output, exitCode } = await onTerminal(["-c", "1 / 0"], [], { env: extraEnv });
      expect(output.includes("\x1b[")).toBe(colours);
      expect(output.replace(/\x1b\[[0-9;]*m/g, "")).toBe(
        'Traceback (most recent call last):\n  File "<string>", line 1, in <module>\n    1 / 0\n    ~~^~~\nZeroDivisionError: division by zero\n',
      );
      expect(exitCode).toBe(1);
    });

    test("the size of the terminal, and SIGWINCH when it changes", async () => {
      const { output, exitCode } = await onTerminal(
        ["main.py"],
        [
          ["ready", terminal => terminal.resize(100, 30)],
          ["changed", "\r"],
        ],
        {
          files: {
            "main.py": `
import os, shutil, signal, sys
print(tuple(os.get_terminal_size()), tuple(os.get_terminal_size(2)), tuple(shutil.get_terminal_size()))
signal.signal(signal.SIGWINCH, lambda number, frame: print("changed", tuple(os.get_terminal_size()), flush=True))
print("ready", flush=True)
sys.stdin.readline()
`,
          },
        },
      );
      expect(output).toBe("(80, 24) (80, 24) (80, 24)\nready\nchanged (100, 30)\n\n");
      expect(exitCode).toBe(0);
    });

    test("termios and tty: keys one at a time, without echo", async () => {
      const { output, exitCode } = await onTerminal(
        ["main.py"],
        [
          ["ready", "k"],
          ["b'k'", "\x1b[A"],
          ["b'\\x1b[A'", "\x03"],
          ["b'\\x03'", "line\r"],
        ],
        {
          files: {
            "main.py": `
import os, sys, termios, tty
print(os.isatty(0), sys.stdin.isatty(), sys.stdout.isatty(), os.ttyname(0) == os.ttyname(1), sys.stdout.line_buffering)
before = termios.tcgetattr(0)
tty.setraw(0)
os.write(1, b"ready\\r\\n")
for i in range(3):
    os.write(1, repr(os.read(0, 10)).encode() + b"\\r\\n")
termios.tcsetattr(0, termios.TCSADRAIN, before)
print(repr(sys.stdin.readline()))
`,
          },
        },
      );
      expect(output).toBe("True True True True True\nready\nb'k'\nb'\\x1b[A'\nb'\\x03'\nline\n'line\\n'\n");
      expect(exitCode).toBe(0);
    });

    test("what is stopped with Ctrl-Z goes on when it is told to", async () => {
      const { output, exitCode } = await onTerminal(
        ["main.py"],
        [
          ["ready", "\x1a"],
          ["continued", "after\r"],
        ],
        {
          files: {
            // The shell's part: the job has a process group of its own, which is the one in the foreground.
            "main.py": `
import os, signal, subprocess, sys
signal.signal(signal.SIGTTOU, signal.SIG_IGN)
job = subprocess.Popen([sys.executable, "job.py"], process_group=0)
os.tcsetpgrp(0, job.pid)
pid, status = os.waitpid(job.pid, os.WUNTRACED)
print("stopped by", signal.Signals(os.WSTOPSIG(status)).name if os.WIFSTOPPED(status) else status, flush=True)
os.kill(job.pid, signal.SIGCONT)
print("status", job.wait())
`,
            "job.py": `
import signal, sys
signal.signal(signal.SIGCONT, lambda number, frame: print("continued", flush=True))
print(signal.getsignal(signal.SIGTSTP) == signal.SIG_DFL, "ready", flush=True)
print(repr(sys.stdin.readline()))
`,
          },
        },
      );
      expect(output).toBe("True ready\n^Zstopped by SIGTSTP\ncontinued\nafter\n'after\\n'\nstatus 0\n");
      expect(exitCode).toBe(0);
    });

    test("there is no ctypes.pythonapi, which is how programs learn that there is no C API", async () => {
      const { output, exitCode } = await onTerminal(["main.py"], [["ready", "\x03"]], {
        files: {
          // What prompt_toolkit does around each prompt.
          "main.py": `
import asyncio, signal
try:
    from ctypes import c_int, c_void_p, pythonapi
except ImportError:
    pythonapi = None
if pythonapi is not None:
    pythonapi.PyOS_getsig.restype = c_void_p
    pythonapi.PyOS_getsig.argtypes = (c_int,)
    pythonapi.PyOS_getsig(signal.SIGINT)
async def main():
    loop = asyncio.get_running_loop()
    pressed = loop.create_future()
    before = signal.getsignal(signal.SIGINT)
    loop.add_signal_handler(signal.SIGINT, pressed.set_result, "Ctrl-C")
    print("ready", flush=True)
    print(await pressed)
    loop.remove_signal_handler(signal.SIGINT)
    signal.signal(signal.SIGINT, before)
asyncio.run(main())
print(pythonapi, signal.getsignal(signal.SIGINT).__name__)
`,
        },
      });
      expect(output).toBe("ready\n^CCtrl-C\nNone default_int_handler\n");
      expect(exitCode).toBe(0);
    });

    describe("readline", () => {
      // The editor redraws as it pleases. What counts is what the program gets.
      const results = (output: string) =>
        withoutEscapes(output)
          .split(/[\r\n]+/)
          .filter(line => line.startsWith("got "));

      test("input() edits the line and keeps a history once the module has been imported", async () => {
        const { output, exitCode } = await onTerminal(
          ["main.py"],
          [
            ["0> ", "hello\x01X\x05Y\r"],
            ["1> ", "one two three\x17\x17X\r"],
            ["2> ", "\x1bOA\x1bOA!\r"],
            ["3> ", "\x10\r"],
            ["4> ", "\x12one\r"],
            ["5> ", "\x04"],
            ["6> ", "abc\x03"],
          ],
          {
            files: {
              "main.py": `
import readline, traceback
for i in range(7):
    try:
        print("got", repr(input("%d> " % i)))
    except (EOFError, KeyboardInterrupt) as e:
        print()
        print("got", type(e).__name__, len(traceback.extract_tb(e.__traceback__)))
print("got", [readline.get_history_item(i + 1) for i in range(readline.get_current_history_length())])
`,
            },
          },
        );
        expect(results(output)).toEqual([
          "got 'XhelloY'",
          "got 'one X'",
          "got 'XhelloY!'",
          "got 'XhelloY!'",
          "got 'one X'",
          "got EOFError 1",
          "got KeyboardInterrupt 1",
          "got ['XhelloY', 'one X', 'XhelloY!', 'one X']",
        ]);
        expect(exitCode).toBe(0);
      });

      test("completion, hooks, and prompts with colours", async () => {
        const { output, exitCode } = await onTerminal(
          ["main.py"],
          [
            ["plain> ", "a\tb\r"],
            ["(c) ", "gree\t yo\t\r"],
            ["(c) ", "q\t\r"],
            ["case> ", "sel\t\r"],
            ["filled> ", " more\r"],
            ["colour> ", "abc\x01X\r"],
          ],
          {
            files: {
              "main.py": `
import cmd, readline
print("got", repr(input("plain> ")))
class C(cmd.Cmd):
    prompt = "(c) "
    def do_greet(self, arg): print("got", arg)
    def complete_greet(self, text, line, begidx, endidx): return [n for n in ("world", "you") if n.startswith(text)]
    def do_quit(self, arg): return True
C().cmdloop()
readline.set_completer(lambda text, state: ["SELECT"][state:state + 1][0] if state == 0 else None)
print("got", repr(input("case> ")))
readline.set_startup_hook(lambda: readline.insert_text("text"))
print("got", repr(input("filled> ")))
readline.set_startup_hook()
print("got", repr(input("\\001\\033[1;35m\\002colour> \\001\\033[0m\\002")))
`,
            },
          },
        );
        expect(results(output)).toEqual(["got 'a\\tb'", "got you", "got 'SELECT'", "got 'text more'", "got 'Xabc'"]);
        expect(output).not.toContain("\x01");
        expect(exitCode).toBe(0);
      });

      test("the plain interactive interpreter has a history, which it keeps in a file, and completes names", async () => {
        const steps: [string, string][] = [
          [">>> ", "value = 41\r"],
          [">>> ", "\x1bOA\x7f2\r"],
          [">>> ", "print('got', val\t)\r"],
          ["got 42", ""],
          [">>> ", "\x04"],
        ];
        const options = { env: { PYTHON_BASIC_REPL: "1", PYTHON_HISTORY: "history.txt" }, files: { "main.py": "" } };
        const { output, exitCode } = await onTerminal(["-q"], steps, options);
        expect(results(output)).toEqual(["got 42"]);
        expect(exitCode).toBe(0);
      });

      test("without a terminal it costs nothing and changes nothing", async () => {
        const result = await python(
          [
            "-c",
            `
import os, sys
before = sorted(os.listdir("/dev/fd")), set(sys.modules)
import readline
readline.parse_and_bind("tab: complete")
readline.set_completer(lambda text, state: None)
readline.add_history("line")
print(sorted(os.listdir("/dev/fd")) == before[0], sorted(set(sys.modules) - before[1]))
print(repr(input("prompt> ")), readline.get_current_history_length(), readline.backend)
`,
          ],
          { stdin: "from a pipe\n" },
        );
        expect(result).toEqual({
          stdout: "True ['readline']\nprompt> 'from a pipe' 1 readline\n",
          stderr: "",
          exitCode: 0,
        });
      });
    });
  });
});
