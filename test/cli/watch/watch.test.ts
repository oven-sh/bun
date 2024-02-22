import { it, expect, afterEach } from "bun:test";
import type { Subprocess } from "bun";
import { spawn } from "bun";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { bunExe, bunEnv } from "harness";

let watchee: Subprocess;

it("should watch files", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "bun-test-"));
  const path = join(cwd, "watchee.js");

  const updateFile = (i: number) => {
    writeFileSync(path, `console.log(${i});`);
  };

  let i = 0;
  updateFile(i);
  watchee = spawn({
    cwd,
    cmd: [bunExe(), "--watch", "watchee.js"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
  });

  for await (const line of watchee.stdout) {
    if (i == 10) break;
    var str = new TextDecoder().decode(line);
    expect(str).toContain(`${i}`);
    i++;
    updateFile(i);
  }
  rmSync(path);
});

afterEach(() => {
  watchee?.kill();
});
