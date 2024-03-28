import { spawnSync, spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "path";
const dir = (out: string) => path.join(import.meta.dir, out);

it("should work for static input", async () => {
  const inputs = [
    "hello world",
    "hello world\n",
    "hello world\n\n",
    "hello world\n\n\n",
    "Hello\nWorld\n",
    "1",
    "💕 Red Heart ✨ Sparkles 🔥 Fire\n💕 Red Heart ✨ Sparkles\n💕 Red Heart\n💕\n\nnormal",
  ];
  async function run(input: string) {
    const { stdout, exited } = spawn({
      cmd: [bunExe(), dir("console-iterator-run.ts")],
      stdin: Buffer.from(input),
      env: bunEnv,
    });
    expect(await new Response(stdout).text()).toBe(input.replaceAll("\n", ""));
    expect(await exited).toBe(0);
  }
  await Promise.all(inputs.map(run));
});

it("should work for streaming input", async () => {
  const inputs = [
    "hello world",
    "hello world\n",
    "hello world\n\n",
    "hello world\n\n\n",
    "Hello\nWorld\n",
    "1",
    "💕 Red Heart ✨ Sparkles 🔥 Fire\n 💕 Red Heart ✨ Sparkles\n 💕 Red Heart\n 💕 \n\nnormal",
  ];
  async function run(input: string) {
    const proc = spawn({
      cmd: [bunExe(), dir("console-iterator-run.ts")],
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

    expect(await new Response(stdout).text()).toBe(input.replaceAll("\n", ""));
    proc.kill();
  }

  await Promise.all(inputs.map(run));
});

// https://github.com/oven-sh/bun/issues/5175
it("can use the console iterator more than once", async () => {
  const proc = spawn({
    cmd: [bunExe(), dir("console-iterator-run-2.ts")],
    stdin: "pipe",
    stdout: "pipe",
    env: bunEnv,
  });
  const { stdout, stdin } = proc;
  stdin.write("hello\nworld\nbreak\nanother\nbreak\n");
  await stdin.end();

  expect(await new Response(stdout).text()).toBe('["hello","world"]["another"]');
  proc.kill();
});
