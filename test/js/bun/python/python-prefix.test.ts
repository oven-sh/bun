// `import json from "python:json"`: any module Python can import by name, as `node:fs` names a module of Node's.
import { expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "path";

// These builds take seconds to start Python.
if (isDebug || isASAN) setDefaultTimeout(60_000);

async function run(files: Record<string, string>, cmd: string[] = ["main.js"], env: Record<string, string> = {}) {
  using dir = tempDir("python-prefix", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...cmd],
    env: { ...bunEnv, ...env },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent("default, named and namespace imports, require() and import()", async () => {
  const result = await run({
    "main.js": `
      import json from "python:json";
      import { dumps, loads } from "python:json";
      import * as os from "python:os";
      import path from "python:os.path";
      import sys from "python:sys";
      console.log(dumps([1, "a"]), loads("[2]"), dumps === json.dumps);
      console.log(typeof os.getcwd, os.default === sys.modules.os, path === os.path, path.join("a", "b"));
      console.log(require("python:json") === json, (await import("python:json")).default === json);
      console.log((await import("python:re")).default === sys.modules.re);
    `,
  });
  expect(result).toEqual({
    stdout: `[1, "a"] [ 2 ] true\nfunction true true a/b\ntrue true\ntrue\n`,
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent(
  "the named exports are the attributes without double underscores, when the module has been imported",
  async () => {
    const result = await run({
      "shapes.py": `
__all__ = ["area"]
import math as _math
sides = 4
def area(r): return r * r
def _private(): pass
default = "an attribute named default"
`,
      "main.js": `
      import * as shapes from "python:shapes";
      console.log(Object.keys(shapes).join());
      console.log(shapes.default.__name__, shapes.default.__all__, shapes.default.default);
      shapes.default.later = 1;
      console.log("later" in shapes, (await import("python:shapes")).later);
    `,
    });
    expect(result).toEqual({
      stdout: `_math,_private,area,default,sides\nshapes [ "area" ] an attribute named default\nfalse undefined\n`,
      stderr: "",
      exitCode: 0,
    });
  },
);

test.concurrent("it is the module that Python's own import gives", async () => {
  const result = await run({
    "counter.py": `count = 0\ndef bump():\n    global count\n    count += 1\n    return count`,
    "uses.py": `import counter, json\ndef bump(): return counter.bump()`,
    "pkg/__init__.py": `where = "pkg"`,
    "pkg/inner/__init__.py": ``,
    "pkg/inner/leaf.py": `from .. import where as parent\nname = __name__`,
    "main.js": `
      import counter from "python:counter";
      import byPath from "./uses.py";
      import json from "python:json";
      import leaf from "python:pkg.inner.leaf";
      import sys from "python:sys";
      console.log(counter.bump(), byPath.bump(), counter.count, byPath.counter === counter, byPath.json === json);
      console.log(leaf.name, leaf.parent, sys.modules["pkg.inner.leaf"] === leaf, sys.modules.pkg.inner.leaf === leaf);
    `,
  });
  expect(result).toEqual({ stdout: "1 2 2 true true\npkg.inner.leaf pkg true true\n", stderr: "", exitCode: 0 });
});

test.concurrent("in a program that Python started", async () => {
  const result = await run(
    {
      "main.py": `import sys, helper\nsys.marker = "set by main.py"\nprint(helper.look())`,
      "helper.js": `
        import sys from "python:sys";
        import main from "python:__main__";
        export function look() { return [sys.marker, sys.argv.slice(1), main.__name__]; }
      `,
    },
    ["main.py", "argument"],
  );
  expect(result).toEqual({ stdout: "['set by main.py', ['argument'], '__main__']\n", stderr: "", exitCode: 0 });
});

test.concurrent("resolving gives the specifier back and does not start Python", async () => {
  const result = await run({
    "main.js": `
      console.log(import.meta.resolve("python:json"), Bun.resolveSync("python:os.path", import.meta.dir));
      console.log(require.resolve("python:json"), await Bun.resolve("python:not_there", import.meta.dir));
      const { isBuiltin } = require("node:module");
      console.log(["python:json", "python:os.path", "python:_thread", "python:not_there", "python:", "json"].map(isBuiltin).join());
    `,
  });
  expect(result).toEqual({
    stdout: "python:json python:os.path\npython:json python:not_there\ntrue,true,true,false,false,false\n",
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent(
  "a module that is not there is Python's ModuleNotFoundError, with the code JavaScript looks for",
  async () => {
    const result = await run({
      "needs_more.py": `import something_else_that_is_missing`,
      "main.js": `
      import { ModuleNotFoundError, ImportError } from "python:builtins";
      async function attempt(load) {
        try {
          await load();
          console.log("loaded");
        } catch (e) {
          console.log([e.name, e.message, e.code, e instanceof Error, e instanceof ModuleNotFoundError, e instanceof ImportError].join(" | "));
        }
      }
      await attempt(() => import("python:not_there"));
      await attempt(async () => require("python:not_there"));
      await attempt(() => import("python:json.not_there"));
      await attempt(() => import("python:os.path.join"));
      await attempt(() => import("python:"));
      // What the module itself could not find is not the module that was asked for.
      await attempt(() => import("python:needs_more"));
    `,
    });
    expect(result).toEqual({
      stdout: [
        "ModuleNotFoundError | No module named 'not_there' | ERR_MODULE_NOT_FOUND | true | true | true",
        "ModuleNotFoundError | No module named 'not_there' | MODULE_NOT_FOUND | true | true | true",
        "ModuleNotFoundError | No module named 'json.not_there' | ERR_MODULE_NOT_FOUND | true | true | true",
        "ModuleNotFoundError | No module named 'os.path.join'; 'os.path' is not a package | ERR_MODULE_NOT_FOUND | true | true | true",
        "ModuleNotFoundError | No module named '' | ERR_MODULE_NOT_FOUND | true | true | true",
        "ModuleNotFoundError | No module named 'something_else_that_is_missing' |  | true | true | true",
        "",
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    });
  },
);

test.concurrent("a static import of a module that is not there ends the program with the traceback", async () => {
  const result = await run({ "main.js": `import x from "python:not_there";\nconsole.log("never");` });
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("ModuleNotFoundError: No module named 'not_there'");
  expect(result.exitCode).toBe(1);
});

test.concurrent("a name the module does not have is the SyntaxError of any import", async () => {
  const result = await run({ "main.js": `import { not_there } from "python:json";\nconsole.log("never");` });
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain(`Export named 'not_there' not found in module 'python:json'`);
  expect(result.exitCode).toBe(1);
});

test.concurrent("a module whose import raises: that exception, and the next import tries again", async () => {
  const result = await run({
    "moody.py": `
import sys
sys.attempts = getattr(sys, "attempts", 0) + 1
if sys.attempts == 1:
    raise ZeroDivisionError("not in the mood")
mood = "better"
`,
    "wrong.py": `def f(:\n`,
    "main.js": `
      import { ZeroDivisionError, SyntaxError as PySyntaxError } from "python:builtins";
      try {
        await import("python:moody");
      } catch (e) {
        console.log(e instanceof ZeroDivisionError, e.message, e.code, e.stack.includes('moody.py", line 5, in <module>'));
      }
      console.log(require("python:moody").mood);
      try {
        require("python:wrong");
      } catch (e) {
        console.log(e instanceof PySyntaxError, e.msg, e.lineno, e.filename.endsWith("wrong.py"));
      }
    `,
  });
  expect(result).toEqual({
    stdout: "true not in the mood undefined true\nbetter\ntrue invalid syntax 1 true\n",
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("a name is never looked for among packages, let alone installed", async () => {
  let requests = 0;
  using registry = Bun.serve({
    port: 0,
    fetch() {
      requests++;
      return new Response("{}", { status: 404 });
    },
  });
  const result = await run(
    {
      "node_modules/python:decoy/package.json": `{ "name": "python:decoy", "main": "index.js" }`,
      "node_modules/python:decoy/index.js": `module.exports = "a package of npm's";`,
      "main.js": `
        for (const name of ["python:not_there", "python:decoy", "python:left_pad"]) {
          try {
            await import(name);
            console.log("loaded", name);
          } catch (e) {
            console.log(e.name, e.message);
          }
        }
      `,
    },
    ["--install=force", "main.js"],
    { BUN_CONFIG_REGISTRY: registry.url.href, NPM_CONFIG_REGISTRY: registry.url.href },
  );
  expect(result).toEqual({
    stdout:
      "ModuleNotFoundError No module named 'not_there'\n" +
      "ModuleNotFoundError No module named 'decoy'\n" +
      "ModuleNotFoundError No module named 'left_pad'\n",
    stderr: "",
    exitCode: 0,
  });
  expect(requests).toBe(0);
});

test.concurrent("the bundler leaves the imports as they are, for Bun", async () => {
  using dir = tempDir("python-prefix-bundle", {
    "entry.js": `
      import json, { dumps } from "python:json";
      import "python:side_effect";
      import unused from "python:unused_module";
      const path = require("python:os.path");
      console.log(dumps([path.basename("a/b"), (await import("python:math")).gcd(12, 18), json.loads("1")]));
    `,
    "side_effect.py": `print("imported for what it does")`,
    "unused_module.py": `print("imported too: importing a module runs it")`,
  });
  const build = async (...args: string[]) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "entry.js", ...args],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  };
  expect(await build("--target=bun", "--outfile=out.js")).toMatchObject({ stderr: "", exitCode: 0 });
  const bundled = await Bun.file(join(String(dir), "out.js")).text();
  for (const name of ["json", "side_effect", "unused_module", "os.path", "math"])
    expect(bundled).toContain(`"python:${name}"`);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "out.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: `imported for what it does\nimported too: importing a module runs it\n["b", 6, 1]\n`,
    stderr: "",
    exitCode: 0,
  });

  for (const target of ["browser", "node"]) {
    const refused = await build("--target=" + target, "--outfile=out-" + target + ".js");
    expect(refused.stderr).toContain(
      `Only Bun can import a Python module: "python:json". When bundling for Bun, set target to 'bun'`,
    );
    expect(refused.exitCode).toBe(1);
  }
});

test.concurrent("a plugin and a mock come first, as for any module", async () => {
  const result = await run(
    {
      "mocked.test.js": `
        import { expect, mock, test } from "bun:test";
        test("mock.module", async () => {
          mock.module("python:colorsys", () => ({ default: "a mock", rgb_to_hsv: () => "mocked" }));
          const colorsys = await import("python:colorsys");
          expect(colorsys.default).toBe("a mock");
          expect(colorsys.rgb_to_hsv()).toBe("mocked");
          expect(require("python:colorsys").rgb_to_hsv()).toBe("mocked");
        });
        test("onResolve", async () => {
          Bun.plugin({
            name: "redirect",
            setup(build) {
              build.onResolve({ filter: /^python:redirected$/ }, () => ({ path: "python:string" }));
            },
          });
          expect((await import("python:redirected")).digits).toBe("0123456789");
        });
      `,
    },
    ["test", "./mocked.test.js"],
  );
  expect(result.stderr).toContain("2 pass");
  expect(result.stderr).toContain("0 fail");
  expect(result.exitCode).toBe(0);
});

test.concurrent("a worker has its own Python", async () => {
  const result = await run({
    "worker.js": `
      import sys from "python:sys";
      postMessage(String(sys.marker));
    `,
    "main.js": `
      import sys from "python:sys";
      sys.marker = "of the main thread";
      const worker = new Worker(new URL("./worker.js", import.meta.url));
      const { promise, resolve } = Promise.withResolvers();
      worker.onmessage = event => resolve(event.data);
      console.log(await promise, "|", sys.marker);
      worker.terminate();
    `,
  });
  expect(result).toEqual({ stdout: "undefined | of the main thread\n", stderr: "", exitCode: 0 });
});
