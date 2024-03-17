import { describe, expect, test } from "bun:test";
import "harness";
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
  test.each(fail)(
    "%s",
    fixture => {
      expect([path.join(import.meta.dir, fixture)]).not.toRun();
    },
    500,
  );
});

describe("pass", () => {
  test.each(pass)(
    "%s",
    fixture => {
      expect([path.join(import.meta.dir, fixture)]).toRun();
    },
    500,
  );
});
