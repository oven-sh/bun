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

test.concurrent("to the bundler a .py file is an asset", async () => {
  using dir = tempDir("python-bundle", {
    "tool.py": `print("a tool")`,
    "entry.js": `import tool from "./tool.py"; console.log(tool);`,
    "explicit.js": `import tool from "./tool.py" with { type: "python" }; console.log(tool);`,
  });
  for (const target of ["bun", "browser"]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "entry.js", "--target=" + target, "--outdir=out-" + target],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    const emitted = readdirSync(join(String(dir), "out-" + target)).sort();
    expect({ stderr, emitted: emitted.map(name => name.replace(/-[a-z0-9]+\.py$/, "-HASH.py")), exitCode }).toEqual({
      stderr: "",
      emitted: ["entry.js", "tool-HASH.py"],
      exitCode: 0,
    });
    expect(await Bun.file(join(String(dir), "out-" + target, "entry.js")).text()).toContain(emitted[1]);
  }
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "explicit.js", "--target=bun", "--outdir=out-explicit"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toContain(`The "python" loader is not supported by the bundler yet`);
  expect(exitCode).toBe(1);
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
