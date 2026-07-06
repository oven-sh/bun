import { spawn, spawnSync } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

describe("should work for static input", () => {
  const inputs = [
    "hello world",
    "hello world\n",
    "hello world\n\n",
    "hello world\n\n\n",
    "Hello\nWorld\n",
    "1",
    "💕 Red Heart ✨ Sparkles 🔥 Fire\n💕 Red Heart ✨ Sparkles\n💕 Red Heart\n💕\n\nnormal",
    "a\n§\nb",
  ];

  for (let input of inputs) {
    it(input.replaceAll("\n", "\\n"), () => {
      const { stdout } = spawnSync({
        cmd: [bunExe(), import.meta.dir + "/" + "console-iterator-run.ts"],
        stdin: Buffer.from(input),
        env: bunEnv,
      });
      expect(stdout.toString()).toBe(input.replaceAll("\n", ""));
    });
  }
});

describe("should work for streaming input", () => {
  const inputs = [
    "hello world",
    "hello world\n",
    "hello world\n\n",
    "hello world\n\n\n",
    "Hello\nWorld\n",
    "1",
    "💕 Red Heart ✨ Sparkles 🔥 Fire\n 💕 Red Heart ✨ Sparkles\n 💕 Red Heart\n 💕 \n\nnormal",
    "a\n§\nb",
  ];

  for (let input of inputs) {
    it(input.replaceAll("\n", "\\n"), async () => {
      const proc = spawn({
        cmd: [bunExe(), import.meta.dir + "/" + "console-iterator-run.ts"],
        stdin: "pipe",
        stdout: "pipe",
        env: bunEnv,
      });
      const { stdout, stdin } = proc;
      stdin.write(input.slice(0, (input.length / 2) | 0));
      stdin.flush();
      await new Promise(resolve => setTimeout(resolve, 1));
      stdin.write(input.slice((input.length / 2) | 0));
      await stdin.end();

      expect(await stdout.text()).toBe(input.replaceAll("\n", ""));
      proc.kill(0);
    });
  }
});

// https://github.com/oven-sh/bun/issues/5175
it("can use the console iterator more than once", async () => {
  const proc = spawn({
    cmd: [bunExe(), import.meta.dir + "/" + "console-iterator-run-2.ts"],
    stdin: "pipe",
    stdout: "pipe",
    env: bunEnv,
  });
  const { stdout, stdin } = proc;
  stdin.write("hello\nworld\nbreak\nanother\nbreak\n");
  await stdin.end();

  expect(await stdout.text()).toBe('["hello","world"]["another"]');
  proc.kill(0);
});

// The console iterator is the documented way to read lines from stdin, so it has
// to agree with node:readline (crlfDelay: Infinity) on "\n" and "\r\n" input.
describe.concurrent("splits lines like node:readline", () => {
  const collectLines = `const lines = []; for await (const line of console) lines.push(line); process.stdout.write(JSON.stringify(lines));`;

  const cases: [input: string, lines: string[]][] = [
    ["a\r\nb\r\n", ["a", "b"]],
    ["a\r\nb", ["a", "b"]],
    ["a\nb\n", ["a", "b"]],
    ["a\nb", ["a", "b"]],
    ["\n", [""]],
    ["\r\n", [""]],
    ["", []],
    ["a\n\nb\n", ["a", "", "b"]],
    ["a\r\n\r\nb", ["a", "", "b"]],
    ["a\r", ["a"]],
    ["a\r\nb\r", ["a", "b"]],
    ["💕 Red Heart\r\n✨ Sparkles\r\n", ["💕 Red Heart", "✨ Sparkles"]],
  ];

  for (const [input, lines] of cases) {
    it(JSON.stringify(input), async () => {
      await using proc = spawn({
        cmd: [bunExe(), "-e", collectLines],
        stdin: Buffer.from(input),
        stdout: "pipe",
        stderr: "pipe",
        env: bunEnv,
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout || stderr).toBe(JSON.stringify(lines));
      expect(exitCode).toBe(0);
    });
  }
});

it("treats a CRLF split across two reads as one line terminator", async () => {
  await using proc = spawn({
    cmd: [bunExe(), "-e", `for await (const line of console) console.write(line + "\\n");`],
    stdin: "pipe",
    stdout: "pipe",
    env: bunEnv,
  });

  proc.stdin.write("x\na\r");
  await proc.stdin.flush();

  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let stdout = "";
  const readUntil = async (marker: string) => {
    while (!stdout.includes(marker)) {
      const { done, value } = await reader.read();
      if (done) return;
      stdout += decoder.decode(value, { stream: true });
    }
  };

  // Only send the "\n" once the child has echoed "x", which proves it already
  // consumed the chunk ending in "\r".
  await readUntil("x\n");
  proc.stdin.write("\nb\r\n");
  await proc.stdin.end();
  await readUntil("b\n");

  expect(stdout).toBe("x\na\nb\n");
  expect(await proc.exited).toBe(0);
});

// console-iterator-run-2.ts stops at "break", then reads again, printing both runs.
async function expectRestart(input: string, output: string) {
  await using proc = spawn({
    cmd: [bunExe(), import.meta.dir + "/" + "console-iterator-run-2.ts"],
    stdin: Buffer.from(input),
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout || stderr).toBe(output);
  expect(exitCode).toBe(0);
}

// Skipped on Windows: a second iterator that resumes mid-chunk and then reads on
// to EOF hangs in readMany(), because re-acquiring the reader after the first one
// called releaseLock() never observes EOF. Predates this change.
describe.skipIf(isWindows)("resuming after break keeps the partial line", () => {
  const cases: [input: string, output: string][] = [
    ["a\nbreak\nc", '["a"]["c"]'],
    ["a\nbreak\nc\nd", '["a"]["c","d"]'],
    ["a\r\nbreak\r\nc\r\nd\r\n", '["a"]["c","d"]'],
  ];

  for (const [input, output] of cases) {
    it(JSON.stringify(input), () => expectRestart(input, output));
  }
});

// Reaching EOF consumes the last line; iterating again yields nothing.
describe.concurrent("restarting after EOF yields nothing", () => {
  const cases: [input: string, output: string][] = [
    ["a\nb", '["a","b"][]'],
    ["a\nb\n", '["a","b"][]'],
  ];

  for (const [input, output] of cases) {
    it(JSON.stringify(input), () => expectRestart(input, output));
  }
});
