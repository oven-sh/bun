// @known-failing-on-windows: 1 failing
import { it, test, expect } from "bun:test";
import { spawn } from "bun";
import { bunExe, bunEnv, gcTick } from "harness";
import { closeSync, openSync } from "fs";
import { tmpdir, devNull } from "node:os";
import { join } from "path";
import { unlinkSync } from "node:fs";

const N = 100;
test("spawn can write to stdin multiple chunks", async () => {
  const maxFD = openSync(devNull, "w");
  for (let i = 0; i < N; i++) {
    var exited;
    await (async function () {
      const tmperr = join(tmpdir(), "stdin-repro-error.log." + i);

      const proc = spawn({
        cmd: [bunExe(), import.meta.dir + "/stdin-repro.js"],
        stdout: "pipe",
        stdin: "pipe",
        stderr: Bun.file(tmperr),
        env: bunEnv,
      });
      exited = proc.exited;
      var counter = 0;
      var inCounter = 0;
      var chunks: any[] = [];
      const prom = (async function () {
        try {
          for await (var chunk of proc.stdout) {
            chunks.push(chunk);
          }
        } catch (e: any) {
          console.log(e.stack);
          throw e;
        }
      })();

      const prom2 = (async function () {
        while (true) {
          proc.stdin!.write("Wrote to stdin!\n");
          inCounter++;
          await new Promise(resolve => setTimeout(resolve, 8));

          if (inCounter === 4) break;
        }
        await proc.stdin!.end();
      })();

      await Promise.all([prom, prom2]);
      expect(Buffer.concat(chunks).toString().trim()).toBe("Wrote to stdin!\n".repeat(4).trim());
      await proc.exited;

      try {
        unlinkSync(tmperr);
      } catch (e) {}
    })();
  }

  closeSync(maxFD);
  const newMaxFD = openSync(devNull, "w");
  closeSync(newMaxFD);

  // assert we didn't leak any file descriptors
  expect(newMaxFD).toBe(maxFD);
}, 20_000);
