import { describe, expect, test } from "bun:test";
import { bunRun, isDebug, isLinux } from "harness";
import path from "path";

// Six debug builds that start at once need 0.4 to 1.8 s each. The default timeout still catches a hang.
const timeout = isDebug ? undefined : 700;

// Pass by not hanging
const fail = [
  "./shell-hang-error-fixture.js",
  "./shell-hang-success-and-error.js",
  "./shell-hang-first-works-second-fails.js",
];

// Pass by not hanging AND a 0 exit code
const pass = [
  "./shell-hang-error-or-success.js",
  "./shell-hang-fixture-success-and-success.js",
  "./shell-hang-success-fixture.js",
];

describe("fail", () => {
  test.concurrent.each(fail)(
    "%s",
    async fixture => {
      const { exitCode } = await bunRun(path.join(import.meta.dir, fixture));
      expect(exitCode).not.toBe(0);
    },
    timeout,
  );
});

describe("pass", () => {
  test.concurrent.each(pass)(
    "%s",
    async fixture => {
      const { stderr, exitCode } = await bunRun(path.join(import.meta.dir, fixture));
      if (exitCode !== 0) console.error(stderr);
      expect(exitCode).toBe(0);
    },
    timeout,
  );
});

// Signal 40 is a Linux real-time signal, which Bun's signal table has no name
// for. The command's exit code is still 128 + the signal; the shell used to
// wait for it forever.
test.skipIf(!isLinux)("a command killed by a signal with no name still completes", async () => {
  const { exitCode } = await Bun.$`sh -c 'kill -40 $$'`.nothrow().quiet();
  expect(exitCode).toBe(128 + 40);
});
