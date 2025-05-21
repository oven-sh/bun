import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

test("#9222", async () => {
  const proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "bun-serve-9222-fixture.ts")],
    stdout: "pipe",
    stderr: "inherit",
    stdin: "inherit",
    env: bunEnv,
  });
  try {
    const { promise, resolve } = Promise.withResolvers<string>();
    (async function () {
      for await (const chunk of proc.stdout) {
        const line = Buffer.from(chunk).toString();
        if (line.startsWith("http://")) {
          resolve(line);
        }
      }
    })();
    const url = await promise;

    for (let i = 0; i < 2; i++) {
      const response = await fetch(url, {
        method: "POST",
        body: JSON.stringify({ a: 1 }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ a: 1 });
    }
  } finally {
    const signalCode = proc.signalCode;
    proc.kill();
    expect(signalCode).toBeNull();
  }
});
