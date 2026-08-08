import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test.concurrent("expect.toEqual does not crash when regex has overridden toString", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const re = /abc/;
      Object.defineProperty(re, "toString", { value: () => { throw new Error("nope"); } });
      let threw = false;
      try { Bun.jest().expect(re).toEqual({}); } catch (e) {
        threw = true;
        if (!e.message.includes("Expected: {}")) process.exit(1);
      }
      if (!threw) process.exit(1);
    `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect({ stderr, exitCode }).toMatchObject({ exitCode: 0 });
});

test.concurrent("expect.toEqual does not crash when regex toString returns non-primitive", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const re = /abc/;
      Object.defineProperty(re, "toString", { value: () => Array });
      let threw = false;
      try { Bun.jest().expect(re).toEqual({}); } catch (e) {
        threw = true;
        if (!e.message.includes("Expected: {}")) process.exit(1);
      }
      if (!threw) process.exit(1);
    `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect({ stderr, exitCode }).toMatchObject({ exitCode: 0 });
});
