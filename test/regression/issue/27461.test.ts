import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/27461
// kRefreshLine should batch all escape sequences and content into a single
// write() call to avoid flicker and cursor jumping on Windows.
test("readline kRefreshLine batches output into a single write call", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const { Writable } = require("node:stream");
const readline = require("node:readline");

let writeCount = 0;
const chunks = [];
const output = new Writable({
  write(chunk, encoding, callback) {
    writeCount++;
    chunks.push(chunk.toString());
    callback();
  },
});
output.columns = 80;
output.rows = 24;

const input = new (require("node:stream").PassThrough)();
const rl = readline.createInterface({
  input,
  output,
  terminal: true,
  prompt: "> ",
});

rl.prompt();

// Reset write count after the initial prompt
writeCount = 0;
chunks.length = 0;

// Set up some line content and trigger a refresh
rl.line = "hello world";
rl.cursor = 5;
rl._refreshLine();

// With the fix, all escape sequences and content should be batched
// into a single write() call instead of 4-7 separate calls.
if (writeCount !== 1) {
  console.log("FAIL: expected 1 write call, got " + writeCount);
  console.log("chunks: " + JSON.stringify(chunks));
  process.exit(1);
}

// Verify the single write contains both escape sequences and content
const written = chunks[0];
if (!written.includes("> hello world")) {
  console.log("FAIL: output missing prompt + line content");
  process.exit(1);
}
if (!written.includes("\\x1b[")) {
  console.log("FAIL: output missing escape sequences");
  process.exit(1);
}

console.log("OK");
rl.close();
process.exit(0);
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("OK");
  expect(stderr).not.toContain("FAIL");
  expect(exitCode).toBe(0);
});
