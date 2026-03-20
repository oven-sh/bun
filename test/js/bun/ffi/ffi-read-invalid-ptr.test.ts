import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe.concurrent("FFI read rejects invalid pointers", () => {
  const types = ["u8", "u16", "u32", "i8", "i16", "i32", "i64", "u64", "f32", "f64", "ptr", "intptr"] as const;

  for (const type of types) {
    test(`read.${type} throws on null page address`, async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", `Bun.FFI.read.${type}(7)`],
        env: bunEnv,
        stderr: "pipe",
      });

      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).toContain("Pointer is invalid");
      expect(exitCode).not.toBe(0);
    });

    test(`read.${type} throws on address 0`, async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", `Bun.FFI.read.${type}(0)`],
        env: bunEnv,
        stderr: "pipe",
      });

      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).toContain("Pointer is invalid");
      expect(exitCode).not.toBe(0);
    });

    test(`read.${type} throws on oversized address`, async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", `Bun.FFI.read.${type}(Number.MAX_VALUE)`],
        env: bunEnv,
        stderr: "pipe",
      });

      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).toContain("Pointer is invalid");
      expect(exitCode).not.toBe(0);
    });

    test(`read.${type} throws on i32.min offset`, async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", `Bun.FFI.read.${type}(4096, -2147483648)`],
        env: bunEnv,
        stderr: "pipe",
      });

      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).toContain("Pointer is invalid");
      expect(exitCode).not.toBe(0);
    });
  }
});
