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
        stderr: Bun.file("/tmp/out.log"),
        env: {
          BUN_DEBUG_QUIET_LOGS: 1,
        },
      });
      // (async function () {
      //   for await (var chunk of proc.stderr) {
      //     console.error("[stderr]", new TextDecoder().decode(chunk));
      //   }
      // })();
      exited = proc.exited;
      var counter = 0;
      var inCounter = 0;
      const prom2 = (async function () {
        while (true) {
          await new Promise((resolve, reject) => setTimeout(resolve, 8));
          proc.stdin.write("Wrote to stdin!");
          inCounter++;

          if (inCounter === 4) break;
        }
        await new Promise((resolve) =>
          Promise.resolve(proc.stdin.end()).then(resolve),
        );
      })();

      var chunks = [];
      const prom = (async function () {
        try {
          for await (var chunk of proc.stdout) {
            chunks.push(chunk);
            counter++;

            if (counter === 4) break;
          }
        } catch (e) {
          console.log(e.stack);
          throw e;
        }
      })();
      await Promise.all([prom, prom2]);
      const code = await exited;
      console.log(code);
      expect(counter).toBe(4);
      expect(Buffer.concat(chunks).toString().trim()).toBe(
        "Wrote to stdin!\n".repeat(4).trim(),
      );
      //   proc.kill();

      gcTick(true);
    })();
  }
});
