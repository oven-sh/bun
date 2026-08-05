import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test.concurrent.each(["received", "expected"])(
  "expect diff formatter does not crash when formatting the %s value throws",
  async side => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const throwing = new Proxy({ a: 1 }, {
            ownKeys() { throw new Error("boom"); },
          });
          const { expect } = Bun.jest();
          let err;
          try {
            if (${JSON.stringify(side)} === "received") {
              expect(throwing).toStrictEqual({ b: 2 });
            } else {
              expect({ b: 2 }).toStrictEqual(throwing);
            }
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
  },
);
