import { describe, test, expect, afterEach } from "bun:test";
import type { Subprocess } from "bun";
import { spawn } from "bun";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync } from "node:fs";
import { bunExe, bunEnv } from "harness";

let watchee: Subprocess;

describe("bun --watch", () => {
  const cwd = mkdtempSync(join(tmpdir(), "bun-test-"));
  const path = join(cwd, "watchee.js");

  const updateFile = (i: number) => {
    writeFileSync(path, `console.log(${i});`);
  };

  test("should watch files", async () => {
    watchee = spawn({
      cwd,
      cmd: [bunExe(), "--watch", "watchee.js"],
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
    });
    await Bun.sleep(2000);
  });
});

afterEach(() => {
  watchee?.kill();
});
