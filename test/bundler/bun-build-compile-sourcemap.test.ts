import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

describe("Bun.build compile with sourcemap", () => {
  const helperFiles = {
    "helper.js": `export function helperFunction() {
  throw new Error("Error from helper module");
}`,
    "app.js": `import { helperFunction } from "./helper.js";

function main() {
  helperFunction();
}

main();`,
  };

  async function testSourcemapOption(sourcemapValue: "inline" | "external" | true, testName: string) {
    using dir = tempDir(`build-compile-sourcemap-${testName}`, helperFiles);

    const result = await Bun.build({
      entrypoints: [join(String(dir), "app.js")],
      compile: { outfile: join(String(dir), "app") },
      sourcemap: sourcemapValue,
    });

    expect(result.success).toBe(true);

    const executableOutput = result.outputs.find((o: any) => o.kind === "entry-point")!;
    const executablePath = executableOutput.path;
    expect(await Bun.file(executablePath).exists()).toBe(true);

    // Run the compiled executable and capture the error
    await using proc = Bun.spawn({
      cmd: [executablePath],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [_stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // With sourcemaps working, we should see the actual file names
    expect(stderr).toContain("helper.js");
    expect(stderr).toContain("app.js");

    // Should NOT see the bundled virtual path (/$bunfs/root/ on Unix, B:/~BUN/root/ on Windows)
    expect(stderr).not.toMatch(/(\$bunfs|~BUN)\/root\//);

    // Verify it failed (the error was thrown)
    expect(exitCode).not.toBe(0);
  }

  test.each([
    ["inline" as const, "inline"],
    [true as const, "true"],
    ["external" as const, "external"],
  ])("compile with sourcemap: %s should work", async (sourcemapValue, testName) => {
    await testSourcemapOption(sourcemapValue, testName);
  });

  test("compile without sourcemap should show bundled paths", async () => {
    using dir = tempDir("build-compile-no-sourcemap", helperFiles);

    const result = await Bun.build({
      entrypoints: [join(String(dir), "app.js")],
      compile: { outfile: join(String(dir), "app") },
      // No sourcemap option
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);

    const executablePath = result.outputs[0].path;
    expect(await Bun.file(executablePath).exists()).toBe(true);

    // Run the compiled executable and capture the error
    await using proc = Bun.spawn({
      cmd: [executablePath],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [_stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Without sourcemaps, we should see the bundled virtual path (/$bunfs/root/ on Unix, B:/~BUN/root/ on Windows)
    expect(stderr).toMatch(/(\$bunfs|~BUN)\/root\//);

    // Verify it failed (the error was thrown)
    expect(exitCode).not.toBe(0);
  });

  test("compile with sourcemap: external writes .map file to disk", async () => {
    using dir = tempDir("build-compile-sourcemap-external-file", helperFiles);

    const result = await Bun.build({
      entrypoints: [join(String(dir), "app.js")],
      compile: { outfile: join(String(dir), "app") },
      sourcemap: "external",
    });

    expect(result.success).toBe(true);

    const executableOutput = result.outputs.find((o: any) => o.kind === "entry-point")!;
    const executablePath = executableOutput.path;
    expect(await Bun.file(executablePath).exists()).toBe(true);

    // The sourcemap output should appear in build result outputs
    const sourcemapOutputs = result.outputs.filter((o: any) => o.kind === "sourcemap");
    expect(sourcemapOutputs.length).toBe(1);

    // The .map file should exist next to the executable
    const mapPath = sourcemapOutputs[0].path;
    expect(mapPath).toEndWith(".map");
    expect(await Bun.file(mapPath).exists()).toBe(true);

    // Validate the sourcemap is valid JSON with expected fields
    const mapContent = JSON.parse(await Bun.file(mapPath).text());
    expect(mapContent.version).toBe(3);
    expect(mapContent.sources).toBeArray();
    expect(mapContent.sources.length).toBeGreaterThan(0);
    expect(mapContent.mappings).toBeString();
  });

  test("compile without sourcemap does not write .map file", async () => {
    using dir = tempDir("build-compile-no-sourcemap-file", {
      "nosourcemap_entry.js": helperFiles["app.js"],
      "helper.js": helperFiles["helper.js"],
    });

    const result = await Bun.build({
      entrypoints: [join(String(dir), "nosourcemap_entry.js")],
      compile: { outfile: join(String(dir), "nosourcemap_entry") },
    });

    expect(result.success).toBe(true);

    const executableOutput = result.outputs.find((o: any) => o.kind === "entry-point")!;
    const executablePath = executableOutput.path;
    // No .map file should exist next to the executable
    expect(await Bun.file(`${executablePath}.map`).exists()).toBe(false);
    // No sourcemap outputs should be in the result
    const sourcemapOutputs = result.outputs.filter((o: any) => o.kind === "sourcemap");
    expect(sourcemapOutputs.length).toBe(0);
  });

  test("compile with splitting and external sourcemap writes multiple .map files", async () => {
    using dir = tempDir("build-compile-sourcemap-splitting", {
      "entry.js": `
const mod = await import("./lazy.js");
mod.greet();
`,
      "lazy.js": `
export function greet() {
  console.log("hello from lazy module");
}
`,
    });

    const result = await Bun.build({
      entrypoints: [join(String(dir), "entry.js")],
      compile: { outfile: join(String(dir), "entry") },
      splitting: true,
      sourcemap: "external",
    });

    expect(result.success).toBe(true);

    const executableOutput = result.outputs.find((o: any) => o.kind === "entry-point")!;
    const executablePath = executableOutput.path;
    expect(await Bun.file(executablePath).exists()).toBe(true);

    // With splitting and a dynamic import, there should be at least 2 sourcemaps
    // (one for the entry chunk, one for the lazy-loaded chunk)
    const sourcemapOutputs = result.outputs.filter((o: any) => o.kind === "sourcemap");
    expect(sourcemapOutputs.length).toBeGreaterThanOrEqual(2);

    // Each sourcemap should be a valid .map file on disk
    const mapPaths = new Set<string>();
    for (const sm of sourcemapOutputs) {
      expect(sm.path).toEndWith(".map");
      expect(await Bun.file(sm.path).exists()).toBe(true);

      // Each map file should have a unique path (no overwrites)
      expect(mapPaths.has(sm.path)).toBe(false);
      mapPaths.add(sm.path);

      // Validate the sourcemap is valid JSON
      const mapContent = JSON.parse(await Bun.file(sm.path).text());
      expect(mapContent.version).toBe(3);
      expect(mapContent.mappings).toBeString();
    }

    // Run the compiled executable to ensure it works
    await using proc = Bun.spawn({
      cmd: [executablePath],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("hello from lazy module");
    expect(exitCode).toBe(0);
  });

  test("compile with --outfile subdir/myapp writes .map next to executable", async () => {
    using dir = tempDir("build-compile-sourcemap-outfile-subdir", helperFiles);

    const subdirPath = join(String(dir), "subdir");
    const exeSuffix = process.platform === "win32" ? ".exe" : "";

    // Use CLI: bun build --compile --outfile subdir/myapp --sourcemap=external
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        join(String(dir), "app.js"),
        "--outfile",
        join(subdirPath, "myapp"),
        "--sourcemap=external",
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [_stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    // The executable should be at subdir/myapp (with .exe on Windows)
    expect(await Bun.file(join(subdirPath, `myapp${exeSuffix}`)).exists()).toBe(true);

    // The .map file should be in subdir/ (next to the executable), named after the executable
    const glob = new Bun.Glob("*.map");
    const mapFiles = Array.from(glob.scanSync({ cwd: subdirPath }));
    expect(mapFiles).toEqual(["myapp.map"]);

    // Validate the sourcemap is valid JSON
    const mapContent = JSON.parse(await Bun.file(join(subdirPath, mapFiles[0])).text());
    expect(mapContent.version).toBe(3);
    expect(mapContent.mappings).toBeString();

    // Verify no .map was written into the doubled path subdir/subdir/
    expect(await Bun.file(join(String(dir), "subdir", "subdir", "myapp.map")).exists()).toBe(false);
  });

  test("compile with multiple source files", async () => {
    using dir = tempDir("build-compile-sourcemap-multiple-files", {
      "utils.js": `export function utilError() {
  throw new Error("Error from utils");
}`,
      "helper.js": `import { utilError } from "./utils.js";
export function helperFunction() {
  utilError();
}`,
      "app.js": `import { helperFunction } from "./helper.js";

function main() {
  helperFunction();
}

main();`,
    });

    const result = await Bun.build({
      entrypoints: [join(String(dir), "app.js")],
      compile: { outfile: join(String(dir), "app") },
      sourcemap: "inline",
    });

    expect(result.success).toBe(true);
    const executable = result.outputs[0].path;
    expect(await Bun.file(executable).exists()).toBe(true);

    // Run the executable
    await using proc = Bun.spawn({
      cmd: [executable],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [_stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // With sourcemaps, should show all three source file names
    expect(stderr).toContain("utils.js");
    expect(stderr).toContain("helper.js");
    expect(stderr).toContain("app.js");

    // Should NOT show bundled paths (/$bunfs/root/ on Unix, B:/~BUN/root/ on Windows)
    expect(stderr).not.toMatch(/(\$bunfs|~BUN)\/root\//);

    // Verify it failed (the error was thrown)
    expect(exitCode).not.toBe(0);
  });

  // The executable embeds the source map of its own text. A program can compile other text under the name of that
  // text (Bun.main), and a position in it is not a position in a module of the executable. Line 6 and line 40 of
  // the entry point's chunk are lines that its source map has an answer for in one build or another.
  test.each([
    ["an ES module", {}],
    ["an ES module with bytecode", { format: "esm", bytecode: true }],
    ["CommonJS with bytecode", { format: "cjs", bytecode: true }],
    ["more than one chunk", { splitting: true }],
  ] as const)(
    "text that the program compiles under the name of its own chunk keeps its positions (%s)",
    async (_, options) => {
      using dir = tempDir("build-compile-sourcemap-own-name", {
        "app.ts": String.raw`import Module from "node:module";
import vm from "node:vm";

type Padding = { a: number };
function own(): Error {
  try {
    throw new Error("own");
  } catch (e) {
    return e as Error;
  }
}

const chunk = Bun.main;
const body = "function f() { try { throw new Error('z'); } catch (e) { return e; } }";
const at = (e: Error) => e.stack!.split("\n")[1].trim();
const texts: Record<string, object> = {};
for (const line of [6, 40]) {
  const above = "\n".repeat(line - 1);
  const compiled = new Module(chunk);
  compiled._compile(above + "exports.f = " + body, chunk);
  texts[line] = {
    compile: at(compiled.exports.f()),
    vm: at(vm.runInThisContext(above + "(" + body + ")", { filename: chunk })()),
    eval: at((0, eval)(above + "(" + body + ")\n//# sourceURL=" + chunk)()),
  };
}
// Each VM of the program reads the embedded map of the text it runs.
const worker = new Worker("./worker.ts");
worker.onmessage = async ({ data }) => {
  const { lazy } = await import("./lazy.ts");
  console.log(JSON.stringify({ chunk, own: at(own()), lazy: at(lazy()), worker: data, texts }));
  worker.terminate();
};
worker.postMessage(0);
`,
        "lazy.ts": String.raw`type Padding = { a: number };
type More = { b: number };
export function lazy(): Error {
  try {
    throw new Error("lazy");
  } catch (e) {
    return e as Error;
  }
}
`,
        "worker.ts": String.raw`type Padding = { a: number };
type More = { b: number };
declare var self: Worker;
function inWorker(): Error {
  try {
    throw new Error("worker");
  } catch (e) {
    return e as Error;
  }
}
self.onmessage = () => postMessage(inWorker().stack!.split("\n")[1].trim());
`,
      });

      const result = await Bun.build({
        entrypoints: [join(String(dir), "app.ts"), join(String(dir), "worker.ts")],
        compile: { outfile: join(String(dir), "app") },
        sourcemap: "inline",
        ...options,
      });
      expect(result.success).toBe(true);

      await using proc = Bun.spawn({
        cmd: [result.outputs[0].path],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      const out = JSON.parse(stdout);
      const text = (line: number) => ({
        compile: `at f (${out.chunk}:${line}:49)`,
        vm: `at f (${out.chunk}:${line}:38)`,
        eval: `at f (${out.chunk}:${line}:38)`,
      });
      expect(out).toEqual({
        chunk: expect.any(String),
        own: expect.stringMatching(/^at own \(.*app\.ts:7:15\)$/),
        lazy: expect.stringMatching(/^at lazy \(.*lazy\.ts:5:15\)$/),
        worker: expect.stringMatching(/^at inWorker \(.*worker\.ts:6:15\)$/),
        texts: { 6: text(6), 40: text(40) },
      });
      expect(exitCode).toBe(0);
    },
  );
});
