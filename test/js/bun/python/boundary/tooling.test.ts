// Bun's command line and module system with programs in both languages: -e, -p, scripts, shebangs, resolving, import attributes,
// cycles of imports, the bundler, --watch.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, symlinkSync, writeFileSync } from "node:fs";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "node:path";

// These builds take seconds to start Python.
if (isDebug || isASAN) setDefaultTimeout(120_000);

const greet = `
count = 0
def greet(name):
    return f"hello {name}"
print("greet.py runs")
`;

async function run(cwd: string, cmd: string[], env: Record<string, string | undefined> = bunEnv) {
  await using proc = Bun.spawn({ cmd, env, cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.replaceAll(cwd, "<dir>"), stderr: stderr.replaceAll(cwd, "<dir>"), exitCode };
}

describe.concurrent("the command line", () => {
  test("bun -e", async () => {
    using dir = tempDir("python-tooling", { "greet.py": greet });
    const code = `import json from "python:json"; const { greet } = require("./greet.py"); console.log(json.dumps([1]), greet("-e"));`;
    expect(await run(String(dir), [bunExe(), "-e", code])).toEqual({
      stdout: "greet.py runs\n[1] hello -e\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("bun -p shows repr()", async () => {
    using dir = tempDir("python-tooling", {});
    expect(await run(String(dir), [bunExe(), "-p", `require("python:builtins").tuple([1, "a"])`])).toEqual({
      stdout: "(1, 'a')\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test.skipIf(isWindows)("a script of package.json, and a file that says #!/usr/bin/env bun", async () => {
    using dir = tempDir("python-tooling", {
      "package.json": JSON.stringify({ scripts: { named: "bun main.py from-script", direct: "./main.py" } }),
      "main.py": `#!/usr/bin/env bun\nimport sys\nprint(sys.implementation.name, sys.argv[1:])\n`,
      "bin/.keep": "",
    });
    chmodSync(join(String(dir), "main.py"), 0o755);
    symlinkSync(bunExe(), join(String(dir), "bin", "bun"));
    const env = { ...bunEnv, PATH: `${join(String(dir), "bin")}:${bunEnv.PATH ?? process.env.PATH}` };
    const results = await Promise.all([
      run(String(dir), [bunExe(), "run", "--silent", "named"], env),
      run(String(dir), [bunExe(), "run", "--silent", "direct", "a", "b"], env),
      run(String(dir), [join(String(dir), "main.py"), "executed"], env),
      run(String(dir), [bunExe(), "run", "main.py", "run"], env),
    ]);
    expect(results.map(result => result.stdout)).toEqual([
      "bun ['from-script']\n",
      "bun ['a', 'b']\n",
      "bun ['executed']\n",
      "bun ['run']\n",
    ]);
    expect(results.map(result => result.exitCode)).toEqual([0, 0, 0, 0]);
  });

  test("bun repl", async () => {
    using dir = tempDir("python-tooling", {});
    await using proc = Bun.spawn({
      cmd: [bunExe(), "repl"],
      env: { ...bunEnv, NO_COLOR: "1" },
      cwd: String(dir),
      stdin: new Blob([`const { tuple } = require("python:builtins")\ntuple([1, 2])\n.exit\n`]),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toContain("(1, 2)");
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("modules", () => {
  test("resolving, require.cache, queries and import attributes", async () => {
    using dir = tempDir("python-tooling", {
      "greet.py": greet,
      "main.ts": `
        console.log(import.meta.resolve("./greet.py"), require.resolve("./greet.py"), Bun.resolveSync("python:os.path", "."));
        const module = require("./greet.py");
        require("python:json");
        console.log(Object.keys(require.cache).filter(key => key.includes("greet") || key.includes("python:")).join(" "));
        console.log((await import("./greet.py")).default === module, (await import("./greet.py?query")).default === module);
        delete require.cache[require.resolve("./greet.py")];
        console.log(require("./greet.py") === module);
        console.log(typeof (await import("./greet.py", { with: { type: "text" } })).default);
        console.log(typeof (await import("./greet.py", { with: { type: "file" } })).default);
      `,
    });
    expect(await run(String(dir), [bunExe(), "main.ts"])).toEqual({
      stdout: `file://<dir>/greet.py <dir>/greet.py python:os.path
greet.py runs
<dir>/greet.py python:json
true true
true
string
string
`,
      stderr: "",
      exitCode: 0,
    });
  });

  // importlib has no loader for the suffix, and what it answers then is passed on: AttributeError, 'NoneType' object has no attribute 'name'.
  test.failing("with { type: 'python' } on a file of another name", async () => {
    using dir = tempDir("python-tooling", {
      "data.txt": "x = 5\n",
      "main.ts": `console.log((await import("./data.txt", { with: { type: "python" } })).x);`,
    });
    expect((await run(String(dir), [bunExe(), "main.ts"])).stdout).toBe("5\n");
  });

  test("a cycle that begins in Python", async () => {
    using dir = tempDir("python-tooling", {
      "main.py": `
print("main.py begins")
import helper
value = "of main.py"
print("main.py ends", helper.fromTypeScript, helper.get())
`,
      "helper.ts": `
console.log("helper.ts begins");
const main = require("./main.py");
export const fromTypeScript = "of helper.ts";
export const get = () => main.value + " " + (main === require("./main.py"));
console.log("helper.ts ends", main.__name__, main.value);
`,
    });
    expect(await run(String(dir), [bunExe(), "main.py"])).toEqual({
      stdout: `main.py begins
helper.ts begins
helper.ts ends __main__ undefined
main.py ends of helper.ts of main.py true
`,
      stderr: "",
      exitCode: 0,
    });
  });

  // A .py file runs when it is fetched, while the module that imports it is still being loaded: require() refuses that one.
  test.failing("a cycle that begins in TypeScript", async () => {
    using dir = tempDir("python-tooling", {
      "main.ts": `
import { later } from "./helper.py";
export function ofTypeScript() { return "of main.ts"; }
console.log(later());
`,
      "helper.py": `
import main
def later():
    return main.ofTypeScript()
`,
    });
    expect((await run(String(dir), [bunExe(), "main.ts"])).stdout).toBe("of main.ts\n");
  });
});

describe.concurrent("bun build", () => {
  const program = {
    "greet.py": greet,
    "main.ts": `import module from "./greet.py";\nconsole.log(typeof module === "string" ? "a string" : module.greet("bundle"));`,
  };

  test("with the .py file external, the bundle does what the program does", async () => {
    using dir = tempDir("python-tooling", program);
    const built = await run(String(dir), [bunExe(), "build", "main.ts", "--target=bun", "--outfile=bundle.js", "--external", "./greet.py"]); // prettier-ignore
    expect(built.stderr).toBe("");
    expect(await run(String(dir), [bunExe(), "bundle.js"])).toEqual({
      stdout: "greet.py runs\nhello bundle\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // The file is an asset, and what is imported is its path.
  test.failing("the bundle does what the program does", async () => {
    using dir = tempDir("python-tooling", program);
    await run(String(dir), [bunExe(), "build", "main.ts", "--target=bun", "--outdir=out"]);
    expect((await run(join(String(dir), "out"), [bunExe(), "main.js"])).stdout).toBe("greet.py runs\nhello bundle\n");
  });
  test.failing("named imports from a .py file", async () => {
    using dir = tempDir("python-tooling", {
      "greet.py": greet,
      "main.ts": `import { greet } from "./greet.py";\nconsole.log(greet("bundle"));`,
    });
    expect((await run(String(dir), [bunExe(), "build", "main.ts", "--target=bun", "--outdir=out"])).exitCode).toBe(0);
  });

  // The executable of these builds is too large to copy in a test.
  test.skipIf(isDebug || isASAN)("--compile: the standard library is in the executable", async () => {
    using dir = tempDir("python-tooling", {
      "main.ts": `import json from "python:json";\nconsole.log(json.dumps([1, 2]));`,
      "elsewhere/.keep": "",
    });
    const built = await run(String(dir), [bunExe(), "build", "--compile", "main.ts", "--outfile=program"]);
    expect(built.exitCode).toBe(0);
    expect(await run(join(String(dir), "elsewhere"), [join(String(dir), "program")])).toEqual({
      stdout: "[1, 2]\n",
      stderr: "",
      exitCode: 0,
    });
  });
});

describe.concurrent("--watch", () => {
  /** Runs the program until it has printed the first line, changes the file, and waits for the second line. */
  async function watch(
    files: Record<string, string>,
    main: string,
    changed: string,
    contents: string,
    lines: [string, string],
  ) {
    using dir = tempDir("python-watch", files);
    await using proc = Bun.spawn({ cmd: [bunExe(), "--watch", main], env: bunEnv, cwd: String(dir), stdout: "pipe", stderr: "inherit" }); // prettier-ignore
    let output = "";
    let hasChanged = false;
    for await (const chunk of proc.stdout) {
      output += new TextDecoder().decode(chunk);
      if (!hasChanged && output.includes(lines[0])) {
        hasChanged = true;
        writeFileSync(join(String(dir), changed), contents);
      }
      if (output.includes(lines[1])) break;
    }
    proc.kill();
    return output;
  }

  test("a program in Python is run again when it changes", async () => {
    const program = (value: number) =>
      `import js\njs.setTimeout(lambda: print("value", ${value}, flush=True), 0)\njs.setInterval(lambda: None, 1000)\n`;
    expect(await watch({ "main.py": program(1) }, "main.py", "main.py", program(2), ["value 1", "value 2"])).toContain(
      "value 2",
    );
  });

  // The file is watched once it has run, and most programs in Python are over then.
  test.todo("a program in Python is run again when it changes while its top level runs");
  test.todo("a program is run again when a .py file it imports changes");
  test.todo("--hot loads a .py file that has changed again");
});
