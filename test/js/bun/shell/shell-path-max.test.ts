import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix } from "harness";

// Regression test: touch and mkdir with paths exceeding PATH_MAX (4096)
// used to panic with "index out of bounds" in resolve_path.zig.
// After the fix, they return ENAMETOOLONG error instead.

describe.if(isPosix)("builtins with paths exceeding PATH_MAX should not crash", () => {
  const longPath = Buffer.alloc(5000, "A").toString();

  test("touch with path > PATH_MAX returns error", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        import { $ } from "bun";
        $.throws(false);
        const r = await $\`touch ${longPath}\`;
        console.log("exitCode:" + r.exitCode);
      `,
      ],
      env: { ...bunEnv, longPath },
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should print exit code and not crash (exit 132=illegal instruction, 134=abort, 139=segfault)
    expect(stdout).toContain("exitCode:1");
    expect(stderr).toContain("File name too long");
    expect(exitCode).toBe(0);
  });

  test("mkdir with path > PATH_MAX returns error", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        import { $ } from "bun";
        $.throws(false);
        const r = await $\`mkdir ${longPath}\`;
        console.log("exitCode:" + r.exitCode);
      `,
      ],
      env: { ...bunEnv, longPath },
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("exitCode:1");
    expect(stderr).toContain("File name too long");
    expect(exitCode).toBe(0);
  });
});
