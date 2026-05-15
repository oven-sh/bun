import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe.concurrent("FinalizationRegistry", () => {
  const driver = (setup: string) => `
    let caught = null;
    process.on("uncaughtException", (err) => {
      caught = err;
    });
    ${setup}
    (function () {
      let obj = {};
      reg.register(obj, "held");
      obj = null;
    })();
    for (let i = 0; i < 100 && !caught; i++) {
      Bun.gc(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (!caught) throw new Error("finalizer did not run");
    console.log("CAUGHT:" + caught.message);
    console.log("DONE");
  `;

  test("throwing callback reports as uncaughtException instead of crashing", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", driver(`const reg = new FinalizationRegistry(() => { throw new Error("boom from finalizer"); });`)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).toBe("");
    expect(out).toContain("CAUGHT:boom from finalizer");
    expect(out).toContain("DONE");
    expect(code).toBe(0);
  });

  test("callback that is a constructor requiring new reports as uncaughtException", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", driver(`const reg = new FinalizationRegistry(ArrayBuffer);`)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).toBe("");
    expect(out).toContain("CAUGHT:");
    expect(out).toContain("DONE");
    expect(code).toBe(0);
  });

  test("unhandled throwing callback exits with non-zero code", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const reg = new FinalizationRegistry(() => { throw new Error("boom from finalizer"); });
          (function () {
            let obj = {};
            reg.register(obj, "held");
            obj = null;
          })();
          for (let i = 0; i < 100; i++) {
            Bun.gc(true);
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).toContain("boom from finalizer");
    expect(code).toBe(1);
  });
});
