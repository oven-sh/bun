import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// When an S3 operation throws after the temporary blob store has taken
// ownership of the path, the caller's errdefer must not deref the path a
// second time. Previously this asserted in debug builds (string refcount
// underflow) and was a silent use-after-free in release builds.
//
// Run each case in a subprocess so a crash is reported as a test failure
// instead of aborting the whole test runner before any result is recorded.
describe("S3 path ownership on error", () => {
  function run(body: string) {
    const { exitCode, signalCode, stderr } = Bun.spawnSync({
      cmd: [bunExe(), "-e", body],
      env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
      stderr: "pipe",
      stdout: "ignore",
      timeout: 30_000,
    });
    const err = stderr.toString();
    if (exitCode !== 0 || signalCode) {
      throw new Error(`exit=${exitCode} signal=${signalCode}\n${err}`);
    }
    expect(err).not.toContain("panic");
  }

  test("S3Client.presign (static)", () => {
    run(`
      const path = ["some", "path", Math.random()].join("-");
      try {
        Bun.S3Client.presign(path, { expiresIn: -1, accessKeyId: "x", secretAccessKey: "y" });
        throw new Error("expected presign to throw");
      } catch (e) {
        if (!String(e.message).includes("expiresIn")) throw e;
      }
      Bun.gc(true);
    `);
  }, 60_000);

  test("S3Client#presign (instance)", () => {
    run(`
      const client = new Bun.S3Client({});
      const path = ["some", "path", Math.random()].join("-");
      try {
        client.presign(path, { expiresIn: -1, accessKeyId: "x", secretAccessKey: "y" });
        throw new Error("expected presign to throw");
      } catch (e) {
        if (!String(e.message).includes("expiresIn")) throw e;
      }
      Bun.gc(true);
    `);
  }, 60_000);

  // The constructor does fallible work (reading options.type) after initS3
  // has already taken ownership of the path. A getter that throws on its
  // second invocation triggers that error path.
  test("S3Client.presign (static) throwing options.type getter", () => {
    run(`
      const path = ["some", "path", Math.random()].join("-");
      let calls = 0;
      try {
        Bun.S3Client.presign(path, {
          get type() { if (++calls > 1) throw new Error("boom"); return undefined; },
        });
        throw new Error("expected presign to throw");
      } catch (e) {
        if (e.message !== "boom") throw e;
      }
      Bun.gc(true);
    `);
  }, 60_000);

  test("S3Client#presign (instance) throwing options.type getter", () => {
    run(`
      const client = new Bun.S3Client({});
      const path = ["some", "path", Math.random()].join("-");
      let calls = 0;
      try {
        client.presign(path, {
          get type() { if (++calls > 1) throw new Error("boom"); return undefined; },
        });
        throw new Error("expected presign to throw");
      } catch (e) {
        if (e.message !== "boom") throw e;
      }
      Bun.gc(true);
    `);
  }, 60_000);
});
