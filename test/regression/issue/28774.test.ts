import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("readable stream buffer does not grow unbounded under backpressure", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const stream = require('stream');

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
    setTimeout(cb, 10);
  }
});

// Sample heap at two points to detect growth trend
let sample1;
let tick = 0;
const interval = setInterval(function () {
  tick++;
  if (tick === 30) {
    sample1 = process.memoryUsage().heapUsed;
  }
  if (tick === 60) {
    const sample2 = process.memoryUsage().heapUsed;
    // Report growth in MB between the two samples
    const growthMB = (sample2 - sample1) / 1024 / 1024;
    console.log(growthMB.toFixed(1));
    clearInterval(interval);
    rs.destroy();
    ws.destroy();
  }
}, 500);

rs.pipe(ws);
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const growthMB = parseFloat(stdout.trim());
  // Without the fix, heap grows ~4-5MB between tick 30 and tick 60 (15s window).
  // With the fix, heap growth stays under 2MB (just normal GC variance).
  expect(stderr).not.toContain("error");
  expect(growthMB).toBeLessThanOrEqual(3);
  expect(exitCode).toBe(0);
}, 60_000);
