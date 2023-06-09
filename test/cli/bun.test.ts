import { describe, test, expect } from "bun:test";
import { spawnSync } from "bun";
import { bunExe } from "harness";

describe("bun", () => {
  describe("NO_COLOR", () => {
    for (const value of ["1", "0", "foo", " "]) {
      test(`respects NO_COLOR=${JSON.stringify(value)} to disable color`, () => {
        const { stdout } = spawnSync({
          cmd: [bunExe()],
          env: {
            NO_COLOR: value,
          },
        });
        expect(stdout.toString()).not.toMatch(/\u001b\[\d+m/);
      });
    }
    for (const value of ["", undefined]) {
      // TODO: need a way to fake a tty in order to test this,
      // and cannot use FORCE_COLOR since that will always override NO_COLOR.
      test.todo(`respects NO_COLOR=${JSON.stringify(value)} to enable color`, () => {
        const { stdout } = spawnSync({
          cmd: [bunExe()],
          env:
            value === undefined
              ? {}
              : {
                  NO_COLOR: value,
                },
        });
        expect(stdout.toString()).toMatch(/\u001b\[\d+m/);
      });
    }
  });
});
