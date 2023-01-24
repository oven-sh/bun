import { spawn } from "bun";
import { expect, it } from "bun:test";
import { bunEnv } from "bunEnv";
import { bunExe } from "bunExe";
import { readFileSync, unlinkSync, writeFileSync } from "fs";

it("should hot reload when file is overwritten", async () => {
  const root = import.meta.dir + "/hot-runner.js";
  const runner = spawn({
    cmd: [bunExe(), "--hot", "run", root],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
  });

  var reloadCounter = 0;

  async function onReload() {
    writeFileSync(root, readFileSync(root, "utf-8"));
  }

  for await (const line of runner.stdout!) {
    var str = new TextDecoder().decode(line);

    if (str.includes("[#!root]")) {
      reloadCounter++;

      if (reloadCounter === 3) {
        runner.unref();
        runner.kill();
        break;
      }

      expect(str).toContain(`[#!root] Reloaded: ${reloadCounter}`);

      await onReload();
    }
  }

  expect(reloadCounter).toBe(3);
});

// This test fails
it.skip("should hot reload when a file is deleted and rewritten", async () => {
  const root = import.meta.dir + "/hot-runner.js";
  const runner = spawn({
    cmd: [bunExe(), "--hot", "run", root],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
  });

  var reloadCounter = 0;

  async function onReload() {
    const contents = readFileSync(root, "utf-8");
    unlinkSync(root);
    writeFileSync(root, contents);
  }

  for await (const line of runner.stdout!) {
    var str = new TextDecoder().decode(line);

    if (str.includes("[#!root]")) {
      reloadCounter++;

      if (reloadCounter === 3) {
        runner.unref();
        runner.kill();
        break;
      }

      expect(str).toContain(`[#!root] Reloaded: ${reloadCounter}`);

      await onReload();
    }
  }

  expect(reloadCounter).toBe(3);
});
