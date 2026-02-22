import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix } from "harness";

// Regression test: cd with a path component exceeding NAME_MAX (255 bytes)
// triggers ENAMETOOLONG from openat(). The handleChangeCwdErr function
// had `else => return .failed` which means "JS error was thrown" but
// no error was actually thrown, causing the shell to hang indefinitely.

describe.if(isPosix)("cd with path exceeding NAME_MAX should not hang", () => {
  test("cd returns error for path component > 255 chars", async () => {
    const longComponent = Buffer.alloc(256, "A").toString();

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        import { $ } from "bun";
        $.throws(false);
        const r = await $\`cd ${longComponent}\`;
        console.log("exitCode:" + r.exitCode);
        `,
      ],
      env: { ...bunEnv, longComponent },
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("exitCode:1");
    expect(stderr).toContain("File name too long");
    expect(exitCode).toBe(0);
  });
});
