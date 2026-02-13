import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix } from "harness";

// Regression test: brace expansion with 256+ items used a u8 counter for
// variant counting, which overflowed and caused a segfault on release builds
// or integer overflow panic on debug builds.

describe.if(isPosix)("brace expansion should handle large item counts", () => {
  test("256 items in a brace group does not crash", async () => {
    // Generate {x0,x1,x2,...,x255} - 256 items overflows u8
    const items = Array.from({ length: 256 }, (_, i) => `x${i}`).join(",");
    const cmd = `echo {${items}}`;

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        import { $ } from "bun";
        $.throws(false);
        const r = await $\`${cmd}\`;
        const words = r.stdout.toString().trim().split(" ");
        console.log("count:" + words.length);
        console.log("first:" + words[0]);
        console.log("last:" + words[words.length - 1]);
        console.log("exitCode:" + r.exitCode);
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("count:256");
    expect(stdout).toContain("first:x0");
    expect(stdout).toContain("last:x255");
    expect(stdout).toContain("exitCode:0");
    expect(exitCode).toBe(0);
  });

  test("500 items in a brace group does not crash", async () => {
    const items = Array.from({ length: 500 }, (_, i) => `y${i}`).join(",");
    const cmd = `echo {${items}}`;

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        import { $ } from "bun";
        $.throws(false);
        const r = await $\`${cmd}\`;
        const words = r.stdout.toString().trim().split(" ");
        console.log("count:" + words.length);
        console.log("exitCode:" + r.exitCode);
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("count:500");
    expect(stdout).toContain("exitCode:0");
    expect(exitCode).toBe(0);
  });
});
