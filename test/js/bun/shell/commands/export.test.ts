import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// The `export` builtin sorts by key only (src/runtime/shell/builtin/export.rs
// compares `a.0.slice()`), not by the full `KEY=VALUE` line. Sorting full
// lines with JS `.sort()` diverges whenever one key is a strict prefix of
// another whose next byte is < '=' (0x3D) — e.g. `ProgramFiles` vs
// `ProgramFiles(x86)` on Windows. Use a key-only comparator to match what the
// builtin actually guarantees.
function sortedByKey(lines: readonly string[]): string[] {
  const key = (l: string) => {
    const i = l.indexOf("=");
    return i === -1 ? l : l.slice(0, i);
  };
  return [...lines].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

describe("export", () => {
  // The `export` builtin with no arguments must list exported variables in
  // lexicographic key order. The shell inherits the process environment, so we
  // spawn a child with a small, deliberately unsorted environment to make the
  // ordering observable. Guards the sort in src/runtime/shell/builtin/export.rs.
  test("no arguments prints variables sorted lexicographically by key", async () => {
    const script = `
      import { $ } from "bun";
      const { stdout } = await $\`export\`.quiet();
      process.stdout.write(stdout);
    `;

    // Note: Windows treats environment variable names case-insensitively
    // (src/runtime/shell/EnvMap.rs), so the lowercase probe must not case-fold
    // onto any of the uppercase keys.
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: {
        ...bunEnv,
        ZEBRA: "1",
        MANGO: "2",
        APPLE: "3",
        aardwolf: "4",
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
    for (const key of ["ZEBRA", "MANGO", "APPLE", "aardwolf", "BANANA", "AARDVARK"]) {
      expect(lines.filter(l => l.startsWith(`${key}=`))).toHaveLength(1);
    }
    // The full listing must be byte-wise sorted by key (uppercase letters sort
    // before lowercase in ASCII, so "ZEBRA" < "aardwolf").
    expect(lines).toEqual(sortedByKey(lines));
    expect(lines.indexOf("AARDVARK=6")).toBeLessThan(lines.indexOf("ZEBRA=1"));
    expect(lines.indexOf("ZEBRA=1")).toBeLessThan(lines.indexOf("aardwolf=4"));

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
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      return { stdout, exitCode };
    };

    const first = await run();
    const second = await run();
    expect(second.stdout).toBe(first.stdout);
    const lines = first.stdout.split("\n").filter(Boolean);
    expect(lines).toEqual(sortedByKey(lines));
    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
  });
});
