import { it, test, expect } from "bun:test";
import { spawn } from "bun";
import { bunExe } from "./bunExe";
import { gcTick } from "gc";

test("spawn can read from stdout multiple chunks", async () => {
  gcTick(true);
  var exited;
  await (async function () {
    const proc = spawn({
      cmd: [bunExe(), import.meta.dir + "/spawn-streaming-stdout-repro.js"],
      stdout: "pipe",
      env: {
        BUN_DEBUG_QUIET_LOGS: 1,
      },
    });
    exited = proc.exited;
    gcTick(true);
    var counter = 0;
    for await (var chunk of proc.stdout) {
      gcTick(true);
      expect(new TextDecoder().decode(chunk)).toBe("Wrote to stdout\n");
      counter++;

      if (counter > 3) break;
    }
    gcTick(true);

    expect(counter).toBe(4);
    gcTick();
    proc.kill();
    gcTick();
  })();
  await exited;
  gcTick(true);
});
