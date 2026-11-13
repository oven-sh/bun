import { spawn, spawnSync } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

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

// The loop ends inside a chunk whose last line is not complete yet. The next loop has to keep that start of a line.
it("a line that is split across two chunks survives a break", async () => {
  await using proc = spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      for await (const line of console) { console.log("first:" + line); break; }
      for await (const line of console) console.log("next:" + line);
      `,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const stderr = proc.stderr.text();
  proc.stdin.write("one\ntw");
  proc.stdin.flush();
  const decoder = new TextDecoder();
  let stdout = "";
  let wroteRest = false;
  for await (const chunk of proc.stdout) {
    stdout += decoder.decode(chunk, { stream: true });
    // The first loop took "one" and ended. The chunk it stopped in ends with "tw".
    if (!wroteRest && stdout.includes("first:one\n")) {
      wroteRest = true;
      proc.stdin.write("o\nthree");
      await proc.stdin.end();
    }
  }
  expect({ stdout, stderr: await stderr, exitCode: await proc.exited }).toEqual({
    stdout: "first:one\nnext:two\nnext:three\n",
    stderr: "",
    exitCode: 0,
  });
});

// One loop per line, over a file that spans many chunks: most chunks end inside a line.
it("one line per loop over a file keeps every line", async () => {
  const lines = Array.from({ length: 2000 }, (_, i) => String(i).padStart(8, "0") + Buffer.alloc(391, "x").toString());
  using dir = tempDir("console-iterator-lines", { "lines.txt": lines.join("\n") + "\n" });
  await using proc = spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      async function readLine() {
        for await (const line of console) return line;
      }
      const hash = new Bun.CryptoHasher("sha1");
      let count = 0;
      for (let line; (line = await readLine()) !== undefined && line !== ""; count++) hash.update(line + "\\n");
      console.log(JSON.stringify({ count, sha1: hash.digest("hex") }));
      `,
    ],
    stdin: Bun.file(join(String(dir), "lines.txt")),
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout:
      JSON.stringify({
        count: lines.length,
        sha1: new Bun.CryptoHasher("sha1").update(lines.join("\n") + "\n").digest("hex"),
      }) + "\n",
    stderr: "",
    exitCode: 0,
  });
});
