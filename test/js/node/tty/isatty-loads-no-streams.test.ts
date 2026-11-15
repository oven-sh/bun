import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("require('node:tty').isatty loads neither node:stream nor node:fs; the streams come with the first stream", async () => {
  // A file, and CommonJS: under -e a require() of a built-in module at the top is answered before the first line runs.
  using dir = tempDir("isatty-loads-no-streams", {
    // What a module brings is counted by the functions that it makes: node:stream and node:fs make ten times what node:tty does.
    "main.cjs": `const { heapStats } = require("bun:jsc");
const functions = () => { const counts = heapStats().objectTypeCounts; return (counts.Function ?? 0) + (counts.FunctionExecutable ?? 0); };
const atFirst = functions();
const tty = require("node:tty");
const answer = typeof tty.isatty(1);
const behindIsatty = functions() - atFirst;
const isBase = Object.getPrototypeOf(tty.WriteStream.prototype) === require("node:fs").WriteStream.prototype
  && Object.getPrototypeOf(tty.ReadStream.prototype) === require("node:fs").ReadStream.prototype;
console.log(JSON.stringify({ answer, isBase, behindIsatty, behindTheStreams: functions() - atFirst }));
`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.cjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const said = JSON.parse(stdout);
  expect(said).toEqual({
    answer: "boolean",
    isBase: true,
    behindIsatty: expect.any(Number),
    behindTheStreams: expect.any(Number),
  });
  expect(said.behindIsatty).toBeGreaterThan(0);
  expect(said.behindIsatty * 3).toBeLessThan(said.behindTheStreams);
  expect(exitCode).toBe(0);
});
