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

  await (async function () {
    for await (const line of runner.stdout!) {
      var str = new TextDecoder().decode(line);

      if (str.includes("[#!root]")) {
        reloadCounter++;

        if (reloadCounter === 3) {
          runner.unref();
          runner.kill();
          return;
        }

        expect(str).toContain(`[#!root] Reloaded: ${reloadCounter}`);

        await onReload();
      }
    }
  })();

  expect(reloadCounter).toBe(3);
});
