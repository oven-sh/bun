import { it, test, expect } from "bun:test";
import { spawn } from "bun";
import { bunExe } from "./bunExe";

test("spawn can read from stdout multiple chunks", async () => {
  const proc = spawn({
    cmd: [bunExe(), import.meta.dir + "/spawn-streaming-stdout-repro.js"],
    stdout: "pipe",
    env: {
      BUN_DEBUG_QUIET_LOGS: 1,
    },
  });

  var counter = 0;
  for await (var chunk of proc.stdout) {
    expect(new TextDecoder().decode(chunk)).toBe("Wrote to stdout\n");
    counter++;

    if (counter > 3) break;
  }

  expect(counter).toBe(4);
  proc.kill();
  await proc.exited;
});
