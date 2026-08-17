// A compiled binary drops the resident pages of its embedded modules
// (source + bytecode) once the entrypoint has been evaluated, and again from
// the idle GC timer as lazily-decoded functions page them back in.
// BUN_FEATURE_FLAG_DISABLE_STANDALONE_MADVISE, read by the compiled binary at
// runtime, disables both.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import path from "node:path";

// Debug ASAN builds embed an @executable_path rpath for asan-dyld-shim.dylib;
// the compiled exe lives elsewhere, so point dyld back at the build dir.
const runEnv = { ...bunEnv, DYLD_FALLBACK_LIBRARY_PATH: path.dirname(bunExe()) };

async function compile(dir: string, entry: string, ...flags: string[]): Promise<string> {
  const out = path.join(dir, "compiled");
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", ...flags, path.join(dir, entry), "--outfile", out],
    env: bunEnv,
    stderr: "pipe",
    stdout: "ignore",
  });
  const [stderr, exitCode] = await Promise.all([build.stderr.text(), build.exited]);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
  return out;
}

// Relies on the StandaloneModuleGraph scoped logger which is compiled out in
// release builds.
test.concurrent.skipIf(isWindows || !isDebug)(
  "release fires with a top-level await entrypoint",
  async () => {
    // PR #29320: loadEntryPoint() returns without blocking on TLA, so the
    // release must still happen synchronously before the event loop spins.
    using dir = tempDir("standalone-madvise-tla", {
      "entry.ts": `
      console.log("before-await");
      await new Promise<void>(r => setTimeout(r, 0));
      console.log("after-await");
    `,
    });
    const out = await compile(String(dir), "entry.ts");

    for (const [flag, released] of [
      [undefined, true],
      ["0", true],
      ["1", false],
    ] as const) {
      await using proc = Bun.spawn({
        cmd: [out],
        env: {
          ...runEnv,
          BUN_DEBUG_StandaloneModuleGraph: "1",
          BUN_FEATURE_FLAG_DISABLE_STANDALONE_MADVISE: flag,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("before-await");
      expect(stdout).toContain("after-await");
      // Scoped loggers write to the debug-writer stream (stdout by default).
      if (released) {
        expect(stdout).toContain("releaseModulePages:");
      } else {
        expect(stdout).not.toContain("releaseModulePages:");
      }
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    }

    // The scope is declared hidden, so without opting in the log must not
    // appear even when BUN_DEBUG_QUIET_LOGS is unset.
    await using proc = Bun.spawn({
      cmd: [out],
      env: { ...runEnv, BUN_DEBUG_QUIET_LOGS: undefined },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).not.toContain("releaseModulePages:");
    expect(stdout).toContain("before-await");
    expect(stdout).toContain("after-await");
    expect(stderr).not.toContain("releaseModulePages:");
    expect(exitCode).toBe(0);
  },
  60_000,
);

test.concurrent.skipIf(isWindows)(
  "embedded module pages are released after startup and again from the GC timer",
  async () => {
    // Enough small functions that decoding the top-level module's function
    // list touches every page of the bytecode blob, so the whole section is
    // resident when the entrypoint finishes evaluating.
    const count = 6000;
    let source = "";
    for (let i = 0; i < count; i++) {
      source += `function f${i}(a, b) { const o = { x: a, y: b, name: "fn${i}" }; return o.x + o.y + o.name.length + ${i}; }\n`;
    }
    source += `const table = [${Array.from({ length: count }, (_, i) => `f${i}`).join(",")}];\n`;
    source += `
    const rss = () => process.memoryUsage().rss;
    const evaluated = rss();
    setImmediate(async () => {
      const afterStartup = rss();
      const result = { startupDrop: evaluated - afterStartup, timerDrop: 0 };
      if (process.env.CHECK_TIMER) {
        let sum = 0;
        for (const f of table) sum += f(1, 2);
        const afterDecode = rss();
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          result.timerDrop = Math.max(result.timerDrop, afterDecode - rss());
          if (result.timerDrop >= Number(process.env.CHECK_TIMER)) break;
          await new Promise(r => setTimeout(r, 5));
        }
      }
      console.log(JSON.stringify(result));
    });
  `;
    using dir = tempDir("standalone-release-pages", { "entry.js": source });
    const out = await compile(String(dir), "entry.js", "--bytecode");
    // The embedded bytecode is several times the source; the startup release
    // drops source + bytecode and the timer release re-drops the bytecode
    // pages that calling every function faulted back in. Compare against the
    // flag-off run so heap movement between samples cancels out, and keep the
    // bar at a couple of source lengths since debug/ASAN heaps move more.
    const expected = source.length * (isASAN || isDebug ? 1.5 : 2);

    async function run(env: Record<string, string | undefined>) {
      await using proc = Bun.spawn({
        cmd: [out],
        env: { ...runEnv, BUN_GC_TIMER_INTERVAL: "10", ...env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      return JSON.parse(stdout) as { startupDrop: number; timerDrop: number };
    }

    const [released, disabled] = await Promise.all([
      run({ CHECK_TIMER: String(expected) }),
      run({ CHECK_TIMER: String(expected), BUN_FEATURE_FLAG_DISABLE_STANDALONE_MADVISE: "1" }),
    ]);
    expect(released.startupDrop - disabled.startupDrop).toBeGreaterThanOrEqual(expected);
    expect(released.timerDrop - disabled.timerDrop).toBeGreaterThanOrEqual(expected);
  },
  60_000,
);
