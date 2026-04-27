import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("expect diff formatter does not crash when formatting the received value throws", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const received = new Proxy({ a: 1 }, {
          ownKeys() { throw new Error("boom"); },
        });
        const { expect } = Bun.jest();
        let err;
        try {
          expect(received).toStrictEqual({ b: 2 });
        } catch (e) {
          err = e;
        }
        console.log(err.message.split("\\n")[0]);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toBe("expect(received).toStrictEqual(expected)\n");
  expect(exitCode).toBe(0);
});
