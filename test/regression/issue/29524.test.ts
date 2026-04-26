// Regression for https://github.com/oven-sh/bun/issues/29524
// Atomic writes (temp-file + rename) to multiple imported files under
// `bun --hot` stopped propagating after the first eviction on macOS:
// kqueue `udata` was stale after `flushEvictions` did `swapRemove` on
// the watchlist. kqueue-specific, so skipped off macOS.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, forEachLine, isDebug, isMacOS, tempDir } from "harness";
import { renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Default bun:test timeout (5s) is not enough: we spawn a subprocess,
// wait for it to boot, then drive four hot-reload cycles. Infinity on
// debug/ASAN where hot-reload codegen is much slower.
const testTimeout = isDebug ? Infinity : 60_000;

test.skipIf(!isMacOS)(
  "atomic writes to multiple imported files keep propagating under --hot (#29524)",
  async () => {
    using dir = tempDir("issue-29524", {
      "a.js": `export function a() { return "a-0"; }\n`,
      "b.js": `export function b() { return "b-0"; }\n`,
      "c.js": `export function c() { return "c-0"; }\n`,
      "entry.js":
        `import { a } from "./a.js";\n` +
        `import { b } from "./b.js";\n` +
        `import { c } from "./c.js";\n` +
        `setInterval(() => { process.stdout.write("[tick] " + a() + " " + b() + " " + c() + "\\n"); }, 50);\n`,
    });
    const cwd = String(dir);

    await using runner = Bun.spawn({
      cmd: [bunExe(), "--hot", "run", join(cwd, "entry.js")],
      cwd,
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
      stdin: "ignore",
    });

    function atomicWrite(name: string, content: string) {
      const path = join(cwd, name);
      writeFileSync(path + ".atomic", content);
      renameSync(path + ".atomic", path);
    }

    const iter = forEachLine(runner.stdout);
    async function waitForTick(ticker: string) {
      for (;;) {
        const { value, done } = await iter.next();
        if (done) throw new Error(`stdout ended before seeing ${ticker}`);
        if (value.includes(ticker)) return;
      }
    }

    await waitForTick("[tick] a-0 b-0 c-0");
    atomicWrite("a.js", `export function a() { return "a-1"; }\n`);
    await waitForTick("[tick] a-1 b-0 c-0");
    atomicWrite("c.js", `export function c() { return "c-1"; }\n`);
    await waitForTick("[tick] a-1 b-0 c-1");
    // Write b last — on buggy macOS builds this tick never appears.
    atomicWrite("b.js", `export function b() { return "b-1"; }\n`);
    await waitForTick("[tick] a-1 b-1 c-1");
    expect(runner.exitCode).toBeNull();
  },
  testTimeout,
);
