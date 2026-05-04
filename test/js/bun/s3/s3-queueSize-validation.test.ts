import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("S3Client preserves queueSize instead of forcing it to 255", () => {
  expect(Bun.inspect(new Bun.S3Client({ queueSize: 10 }))).toContain("queueSize: 10");
  expect(Bun.inspect(new Bun.S3Client({ queueSize: 1 }))).toContain("queueSize: 1");
  expect(Bun.inspect(new Bun.S3Client({ queueSize: 255 }))).toContain("queueSize: 255");
});

test("S3Client does not crash with queueSize > 255", () => {
  const { exitCode, stdout } = Bun.spawnSync({
    cmd: [
      bunExe(),
      "-e",
      `
        for (const n of [256, 1000, 2147483647]) {
          const c = new Bun.S3Client({ queueSize: n });
          if (!Bun.inspect(c).includes("queueSize: 255")) {
            throw new Error("queueSize " + n + " was not clamped to 255");
          }
        }
        console.log("ok");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(stdout.toString().trim()).toBe("ok");
  expect(exitCode).toBe(0);
});

test("S3Client throws RangeError with queueSize < 1", () => {
  expect(() => new Bun.S3Client({ queueSize: 0 })).toThrow(RangeError);
  expect(() => new Bun.S3Client({ queueSize: -1 })).toThrow(RangeError);
});
