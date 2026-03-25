import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("spyOn with numeric index property does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const jest = Bun.jest();
      const obj = { 0: "value" };
      jest.spyOn(obj, "0");
      if (obj[0] !== "value") {
        process.exit(1);
      }
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  expect(exitCode).toBe(0);
});

test("spyOn with numeric index on callable property does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const jest = Bun.jest();
      const obj = { 0: () => 42 };
      jest.spyOn(obj, "0");
      if (obj[0]() !== 42) {
        process.exit(1);
      }
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  expect(exitCode).toBe(0);
});
