import { describe, expect, test } from "bun:test";
import { bunRun, isOhos } from "harness";
import path from "path";

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
    700,
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
    // OHOS: the success fixtures run slower (spawn overhead); 700ms is too tight
    isOhos ? 5000 : 700,
  );
});
