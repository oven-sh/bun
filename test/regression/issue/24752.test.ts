import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir, isWindows } from "harness";

// Issue #24752: bun:ffi cc() should work in compiled executables
test.skipIf(isWindows)("cc() works in bun build --compile executable", async () => {
  using dir = tempDir("cc-bunfs-support-test", {
    "hello.c": `
      int hello() {
        return 42;
      }
    `,
    "hello.ts": `
      import { cc } from "bun:ffi";
      import source from "./hello.c" with { type: "file" };

      const { symbols: { hello } } = cc({
        source,
        symbols: {
          hello: {
            args: [],
            returns: "int",
          },
        },
      });

      console.log("Answer:", hello());
    `,
  });

  // First verify it works with bun run
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "hello.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(stderr).toBe("");
    expect(stdout).toContain("Answer: 42");
    expect(exitCode).toBe(0);
  }

  // Build the executable
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "hello.ts", "--outfile", "hello"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
  }

  // Run the compiled executable
  {
    await using proc = Bun.spawn({
      cmd: ["./hello"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(stderr).toBe("");
    expect(stdout).toContain("Answer: 42");
    expect(exitCode).toBe(0);
  }
});
