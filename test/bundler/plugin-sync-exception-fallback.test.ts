import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// Regression: the C++ synchronous-exception fallback in JSBundlerPlugin__matchOnLoad /
// JSBundlerPlugin__matchOnResolve passed the wrong `which` value to JSBundlerPlugin__addError,
// so Zig would reinterpret a *Load as a *Resolve (and vice versa). matchOnLoad additionally
// passed plugin.config instead of the JSBundlerPlugin* as the plugin argument, so
// plugin.globalObject() in Zig dereferenced the wrong pointer.
//
// The builtin calls the public `.then` on its pending async-IIFE promise, so we can force a
// synchronous throw there to reach that fallback deterministically. Before the fix:
// onLoad crashes (null deref in JSGlobalObject under ASAN, SIGSEGV on release) and
// onResolve hangs (wrong completion handler leaves the resolve counter un-decremented).
describe.each(["onLoad", "onResolve"] as const)("Bun.build plugin %s builtin throws synchronously", hook => {
  test("addError receives the correct context type", async () => {
    const fixture = /* js */ `
      const originalThen = Promise.prototype.then;
      let armed = false;
      Promise.prototype.then = function (...args) {
        if (armed) {
          armed = false;
          Promise.prototype.then = originalThen;
          throw new Error("synchronous throw from ${hook} builtin");
        }
        return originalThen.apply(this, args);
      };

      const result = await Bun.build({
        entrypoints: [Bun.fileURLToPath(new URL("./entry.ts", import.meta.url))],
        throw: false,
        plugins: [
          {
            name: "sync-throw",
            setup(build) {
              build.${hook}(
                { filter: ${hook === "onLoad" ? "/entry\\.ts$/" : "/^sync-throw:thing$/"} },
                () => {
                  armed = true;
                  // Pending promise: the outer async IIFE in the builtin suspends on it,
                  // so the builtin falls through to the public .then() call which throws
                  // synchronously and surfaces to the C++ TOP_EXCEPTION_SCOPE fallback.
                  return new Promise(() => {});
                },
              );
              ${hook === "onResolve" ? 'build.onLoad({ filter: /.*/, namespace: "sync-throw" }, () => ({ contents: "", loader: "js" }));' : ""}
            },
          },
        ],
      });

      Promise.prototype.then = originalThen;
      console.log(JSON.stringify({
        success: result.success,
        logs: result.logs.map(l => String(l.message ?? l)),
      }));
    `;

    using dir = tempDir(`plugin-sync-exception-${hook}`, {
      "entry.ts": hook === "onLoad" ? `export const x = 1;` : `import "sync-throw:thing"; export const x = 1;`,
      "build.ts": fixture,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", join(String(dir), "build.ts")],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      // If the build hangs (the onResolve bug), kill it so the assertion below reports
      // a useful diff instead of the test runner timing out.
      timeout: 10_000,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Receiver includes stdout/stderr so the diff on failure shows the crash output
    // (UBSan/SIGSEGV under the old code) instead of a bare "expected 0, got 1".
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
    expect(parsed.logs.join("\n")).toContain(`synchronous throw from ${hook} builtin`);
  });
});
