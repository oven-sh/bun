import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// `TransformTask.run()` parses with an arena allocator and frees it before
// `then()` runs on the JS thread. Error messages whose text was allocated in
// the arena used to be read after the arena was freed.
test("concurrent async transform() rejections do not read freed arena memory", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const t = new Bun.Transpiler();
        const ps = [];
        for (let i = 0; i < 200; i++) {
          ps.push(
            t.transform("const @@@ x = {{{{{ !!!! import export from }}}}}").then(
              () => { throw new Error("should have rejected"); },
              e => {
                String(e);
                for (const err of e?.errors ?? []) String(err);
                return e;
              },
            ),
          );
        }
        const results = await Promise.all(ps);
        const e = results[0];
        if (!e || e.name !== "AggregateError") throw new Error("expected AggregateError, got " + e);
        if (!Array.isArray(e.errors) || e.errors.length === 0) throw new Error("expected errors array");
        if (!String(e.errors[0]).includes("Expected identifier"))
          throw new Error("unexpected first error: " + String(e.errors[0]));
        console.log("ok", e.errors.length);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toMatch(/^ok \d+$/);
  expect(exitCode).toBe(0);
});
