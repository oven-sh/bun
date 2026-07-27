import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// `Bun.build({compile: true})` copies the whole runtime into the output, so each
// call dominates wall time. In-process Bun.build calls share bundler state and
// gain nothing from `test.concurrent`, so these stay sequential and instead fold
// what used to be separate compiles into shared builds. 30s per-test matches the
// `compile` budget in expectBundled.ts; the default 5s is too tight under
// debug+ASAN where the binary copy alone approaches it.
const compileTimeout = 30_000;

describe("Bun.build compile with sourcemap", () => {
  // Three-deep import chain so one stack trace exercises mapping across
  // every source file in the bundle.
  const helperFiles = {
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
  };

  async function runExecutable(executablePath: string, cwd: string) {
    await using proc = Bun.spawn({
      cmd: [executablePath],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.each([
    ["inline", "inline" as const],
    ["true", true as const],
    ["external", "external" as const],
  ])(
    "compile with sourcemap: %s maps the stack trace back to source files",
    async (testName, sourcemapValue) => {
      using dir = tempDir(`build-compile-sourcemap-${testName}`, helperFiles);

      const result = await Bun.build({
        entrypoints: [join(String(dir), "app.js")],
        compile: true,
        sourcemap: sourcemapValue,
      });

      expect(result.success).toBe(true);

      const executableOutput = result.outputs.find((o: any) => o.kind === "entry-point")!;
      const executablePath = executableOutput.path;
      expect(await Bun.file(executablePath).exists()).toBe(true);

      if (sourcemapValue === "external") {
        // The .map file must land on disk next to the executable with real
        // mappings back to every input file.
        const sourcemapOutputs = result.outputs.filter((o: any) => o.kind === "sourcemap");
        expect(sourcemapOutputs.length).toBe(1);
        const mapPath = sourcemapOutputs[0].path;
        expect(mapPath).toEndWith(".map");
        expect(await Bun.file(mapPath).exists()).toBe(true);

        const mapContent = JSON.parse(await Bun.file(mapPath).text());
        expect(mapContent.version).toBe(3);
        expect(mapContent.mappings.length).toBeGreaterThan(0);
        const sources = mapContent.sources.map((s: string) => s.split(/[\\/]/).pop());
        expect(sources).toEqual(expect.arrayContaining(["utils.js", "helper.js", "app.js"]));
      }

      const { stderr, exitCode } = await runExecutable(executablePath, String(dir));

      // Every frame must be remapped to its original file AND line.
      expect(stderr).toContain("Error from utils");
      expect(stderr).toContain("utils.js:2");
      expect(stderr).toContain("helper.js:3");
      expect(stderr).toContain("app.js:4");
      // Should NOT see the bundled virtual path (/$bunfs/root/ on Unix, B:/~BUN/root/ on Windows)
      expect(stderr).not.toMatch(/(\$bunfs|~BUN)\/root\//);
      expect(exitCode).not.toBe(0);
    },
    compileTimeout,
  );

  test(
    "compile without sourcemap shows bundled paths and writes no .map file",
    async () => {
      using dir = tempDir("build-compile-no-sourcemap", helperFiles);

      const result = await Bun.build({
        entrypoints: [join(String(dir), "app.js")],
        compile: true,
        // No sourcemap option
      });

      expect(result.success).toBe(true);
      expect(result.outputs.filter((o: any) => o.kind === "sourcemap").length).toBe(0);

      const executableOutput = result.outputs.find((o: any) => o.kind === "entry-point")!;
      const executablePath = executableOutput.path;
      expect(await Bun.file(executablePath).exists()).toBe(true);
      expect(await Bun.file(`${executablePath}.map`).exists()).toBe(false);

      const { stderr, exitCode } = await runExecutable(executablePath, String(dir));

      // Without sourcemaps, the bundled virtual path (/$bunfs/root/ on Unix, B:/~BUN/root/ on Windows) is what shows.
      expect(stderr).toContain("Error from utils");
      expect(stderr).toMatch(/(\$bunfs|~BUN)\/root\//);
      expect(exitCode).not.toBe(0);
    },
    compileTimeout,
  );

  test(
    "compile with splitting and external sourcemap writes multiple .map files",
    async () => {
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
        compile: true,
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

        const mapContent = JSON.parse(await Bun.file(sm.path).text());
        expect(mapContent.version).toBe(3);
        expect(mapContent.mappings).toBeString();
      }

      const { stdout, exitCode } = await runExecutable(executablePath, String(dir));

      expect(stdout).toContain("hello from lazy module");
      expect(exitCode).toBe(0);
    },
    compileTimeout,
  );

  test(
    "compile with --outfile subdir/myapp writes .map next to executable",
    async () => {
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

      // The .map file should be in subdir/ (next to the executable)
      const glob = new Bun.Glob("*.map");
      const mapFiles = Array.from(glob.scanSync({ cwd: subdirPath }));
      expect(mapFiles.length).toBe(1);

      const mapContent = JSON.parse(await Bun.file(join(subdirPath, mapFiles[0])).text());
      expect(mapContent.version).toBe(3);
      expect(mapContent.mappings.length).toBeGreaterThan(0);

      // Verify no .map was written into the doubled path subdir/subdir/
      expect(await Bun.file(join(String(dir), "subdir", "subdir", "myapp.map")).exists()).toBe(false);
    },
    compileTimeout,
  );
});
