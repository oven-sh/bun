import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix } from "harness";

// Regression tests for brace expansion integer overflows:
// 1. u8 variant counter overflowed at 256 items in a single brace group
// 2. u16 out_key_counter overflowed at 65536 total cartesian product expansions

describe.if(isPosix)("brace expansion should handle large item counts", () => {
  test.concurrent("256 items in a brace group does not crash", async () => {
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

  test.concurrent("500 items in a brace group does not crash", async () => {
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

  test("cartesian product exceeding 65535 does not crash", async () => {
    // {a,b} repeated 16 times = 2^16 = 65536 expansions, which overflows u16
    // Use ${{raw:...}} to pass brace expression without shell interpolation
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        import { $ } from "bun";
        $.throws(false);
        const r = await $\`echo $\{{ raw: "{a,b}".repeat(16) }}\`;
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

    expect(stdout).toContain("count:65536");
    expect(stdout).toContain("exitCode:0");
    expect(exitCode).toBe(0);
  }, 30_000);
});
