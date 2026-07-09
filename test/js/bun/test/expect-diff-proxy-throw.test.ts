import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("expect diff does not crash when prototype has trap throws", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const handler = { has() { throw new Error("trap threw"); } };
      const received = { a: 1 };
      Object.setPrototypeOf(received, new Proxy(Object.prototype, handler));
      const { expect } = Bun.jest("x");
      let msg = "";
      try { expect(received).toEqual({}); } catch (e) { msg = e.message; }
      if (!msg.includes("toEqual")) throw new Error("wrong error: " + msg);
      try { expect(received).toStrictEqual({}); } catch (e) { msg = e.message; }
      if (!msg.includes("toStrictEqual")) throw new Error("wrong error: " + msg);
      console.log("ok");
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: "ok",
    stderr: "",
    exitCode: 0,
  });
});
