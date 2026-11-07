import { spawn, spawnSync } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";

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

// https://github.com/oven-sh/bun/issues/7541
async function runConsoleIterator(script: string, input: string) {
  await using proc = spawn({
    cmd: [bunExe(), "-e", script],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  proc.stdin.write(input);
  await proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

it.concurrent("continues the console iterator after reading one line with next()", async () => {
  expect(
    await runConsoleIterator(
      `const iterator = console[Symbol.asyncIterator]();
const first = await iterator.next();
const lines = [first.value];
for await (const line of console) lines.push(line);
console.write(JSON.stringify(lines));`,
      "first\nsecond",
    ),
  ).toEqual({
    stdout: '["first","second"]',
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});

it.concurrent("shares stdin between console iterators created before reading", async () => {
  expect(
    await runConsoleIterator(
      `const first = console[Symbol.asyncIterator]();
const second = console[Symbol.asyncIterator]();
const lines = [(await first.next()).value, (await second.next()).value];
for await (const line of console) lines.push(line);
console.write(JSON.stringify(lines));`,
      "first\nsecond\nthird",
    ),
  ).toEqual({
    stdout: '["first","second","third"]',
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});

describe.each([
  [
    "return()",
    `const result = await iterator.return();
if (!result.done) throw new Error("Expected return() to close the iterator");`,
  ],
  [
    "throw()",
    `const reason = undefined;
try {
  await iterator.throw(reason);
  throw new Error("Expected throw() to reject");
} catch (error) {
  if (error !== reason) throw error;
}`,
  ],
])("%s", (_operation, cleanup) => {
  it.concurrent("releases the console iterator before next()", async () => {
    expect(
      await runConsoleIterator(
        `const iterator = console[Symbol.asyncIterator]();
${cleanup}
const nextIterator = console[Symbol.asyncIterator]();
const first = await nextIterator.next();
const lines = [first.value];
for await (const line of console) lines.push(line);
console.write(JSON.stringify(lines));`,
        "first\nsecond",
      ),
    ).toEqual({
      stdout: '["first","second"]',
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  it.concurrent("releases the console iterator following next()", async () => {
    expect(
      await runConsoleIterator(
        `const iterator = console[Symbol.asyncIterator]();
const first = await iterator.next();
if (first.done || first.value !== "first") throw new Error("Expected the first line");
${cleanup}
const nextIterator = console[Symbol.asyncIterator]();
const lines = [];
for await (const line of nextIterator) lines.push(line);
console.write(JSON.stringify(lines));`,
        "first\nsecond\n",
      ),
    ).toEqual({
      stdout: '["second"]',
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });
});
