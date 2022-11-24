import { it, test, expect } from "bun:test";
import { spawn } from "bun";
import { bunExe } from "./bunExe";
import { gcTick } from "gc";

const N = 100;
test("spawn can write to stdin multiple chunks", async () => {
  for (let i = 0; i < N; i++) {
    var exited;
    await (async function () {
      const proc = spawn({
        cmd: [bunExe(), import.meta.dir + "/stdin-repro.js"],
        stdout: "pipe",
        stdin: "pipe",
        stderr: "inherit",
        env: {
          BUN_DEBUG_QUIET_LOGS: 1,
        },
      });
      exited = proc.exited;
      var counter = 0;
      var inCounter = 0;
      const prom2 = (async function () {
        while (inCounter++ < 4) {
          await new Promise((resolve, reject) => setTimeout(resolve, 8));
          proc.stdin.write("Wrote to stdin!");
          await proc.stdin.flush();
        }
        await proc.stdin.end();
      })();

      const prom = (async function () {
        try {
          for await (var chunk of proc.stdout) {
            expect(new TextDecoder().decode(chunk)).toBe("Wrote to stdin!\n");
            counter++;

            if (counter > 3) break;
          }
        } catch (e) {
          console.log(e.stack);
          throw e;
        }
      })();
      await Promise.all([prom, prom2]);
      expect(counter).toBe(4);
      //   proc.kill();
    })();
    await exited;
  }

  gcTick(true);
});
