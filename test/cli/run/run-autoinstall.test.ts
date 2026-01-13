import { describe, expect, test } from "bun:test";
import { mkdirSync } from "fs";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { join } from "path";

//   --install=<val>                 Configure auto-install behavior. One of "auto" (default, auto-installs when no node_modules), "fallback" (missing packages only), "force" (always).
//   -i                              Auto-install dependencies during execution. Equivalent to --install=fallback.

describe("basic autoinstall", () => {
  for (const install of ["", "-i", "--install=auto", "--install=fallback", "--install=force"]) {
    for (const has_node_modules of [true, false]) {
      let should_install = false;
      if (has_node_modules) {
        if (install === "" || install === "--install=auto") {
          should_install = false;
        } else {
          should_install = true;
        }
      } else {
        should_install = true;
      }

      test(`${install || "<no flag>"} ${has_node_modules ? "with" : "without"} node_modules ${should_install ? "should" : "should not"} autoinstall`, async () => {
        const dir = tmpdirSync();
        mkdirSync(dir, { recursive: true });
        await Bun.write(join(dir, "index.js"), "import isEven from 'is-even'; console.log(isEven(2));");
        const env = bunEnv;
        env.BUN_INSTALL = install;
        if (has_node_modules) {
          mkdirSync(join(dir, "node_modules/abc"), { recursive: true });
        }
        const { stdout, stderr } = Bun.spawnSync({
          cmd: [bunExe(), ...(install === "" ? [] : [install]), join(dir, "index.js")],
          cwd: dir,
          env,
          stdout: "pipe",
          stderr: "pipe",
        });

        if (should_install) {
          expect(stderr?.toString("utf8")).not.toContain("error: Cannot find package 'is-even'");
          expect(stdout?.toString("utf8")).toBe("true\n");
        } else {
          expect(stderr?.toString("utf8")).toContain("error: Cannot find package 'is-even'");
        }
      });
    }
  }
});

test("--install=fallback to install missing packages", async () => {
  const dir = tmpdirSync();
  mkdirSync(dir, { recursive: true });
  await Promise.all([
    Bun.write(
      join(dir, "index.js"),
      "import isEven from 'is-even'; import isOdd from 'is-odd'; console.log(isEven(2), isOdd(2));",
    ),
    Bun.write(
      join(dir, "package.json"),
      JSON.stringify({
        name: "test",
        dependencies: {
          "is-odd": "1.0.0",
        },
      }),
    ),
  ]);

  Bun.spawnSync({
    cmd: [bunExe(), "install"],
    cwd: dir,
    env: bunEnv,
  });

  const { stdout, stderr } = Bun.spawnSync({
    cmd: [bunExe(), "--install=fallback", join(dir, "index.js")],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(stderr?.toString("utf8")).not.toContain("error: Cannot find package 'is-odd'");
  expect(stdout?.toString("utf8")).toBe("true false\n");
});

// Regression test: Auto-install should not crash with a segfault when logging errors.
// The crash occurred because the PackageManager's log used an allocator
// that could become invalid during transpilation.
describe("autoinstall should not crash on resolution errors", () => {
  test("should handle missing package gracefully without segfault", async () => {
    const dir = tmpdirSync();
    mkdirSync(dir, { recursive: true });

    // Create a project that imports a non-existent package
    await Promise.all([
      Bun.write(
        join(dir, "index.js"),
        "import nonExistentPackage from 'this-package-does-not-exist-12345'; console.log(nonExistentPackage);",
      ),
      Bun.write(
        join(dir, "package.json"),
        JSON.stringify({
          name: "test-autoinstall-crash",
          type: "module",
        }),
      ),
    ]);

    // Run without node_modules to trigger auto-install code path
    const { exitCode, stderr } = Bun.spawnSync({
      cmd: [bunExe(), join(dir, "index.js")],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderrText = stderr?.toString("utf8") ?? "";

    // Should NOT crash with segfault (exit codes 128+N indicate death by signal N)
    expect(exitCode).not.toBe(134); // SIGABRT (128 + 6)
    expect(exitCode).not.toBe(139); // SIGSEGV (128 + 11)

    // Should contain a normal error message about the missing package
    expect(stderrText).toContain("this-package-does-not-exist-12345");
  });

  test("should handle resolution during transpilation without segfault", async () => {
    const dir = tmpdirSync();
    mkdirSync(dir, { recursive: true });

    // Create a TypeScript project that triggers transpilation + resolution
    await Promise.all([
      Bun.write(
        join(dir, "index.ts"),
        `
        // TypeScript file to trigger transpilation
        const x: string = "hello";
        import pkg from 'another-nonexistent-pkg-67890';
        console.log(x, pkg);
        `,
      ),
      Bun.write(
        join(dir, "package.json"),
        JSON.stringify({
          name: "test-autoinstall-ts-crash",
          type: "module",
        }),
      ),
      Bun.write(
        join(dir, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            target: "ESNext",
            module: "ESNext",
          },
        }),
      ),
    ]);

    const { exitCode, stderr } = Bun.spawnSync({
      cmd: [bunExe(), join(dir, "index.ts")],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderrText = stderr?.toString("utf8") ?? "";

    // Should NOT crash with segfault (exit codes 128+N indicate death by signal N)
    expect(exitCode).not.toBe(134); // SIGABRT (128 + 6)
    expect(exitCode).not.toBe(139); // SIGSEGV (128 + 11)

    expect(stderrText).not.toContain("Segmentation fault");
    expect(stderrText).not.toContain("Bun has crashed");

    // Should contain a normal error message
    expect(stderrText).toContain("another-nonexistent-pkg-67890");
  });
});
