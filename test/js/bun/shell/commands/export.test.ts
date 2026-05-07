import { describe, test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("export", () => {
  // The `export` builtin with no arguments must list exported variables in
  // lexicographic order. The shell inherits the process environment, so we
  // spawn a child with a small, deliberately unsorted environment to make the
  // ordering observable. Guards the sort in src/shell/builtin/export.zig.
  test("no arguments prints variables sorted lexicographically", async () => {
    const script = `
      import { $ } from "bun";
      const { stdout } = await $\`export\`.quiet();
      process.stdout.write(stdout);
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: {
        ...bunEnv,
        ZEBRA: "1",
        MANGO: "2",
        APPLE: "3",
        mango: "4",
        BANANA: "5",
        AARDVARK: "6",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");

    const lines = stdout.split("\n").filter(Boolean);
    // Every variable we set must appear exactly once.
    for (const key of ["ZEBRA", "MANGO", "APPLE", "mango", "BANANA", "AARDVARK"]) {
      expect(lines.filter(l => l.startsWith(`${key}=`))).toHaveLength(1);
    }
    // The full listing must be byte-wise sorted (uppercase letters sort before
    // lowercase in ASCII, so "ZEBRA" < "mango").
    expect(lines).toEqual([...lines].sort());
    expect(lines.indexOf("AARDVARK=6")).toBeLessThan(lines.indexOf("ZEBRA=1"));
    expect(lines.indexOf("ZEBRA=1")).toBeLessThan(lines.indexOf("mango=4"));

    expect(exitCode).toBe(0);
  });

  test("no arguments output is stable across runs", async () => {
    const script = `
      import { $ } from "bun";
      const { stdout } = await $\`export\`.quiet();
      process.stdout.write(stdout);
    `;
    const env = { ...bunEnv, ZZ: "1", AA: "2", MM: "3", BB: "4", YY: "5" };

    const run = async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(exitCode).toBe(0);
      return stdout;
    };

    const first = await run();
    const second = await run();
    expect(second).toBe(first);
    expect(first.split("\n").filter(Boolean)).toEqual([...first.split("\n").filter(Boolean)].sort());
  });
});
