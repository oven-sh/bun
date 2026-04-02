import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("readable stream buffer does not grow unbounded under backpressure", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const stream = require('stream');
let writeCount = 0;
let sample1;

const rs = stream.Readable({
  read: function () {
    this.push(Buffer.alloc(65500));
    for (let i = 0; i < 40; i++) {
      this.push(Buffer.alloc(1024));
    }
  }
});

const ws = stream.Writable({
  write: function (data, enc, cb) {
    writeCount++;
    if (writeCount === 500) {
      sample1 = process.memoryUsage().heapUsed;
    }
    if (writeCount === 1500) {
      const growthMB = (process.memoryUsage().heapUsed - sample1) / 1024 / 1024;
      console.log(growthMB.toFixed(1));
      rs.destroy();
      ws.destroy();
      return;
    }
    setTimeout(cb, 5);
  }
});

rs.pipe(ws);
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const growthMB = parseFloat(stdout.trim());
  // Without the fix, heap grows ~3-5MB over 1000 writes with backpressure.
  // With the fix, heap growth stays under 2MB (just normal GC variance).
  expect(stderr.toLowerCase()).not.toContain("error");
  expect(growthMB).toBeLessThanOrEqual(4);
  expect(exitCode).toBe(0);
}, 30_000);
