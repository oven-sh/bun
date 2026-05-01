import { describe, expect, test } from "bun:test";
import { mkdirSync } from "fs";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { join } from "path";

describe.concurrent("run-cjs", () => {
  test("running a commonjs module works", async () => {
    const dir = tmpdirSync();
    mkdirSync(dir, { recursive: true });
    await Bun.write(join(dir, "index1.js"), "module.exports = 1; console.log('hello world');");
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(dir, "index1.js")],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
    });
    const stdout = await proc.stdout.text();
    expect(stdout).toEqual("hello world\n");
  });
});
