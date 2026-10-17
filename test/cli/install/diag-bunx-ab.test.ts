// Diagnostic, not for merging: the real bunx test, which spelling of PATH is the later one in the env it passes on, and
// whether it passes, by what else is in the environment of `bun test`.
import { expect, test } from "bun:test";
import { bunExe, isWindows } from "harness";
import { join } from "node:path";

test.skipIf(!isWindows)(
  "bunx.test.ts by what else is in the environment",
  async () => {
    const run = async (extra: string[], fix: boolean) => {
      const env: Record<string, string | undefined> = { ...process.env, DIAG_FIX: fix ? "1" : "0" };
      for (const name of extra) env[name] = "x";
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "./cli/install/bunx.test.ts", "-t", "is none of its bins"],
        env,
        cwd: join(import.meta.dir, "..", ".."),
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      const order = /^DIAG_ORDER=([1Lf])\r?$/m.exec(stderr)?.[1] ?? "?";
      const named = stderr.includes("does not provide a binary named caller");
      return order + (exitCode === 0 ? " passes" : named ? " fails: no binary named caller" : " fails otherwise");
    };
    const variants: string[][] = [[]];
    for (let c = 65; c <= 90; c++) {
      const names = [1, 2, 3].map(i => String.fromCharCode(c) + "_DIAG_" + i);
      variants.push(names.slice(0, 1), names.slice(0, 2), names);
    }
    const tally = async (list: string[][], fix: boolean) => {
      const counts = new Map<string, number>();
      const failing: string[][] = [];
      for (let from = 0; from < list.length; from += 6) {
        const part = list.slice(from, from + 6);
        (await Promise.all(part.map(extra => run(extra, fix)))).forEach((result, i) => {
          counts.set(result, (counts.get(result) ?? 0) + 1);
          if (!result.endsWith("passes")) failing.push(part[i]);
        });
      }
      return { counts: JSON.stringify([...counts].sort()), failing };
    };
    const without = await tally(variants, false);
    const lines = [`without the harness change, ${variants.length} environments: ${without.counts}`];
    lines.push(`those that fail: ${without.failing.map(extra => extra.at(-1) ?? "none").join(" ")}`);
    lines.push(
      `the same ${without.failing.length} with the harness change: ${(await tally(without.failing, true)).counts}`,
    );
    lines.push(`all ${variants.length} with the harness change: ${(await tally(variants, true)).counts}`);
    expect(lines.join("\n")).toBe("");
  },
  900_000,
);
