import { describe, test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("spawn with empty", () => {
  for (const [stdin, label] of [
    [new ArrayBuffer(0), "ArrayBuffer"],
    [new Uint8Array(0), "Uint8Array"],
    [new Blob([]), "Blob"],
  ] as const) {
    test(label + " for stdin", async () => {
      const proc = Bun.spawn({
        cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
        stdin,
        stdout: "pipe",
        stderr: "pipe",
        env: bunEnv,
      });

      const [exited, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      expect(exited).toBe(0);
      expect(stdout).toBeEmpty();
      expect(stderr).toBeEmpty();
    });
  }
});
