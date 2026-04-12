import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("Bun.inspect on object with custom inspect does not crash when node:util fails to load", async () => {
  const src = `
    const { writeSync } = require("node:fs");
    const print = (s) => writeSync(1, s + "\\n");
    Object.defineProperty(Array.prototype, "forEach", {
      get() { throw new Error("poisoned forEach"); },
    });
    const obj = { [Symbol.for("nodejs.util.inspect.custom")]() { return "custom-result"; } };
    for (const colors of [true, false, true, false]) {
      try {
        Bun.inspect(obj, { colors });
        print("ok");
      } catch (e) {
        print("caught: " + e.message);
      }
    }
    const bc = new BroadcastChannel("test");
    try {
      Bun.inspect(bc);
      print("bc ok");
    } catch (e) {
      print("bc caught: " + e.message);
    }
    bc.close();
    process.exit(0);
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("caught: poisoned forEach\nok\nok\nok\nbc ok\n");
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
});

test("Bun.inspect with colors does not crash when utilInspectFunction was previously nulled", async () => {
  const src = `
    const { writeSync } = require("node:fs");
    const print = (s) => writeSync(1, s + "\\n");
    Object.defineProperty(Array.prototype, "forEach", {
      get() { throw new Error("poisoned forEach"); },
    });
    const obj = { [Symbol.for("nodejs.util.inspect.custom")]() { return "custom-result"; } };
    try {
      Bun.inspect(obj, { colors: false });
      print("nocolors ok");
    } catch (e) {
      print("nocolors caught: " + e.message);
    }
    try {
      Bun.inspect(obj, { colors: true });
      print("colors ok");
    } catch (e) {
      print("colors caught: " + e.message);
    }
    process.exit(0);
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("nocolors caught: poisoned forEach\ncolors ok\n");
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
});
