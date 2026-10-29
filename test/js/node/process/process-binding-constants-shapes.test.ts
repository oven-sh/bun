import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("the tables of process.binding('constants') do not make a Structure for every name", async () => {
  const script = `
    const { heapStats } = require("bun:jsc");
    const count = () => heapStats().objectTypeCounts.Structure;
    count();
    // A count makes some itself.
    const first = count(), second = count();
    const { os, fs, crypto } = process.binding("constants");
    const third = count();
    const made = third - second - (second - first);
    const names = [os.errno, os.signals, fs, crypto].reduce((sum, table) => sum + Object.keys(table).length, 0);
    console.log(JSON.stringify({ names, made, ENOENT: os.errno.ENOENT, SIGINT: os.signals.SIGINT, O_RDONLY: fs.O_RDONLY, first: Object.keys(os.errno)[0] }));
  `;
  using dir = tempDir("process-binding-constants-shapes", {
    "main.js": script,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const { names, made, ...values } = JSON.parse(stdout);
  expect(values).toEqual({ ENOENT: 2, SIGINT: 2, O_RDONLY: 0, first: "E2BIG" });
  expect(names).toBeGreaterThan(150);
  expect(made).toBeLessThan(names / 4);
  expect(exitCode).toBe(0);
});
