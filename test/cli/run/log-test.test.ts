import { spawnSync } from "bun";
import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

it("should not log .env when quiet", async () => {
  using dir = tempDir("log-test-silent", {
    ".env": "FOO=bar",
    "bunfig.toml": `logLevel = "error"`,
    "index.ts": "export default console.log('Here');",
  });
  const { stderr } = spawnSync({
    cmd: [bunExe(), "index.ts"],
    cwd: String(dir),
    env: bunEnv,
  });

  expect(stderr!.toString()).toBe("");
});

it("should log .env by default", async () => {
  using dir = tempDir("log-test-silent", {
    ".env": "FOO=bar",
    "bunfig.toml": ``,
    "index.ts": "export default console.log('Here');",
  });

  const { stderr } = spawnSync({
    cmd: [bunExe(), "index.ts"],
    cwd: String(dir),
    env: bunEnv,
  });

  expect(stderr?.toString().includes(".env")).toBe(false);
});

// Number of times env loading reported a file: each load through a loader that
// is not quiet prints one `[0.12ms] ".env"` line.
const envLines = (stderr: string) => stderr.split('".env"').length - 1;

describe.concurrent("bun test", () => {
  // `bun test` creates the loader it hands to its VM and configures it from the
  // same log level `bun <file>` uses; nothing else does.
  test.each([
    { name: "does not log .env by default", bunfig: "", lines: 0 },
    { name: 'logs .env with logLevel = "debug"', bunfig: 'logLevel = "debug"\n', lines: 1 },
  ])("$name", async ({ bunfig, lines }) => {
    using dir = tempDir("log-test-bun-test", {
      ".env": "FOO=bar\n",
      "bunfig.toml": bunfig,
      "a.test.ts": `import { test } from "bun:test"; test("runs", () => {});`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    // The report goes to stderr, after the line under test; stdout only
    // carries the banner.
    const [stderr, , exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
    expect(envLines(stderr)).toBe(lines);
    expect(exitCode).toBe(0);
  });
});

// A Worker VM creates its own loader and configures it from its own log, which
// is `Log::default()`: info in builds with debug assertions, warn otherwise, so
// whether the worker reports the file at startup depends on the build and is
// only used as the reference value here. Bun.build borrows the calling VM's
// loader for the transpiler it sets up on the bundle thread (and for the macro
// VM a macro import creates there), and `new Bun.Transpiler()` borrows it on the
// JS thread; none of them may re-derive the setting from their own log level,
// which is the process-wide one and so differs from the worker's in one
// direction or the other depending on the build. So builds called from the
// worker must report the .env file exactly as often as the worker's own startup
// did.
describe.concurrent("Bun.build and Bun.Transpiler leave the calling VM's env loader output setting alone", () => {
  test.each([
    // The Bun.Transpiler log level is the opposite of what the worker's loader
    // is set to in the build type where this row discriminates.
    { name: "default log level", bunfig: "", transpilerLogLevel: "error" },
    { name: 'logLevel = "debug"', bunfig: 'logLevel = "debug"\n', transpilerLogLevel: "verbose" },
  ])("$name", async ({ bunfig, transpilerLogLevel }) => {
    using dir = tempDir("log-test-worker-build", {
      ".env": "FOO=bar\n",
      "bunfig.toml": bunfig,
      "entry.ts": "export const foo = process.env.FOO;\n",
      "macro.ts": "export function answer() { return 42; }\n",
      "entry-with-macro.ts": `
        import { answer } from "./macro.ts" with { type: "macro" };
        export const n = answer();
      `,
      "worker.ts": `
        console.error("--worker started--");
        await Bun.build({ entrypoints: ["./entry.ts"], env: "inline" });
        console.error("--build 1 done--");
        new Bun.Transpiler({ logLevel: ${JSON.stringify(transpilerLogLevel)} });
        await Bun.build({ entrypoints: ["./entry.ts"], env: "inline" });
        console.error("--build 2 done--");
        await Bun.build({ entrypoints: ["./entry-with-macro.ts"], env: "inline" });
        console.error("--build 3 done--");
        await Bun.build({ entrypoints: ["./entry.ts"], env: "inline" });
        console.error("--build 4 done--");
        postMessage("done");
      `,
      "main.ts": `
        console.error("--main started--");
        const { promise, resolve, reject } = Promise.withResolvers();
        const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
        worker.onmessage = resolve;
        worker.onerror = event => reject(new Error(event.message));
        await promise;
        worker.terminate();
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    // stdout is only drained: debug builds print a `[macro] call` line there.
    const [stderr, , exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);

    const segments = stderr.split(/--(?:main started|worker started|build \d done)--\r?\n/);
    expect(segments).toHaveLength(7);
    const [mainStartup, workerStartup, build1, build2, , build4] = segments;
    const atWorkerStartup = envLines(workerStartup);
    expect([0, 1]).toContain(atWorkerStartup);
    expect({
      // The main VM uses the process-wide level, i.e. what a build's transpiler
      // would apply if it configured the loader.
      mainStartup: envLines(mainStartup),
      build1: envLines(build1),
      afterTranspiler: envLines(build2),
      // Build 3's own segment is not compared: the macro VM it creates also
      // loads env files through the borrowed loader. Build 4 shows whether
      // creating it changed the setting.
      afterMacroBuild: envLines(build4),
    }).toEqual({
      mainStartup: bunfig === "" ? 0 : 1,
      build1: atWorkerStartup,
      afterTranspiler: atWorkerStartup,
      afterMacroBuild: atWorkerStartup,
    });
    expect(exitCode).toBe(0);
  });
});
