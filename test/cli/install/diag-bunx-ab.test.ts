// Diagnostic, not for merging: the real bunx test, with and without the harness change, by number of other variables.
import { expect, test } from "bun:test";
import { bunExe, isWindows } from "harness";
import { join } from "node:path";

test.skipIf(!isWindows)(
  "bunx.test.ts by number of other variables",
  async () => {
    const run = async (extra: number, fix: boolean) => {
      const env: Record<string, string | undefined> = { ...process.env, DIAG_FIX: fix ? "1" : "0" };
      for (let i = 0; i < extra; i++) env["A_DIAG_" + i] = "1";
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "./cli/install/bunx.test.ts", "-t", "is none of its bins"],
        env,
        cwd: join(import.meta.dir, "..", ".."),
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      const passed = /^\s*(\d+) pass/m.exec(stderr)?.[1];
      return exitCode === 0 && passed === "2" ? "P" : exitCode === 1 ? "F" : "?";
    };
    const lines: string[] = [];
    for (const fix of [false, true]) {
      let row = "";
      for (let from = 0; from < 16; from += 4) {
        row += (await Promise.all([0, 1, 2, 3].map(i => run(from + i, fix)))).join("");
      }
      lines.push(`${fix ? "with   " : "without"} the harness change, 0..15 more variables: ${row}`);
    }
    expect(lines.join("\n")).toBe("");
  },
  600_000,
);
