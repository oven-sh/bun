import { describe, expect, it } from "bun:test";
import { bunExe } from "harness";

import { spawnSync } from "bun";

describe("env var tests", () => {
  it("can redefine a var", () => {
    const { stderr } = spawnSync({
      cmd: [bunExe(), import.meta.dir + "/env-fixture.js", "new-value"],
      stdout: null,
      stdin: null,
      stderr: "pipe",
      env: {
        ...process.env,
        FOO: "1",
      },
    });
    expect(stderr).toBeDefined();
    expect(stderr.toString().trim()).toEqual("1\nnew-value")
  });
    it("can delete a var", () => {
    const { stderr } = spawnSync({
      cmd: [bunExe(), import.meta.dir + "/env-fixture.js", "delete"],
      stdout: null,
      stdin: null,
      stderr: "pipe",
      env: {
        ...process.env,
        FOO: "defined-value",
      },
    });
    expect(stderr).toBeDefined();
    expect(stderr.toString().trim()).toEqual("defined-value\nundefined")
  });
});
