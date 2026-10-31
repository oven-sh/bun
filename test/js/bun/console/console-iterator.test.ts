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

// The reader of the first loop releases its lock on stdin, which unrefs it. The second loop has to ref it again,
// or nothing keeps the process alive while it waits for input.
for (const how of ["await", "then"]) {
  it(`waits for the input of a second loop over the console (${how})`, async () => {
    await using proc = spawn({
      cmd: [bunExe(), import.meta.dir + "/" + "console-iterator-twice-fixture.ts", how],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    const stderr = proc.stderr.text();
    const output = proc.stdout.getReader();
    const decoder = new TextDecoder();

    proc.stdin.write("hello\nbreak\n");
    proc.stdin.flush();
    // The first loop is through once its lines are printed. Only then does the input of the second loop arrive.
    let first = "";
    while (first.length < '["hello"]'.length) {
      const { value, done } = await output.read();
      if (done) break;
      first += decoder.decode(value, { stream: true });
    }
    proc.stdin.write("another\nbreak\n");
    await proc.stdin.end();

    let second = "";
    for (;;) {
      const { value, done } = await output.read();
      if (done) break;
      second += decoder.decode(value, { stream: true });
    }
    expect({ first, second, stderr: await stderr, exitCode: await proc.exited }).toEqual({
      first: '["hello"]',
      second: '["another"]',
      stderr: "",
      exitCode: 0,
    });
  });
}

// The ref that the second loop takes is the one that the first loop dropped. A program that unref'd stdin itself keeps it unref'd.
// On Windows the pending read of such a loop keeps the process alive.
it.todoIf(isWindows)("a loop over the console does not ref a stdin that the program unref'd", async () => {
  await using proc = spawn({
    cmd: [
      bunExe(),
      "-e",
      `process.stdin.unref();
       (async () => { for await (const line of console) console.log("line", line); })();
       console.log("started");`,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  // Nothing is written to stdin, and it stays open: the process ends by itself.
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "started\n", stderr: "", exitCode: 0 });
});
