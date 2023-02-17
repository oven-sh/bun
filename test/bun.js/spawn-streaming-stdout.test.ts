import { it, test, expect } from "bun:test";
import { spawn } from "bun";
import { bunExe } from "./bunExe";
import { gcTick } from "gc";
import { closeSync, openSync } from "fs";

test("spawn can read from stdout multiple chunks", async () => {
  gcTick(true);
  const maxFD = openSync("/dev/null", "w");
  closeSync(maxFD);

  for (let i = 0; i < 10; i++)
    await (async function () {
      var exited;
      const proc = spawn({
        cmd: [bunExe(), import.meta.dir + "/spawn-streaming-stdout-repro.js"],
        stdout: "pipe",
        stderr: "ignore",
        env: {
          BUN_DEBUG_QUIET_LOGS: 1,
        },
      });
      exited = proc.exited;
      let counter = 0;
      try {
        for await (var chunk of proc.stdout) {
          expect(new TextDecoder().decode(chunk)).toBe("Wrote to stdout\n");
          counter++;

          if (counter > 3) break;
        }
      } catch (e) {
        console.log(e.stack);
        throw e;
      }
      expect(counter).toBe(4);
      await exited;
    })();

  const newMaxFD = openSync("/dev/null", "w");
  closeSync(newMaxFD);
  expect(newMaxFD).toBe(maxFD);
});
