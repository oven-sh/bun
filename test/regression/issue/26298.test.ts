import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

// Regression test for https://github.com/oven-sh/bun/issues/26298
// Windows segfault when running standalone executables with bytecode cache.
// The crash occurred because bytecode offsets were not properly aligned
// when embedded in PE sections, causing deserialization failures.
//
// A single --compile build with multiple modules is sufficient to detect the
// regression: the alignment math is independent of module count (static
// imports are inlined into one chunk), and BUN_JSC_verboseDiskCache confirms
// the embedded bytecode is actually deserialized rather than silently falling
// back to source.

describe("issue #26298: bytecode cache in standalone executables", () => {
  const ext = isWindows ? ".exe" : "";

  test("standalone executable with --bytecode runs and hits the bytecode cache", async () => {
    using dir = tempDir("bytecode-standalone", {
      "index.js": `
        import { greet } from "./greet.js";
        import { calculate } from "./math.js";
        const add = (a, b) => a + b;
        const multiply = (x, y) => x * y;
        console.log("sum:", add(2, 3));
        console.log("product:", multiply(4, 5));
        console.log(greet("World"));
        console.log("result:", calculate(10, 5));
      `,
      "greet.js": `
        export function greet(name) {
          return "Hello, " + name + "!";
        }
      `,
      "math.js": `
        export function calculate(a, b) {
          return a * b + (a - b);
        }
      `,
    });

    const outfile = join(String(dir), `app${ext}`);

    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--bytecode", join(String(dir), "index.js"), "--outfile", outfile],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [, buildStderr, buildExitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);

    expect(buildStderr).toBe("");
    expect(buildExitCode).toBe(0);

    // Run with verbose disk cache diagnostics so we can confirm the embedded
    // bytecode is actually being used (a segfault-free run alone is not proof;
    // JSC could have rejected the bytecode and reparsed from source).
    await using exe = Bun.spawn({
      cmd: [outfile],
      env: {
        ...bunEnv,
        BUN_JSC_verboseDiskCache: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [exeStdout, exeStderr, exeExitCode] = await Promise.all([exe.stdout.text(), exe.stderr.text(), exe.exited]);

    expect(exeStdout).toBe("sum: 5\nproduct: 20\nHello, World!\nresult: 55\n");
    expect(exeStderr).toMatch(/\[Disk Cache\].*Cache hit/i);
    expect(exeExitCode).toBe(0);
  });
});
