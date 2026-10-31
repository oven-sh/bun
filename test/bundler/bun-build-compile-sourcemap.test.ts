import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";

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

  // The `.map` files of an executable are beside it, so their `sources` are relative to its directory. The names
  // that the executable prints are relative to the working directory of the build, wherever the executable goes.
  describe("sources of the maps, and the names that the executable prints", () => {
    const project = {
      "proj/main.ts": `import { where } from "./a/deep/where";\nwhere();`,
      "proj/a/deep/worker.ts": `import { where } from "./where";\nwhere();`,
      "proj/a/deep/where.ts": `export function where() {\n  throw new Error("thrown in where");\n}`,
    };
    const printedByTheProject = ["at where (proj/a/deep/where.ts:2:9)", "at proj/main.ts:2:1"];

    async function run(cwd: string, ...cmd: string[]) {
      await using proc = Bun.spawn({ cmd, env: bunEnv, cwd, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }

    // The `sources` of each map below `folder`, and the entries that name no file from the directory of their map.
    async function readMaps(folder: string) {
      const sources: Record<string, string[]> = {};
      const unresolved: string[] = [];
      for (const map of new Bun.Glob("**/*.map").scanSync({ cwd: folder })) {
        const entries: string[] = (await Bun.file(join(folder, map)).json()).sources;
        sources[map.replaceAll("\\", "/")] = entries;
        unresolved.push(...entries.filter(entry => !existsSync(resolve(dirname(join(folder, map)), entry))));
      }
      return { sources, unresolved };
    }

    // Runs the executable in another directory than the build's.
    const runExecutable = (...path: string[]) => run(tmpdir(), join(...path) + (isWindows ? ".exe" : ""));

    // The `at` lines of the error that ends the executable.
    async function printedFrames(...executable: string[]) {
      const { stderr, exitCode } = await runExecutable(...executable);
      const lines = stderr.split("\n").map(line => line.trim());
      return { frames: lines.filter(line => line.startsWith("at ")), exitCode };
    }

    test.concurrent.each([
      [
        "app",
        {
          "app.map": ["proj/a/deep/where.ts", "proj/main.ts"],
          "worker.js.map": ["proj/a/deep/where.ts", "proj/a/deep/worker.ts"],
        },
      ],
      [
        "out/app",
        {
          "out/app.map": ["../proj/a/deep/where.ts", "../proj/main.ts"],
          "out/worker.js.map": ["../proj/a/deep/where.ts", "../proj/a/deep/worker.ts"],
        },
      ],
    ])(
      "bun build --compile --outfile %s",
      async (outfile, sources) => {
        using dir = tempDir("build-compile-sourcemap-sources-cli", project);
        const entryPoints = ["./proj/main.ts", "./proj/a/deep/worker.ts"];
        const build = await run(
          String(dir),
          bunExe(),
          "build",
          "--compile",
          "--sourcemap=external",
          ...entryPoints,
          "--outfile",
          outfile,
        );
        expect(build.stderr).toBe("");
        expect(await readMaps(String(dir))).toEqual({ sources, unresolved: [] });
        expect(build.exitCode).toBe(0);
        expect(await printedFrames(String(dir), outfile)).toEqual({ frames: printedByTheProject, exitCode: 1 });
      },
      60_000,
    );

    test.concurrent(
      "Bun.build with an outdir, and an outfile in a directory",
      async () => {
        using dir = tempDir("build-compile-sourcemap-sources-api", {
          ...project,
          "build-fixture.ts": `
            const result = await Bun.build({
              entrypoints: ["./proj/main.ts", "./proj/a/deep/worker.ts"],
              compile: { outfile: "bin/app" },
              outdir: "out",
              sourcemap: "external",
            });
            for (const output of result.outputs) {
              if (output.kind === "sourcemap" && (await output.text()) !== (await Bun.file(output.path).text())) {
                throw new Error("the artifact is not the file at " + output.path);
              }
            }
          `,
        });
        const build = await run(String(dir), bunExe(), "build-fixture.ts");
        expect(build.stderr).toBe("");
        expect(await readMaps(String(dir))).toEqual({
          sources: {
            "out/bin/app.map": ["../../proj/a/deep/where.ts", "../../proj/main.ts"],
            "out/bin/worker.js.map": ["../../proj/a/deep/where.ts", "../../proj/a/deep/worker.ts"],
          },
          unresolved: [],
        });
        expect(build.exitCode).toBe(0);
        expect(await printedFrames(String(dir), "out", "bin", "app")).toEqual({
          frames: printedByTheProject,
          exitCode: 1,
        });
      },
      60_000,
    );

    // A source that a plugin made has no path: the map and the executable have its name.
    test.concurrent(
      "Bun.build with a source of a plugin and a source in memory",
      async () => {
        using dir = tempDir("build-compile-sourcemap-sources-not-files", {
          "proj/main.ts": `
            import { fromPlugin } from "made:by-a-plugin";
            import { fromMemory } from "./memory.ts";
            for (const thrower of [fromPlugin, fromMemory]) {
              try {
                thrower();
              } catch (error) {
                console.log((error as Error).stack!.split("\\n")[1].trim());
              }
            }
          `,
          "build-fixture.ts": `
            import { join } from "path";
            await Bun.build({
              entrypoints: ["./proj/main.ts"],
              compile: { outfile: "app" },
              outdir: "out",
              sourcemap: "external",
              files: {
                [join(import.meta.dir, "proj", "memory.ts")]: "export function fromMemory() {\\n  throw new Error();\\n}",
              },
              plugins: [
                {
                  name: "made",
                  setup(build) {
                    build.onResolve({ filter: /^made:/ }, args => ({ path: args.path.slice(5), namespace: "made" }));
                    build.onLoad({ filter: /.*/, namespace: "made" }, () => ({
                      contents: "export function fromPlugin() {\\n  throw new Error();\\n}",
                      loader: "ts",
                    }));
                  },
                },
              ],
            });
          `,
        });
        const build = await run(String(dir), bunExe(), "build-fixture.ts");
        expect(build.stderr).toBe("");
        expect((await readMaps(String(dir))).sources).toEqual({
          "out/app.map": ["made:by-a-plugin", "../proj/memory.ts", "../proj/main.ts"],
        });
        expect(build.exitCode).toBe(0);
        expect(await runExecutable(String(dir), "out", "app")).toEqual({
          stdout: "at fromPlugin (made:by-a-plugin:2:9)\nat fromMemory (proj/memory.ts:2:9)\n",
          stderr: "",
          exitCode: 0,
        });
      },
      60_000,
    );

    // The executable and its maps go where the linker was told, so the entries resolve from there.
    test.concurrent(
      "Bun.build while a plugin changes the working directory",
      async () => {
        using dir = tempDir("build-compile-sourcemap-sources-chdir", {
          ...project,
          "elsewhere/empty.txt": "",
          "build-fixture.ts": `
            import { existsSync } from "fs";
            import { dirname, join, resolve } from "path";
            const result = await Bun.build({
              entrypoints: [join(import.meta.dir, "proj", "main.ts")],
              compile: { outfile: "app" },
              outdir: "out",
              sourcemap: "external",
              plugins: [
                {
                  name: "chdir",
                  setup(build) {
                    build.onLoad({ filter: /where\\.ts$/ }, async ({ path }) => {
                      process.chdir("elsewhere");
                      return { contents: await Bun.file(path).text(), loader: "ts" };
                    });
                  },
                },
              ],
            });
            const map = result.outputs.find(output => output.kind === "sourcemap")!;
            const { sources } = await Bun.file(map.path).json();
            const resolved = sources.filter(source => existsSync(resolve(dirname(map.path), source)));
            console.log(resolved.length, "of", sources.length);
          `,
        });
        expect(await run(String(dir), bunExe(), "build-fixture.ts")).toEqual({
          stdout: "2 of 2\n",
          stderr: "",
          exitCode: 0,
        });
      },
      60_000,
    );
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
});
