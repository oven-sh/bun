import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// Regression test: when a bundler plugin throws a non-Error value whose string
// conversion also throws, `logger.Msg.fromJS` fails with a JS exception. Prior
// to the fix, `JSBundlerPlugin__addError` would return early without calling
// `onLoadAsync`/`onResolveAsync`, so the bundler's pending-item counter was
// never decremented and `Bun.build` would hang forever.
describe("Bun.build plugin throws value whose toString also throws", () => {
  const fixture = (hook: "onLoad" | "onResolve") => /* js */ `
    import { join } from "path";
    const result = await Bun.build({
      entrypoints: [join(import.meta.dir, "entry.ts")],
      throw: false,
      plugins: [
        {
          name: "bad-plugin",
          setup(build) {
            build.${hook}({ filter: ${hook === "onLoad" ? "/entry\\.ts$/" : "/^virtual:thing$/"} }, async () => {
              // force the rejection to go through the promise path so addError() is hit
              await Promise.resolve();
              // Not an Error instance, so Msg.fromJS falls back to toBunString(),
              // which invokes ToPrimitive -> Symbol.toPrimitive -> throws again.
              throw {
                [Symbol.toPrimitive]() {
                  throw new Error("nested throw during error conversion");
                },
                toString() {
                  throw new Error("nested throw during error conversion");
                },
              };
            });
          },
        },
      ],
    });
    console.log(JSON.stringify({
      success: result.success,
      logs: result.logs.map(l => String(l.message ?? l)),
    }));
  `;

  for (const hook of ["onLoad", "onResolve"] as const) {
    test.concurrent(`${hook}: build completes instead of hanging`, async () => {
      using dir = tempDir(`plugin-nested-throw-${hook}`, {
        "entry.ts": hook === "onLoad" ? `console.log("hi");` : `import "virtual:thing"; console.log("hi");`,
        "build.ts": fixture(hook),
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", join(String(dir), "build.ts")],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
        // If the build hangs (the bug), kill it so the assertion below can report
        // a useful diff instead of the test runner just timing out.
        timeout: 10_000,
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // If the subprocess was killed by the spawn timeout, the build hung.
      expect({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode,
        signalCode: proc.signalCode ?? null,
      }).toMatchObject({
        exitCode: 0,
        signalCode: null,
      });

      const parsed = JSON.parse(stdout.trim());
      expect(parsed.success).toBe(false);
      expect(parsed.logs.length).toBeGreaterThan(0);
    });
  }
});
