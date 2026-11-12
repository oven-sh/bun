import { spawn, spawnSync } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, canBuildNodeAddons } from "harness";
import { join } from "path";

const napiAppDir = join(__dirname, "napi-app");
const addonName = "test_ref_finalizer_drain";
const addonPath = join(napiAppDir, `build/Debug/${addonName}.node`);

// The same build steps as napi-finalizer-delete-ref.test.ts: only this file's target, and only when it is missing.
beforeAll(() => {
  if (!canBuildNodeAddons()) return;
  if (existsSync(addonPath)) return;
  const run = (cmd: string[]) =>
    spawnSync({ cmd, cwd: napiAppDir, env: bunEnv, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  if (!existsSync(join(napiAppDir, "node_modules/node-gyp"))) {
    run([bunExe(), "install", "--ignore-scripts", "--verbose"]);
  }
  run([bunExe(), "--bun", "node-gyp", "configure", "build", "--debug", "-j", "max", addonName]);
  if (existsSync(addonPath)) return;
  // Fallback: the install script, which builds every target. Retried once.
  for (let attempt = 0; ; attempt++) {
    if (run([bunExe(), "install", "--verbose"]).success && existsSync(addonPath)) return;
    if (attempt >= 1) throw new Error("building napi-app addons failed");
  }
}, 300_000);

// A module built against a released Node-API version gets the finalizer of a wrapped object called from the event
// loop, after the collection that freed the object. The addon's wrap(count, throwsEvery) wraps `count` objects that
// nothing keeps alive, each with the reference that napi_wrap() returns (the shape of an ObjectWrap).
describe.concurrent.skipIf(!canBuildNodeAddons())("finalizers of wrapped objects, called from the event loop", () => {
  async function run(script: string) {
    await using proc = spawn({
      cmd: [bunExe(), "-e", `const addon = require(${JSON.stringify(addonPath)});\n${script}`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test("a timer fires while each finalizer wraps an object that the next collection frees", async () => {
    const result = await run(`
      // No timer can end a chain that starves the timers, so each finalizer counts and reads the clock: a starved
      // fixture fails after 100 links and 3 s, and does not hang.
      const giveUpAt = Date.now() + 3000;
      let links = 0;
      function wrapOneAndCollect() {
        (function () { addon.wrap(1, 0); })();
        Bun.gc(true);
      }
      // The addon calls this from each finalizer.
      globalThis.onFinalize = () => {
        if (++links >= 100 && Date.now() > giveUpAt) {
          console.log("starved");
          process.exit(1);
        }
        wrapOneAndCollect();
      };
      // From an immediate: the chain and the timer start in the same turn of the loop, after the start-up turns.
      setImmediate(() => {
        wrapOneAndCollect();
        setTimeout(() => { console.log("timer"); process.exit(0); }, 1);
      });
    `);
    expect(result).toEqual({ stdout: "timer\n", stderr: "", exitCode: 0 });
  });

  test("the finalizers that one collection leaves pending all run before the next immediate", async () => {
    const result = await run(`
      (function () { addon.wrap(1000, 0); })();
      Bun.gc(true);
      setImmediate(() => {
        const atFirstImmediate = addon.finalized();
        let turns = 0;
        (function later() {
          if (++turns < 20) return setImmediate(later);
          console.log(JSON.stringify({ mostRanAtOnce: atFirstImmediate > 900, ranLater: addon.finalized() - atFirstImmediate }));
        })();
      });
    `);
    expect(result).toEqual({
      stdout: JSON.stringify({ mostRanAtOnce: true, ranLater: 0 }) + "\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("each finalizer that throws is reported, and the finalizers after it run", async () => {
    const result = await run(`
      let reported = 0;
      process.on("uncaughtException", error => {
        if (error.message === "thrown by a finalizer") reported++;
      });
      // Every third finalizer throws.
      (function () { addon.wrap(30, 3); })();
      Bun.gc(true);
      setImmediate(() => {
        const finalized = addon.finalized();
        const thrown = addon.thrown();
        console.log(JSON.stringify({ mostRan: finalized > 20, severalThrew: thrown > 5, notReported: thrown - reported }));
      });
    `);
    expect(result).toEqual({
      stdout: JSON.stringify({ mostRan: true, severalThrew: true, notReported: 0 }) + "\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
