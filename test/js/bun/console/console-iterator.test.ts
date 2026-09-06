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

// Bun.stdin.stream() is one stream per process. Releasing its reader (which the
// console iterator does when the loop breaks) unrefs the native stdin reader so
// an abandoned stream does not keep the process alive. The next reader on that
// stream must ref it again, or the process exits with code 0 while a read is
// still pending. No top-level await in the child: it would keep the loop alive
// and hide the bug.
describe("a later stdin consumer keeps the process alive after the reader is released", () => {
  const afterConsoleBreak = `
    (async () => {
      for await (const line of console) {
        console.log("ITER " + line);
        break;
      }
      console.log("READY");
      for await (const chunk of Bun.stdin.stream()) {
        console.log("STREAM " + new TextDecoder().decode(chunk).trim());
        break;
      }
      console.log("DONE");
    })();
  `;

  const afterReleaseLock = `
    (async () => {
      const decoder = new TextDecoder();
      const first = Bun.stdin.stream().getReader();
      console.log("FIRST " + decoder.decode((await first.read()).value).trim());
      first.releaseLock();
      console.log("READY");
      const second = Bun.stdin.stream().getReader();
      console.log("SECOND " + decoder.decode((await second.read()).value).trim());
      second.releaseLock();
      console.log("DONE");
    })();
  `;

  async function runWithPipe(script: string) {
    await using proc = spawn({
      cmd: [bunExe(), "-e", script],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let output = "";
    async function waitFor(marker: string) {
      while (!output.includes(marker)) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`stdout ended before ${JSON.stringify(marker)}; output=${JSON.stringify(output)}`);
        output += decoder.decode(value, { stream: true });
      }
    }

    proc.stdin.write("first\n");
    proc.stdin.flush();
    await waitFor("READY\n");
    proc.stdin.write("second\n");
    proc.stdin.flush();
    await waitFor("DONE\n");
    for (let { value, done } = await reader.read(); !done; { value, done } = await reader.read()) {
      output += decoder.decode(value, { stream: true });
    }
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return output;
  }

  async function runWithTerminal(script: string) {
    const decoder = new TextDecoder();
    let output = "";
    let waiting: { marker: string; resolve: () => void } | undefined;
    await using proc = spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      terminal: {
        data(_terminal, chunk) {
          output += decoder.decode(chunk, { stream: true });
          if (waiting && output.includes(waiting.marker)) waiting.resolve();
        },
      },
    });
    await using terminal = proc.terminal!;
    function waitFor(marker: string) {
      return new Promise<void>((resolve, reject) => {
        waiting = { marker, resolve };
        proc.exited.then(code =>
          reject(
            new Error(`child exited with ${code} before ${JSON.stringify(marker)}; output=${JSON.stringify(output)}`),
          ),
        );
        if (output.includes(marker)) resolve();
      });
    }
    terminal.write("first\n");
    await waitFor("READY");
    terminal.write("second\n");
    await waitFor("DONE");
    expect(await proc.exited).toBe(0);
    return output;
  }

  it("Bun.stdin.stream() after the console iterator breaks (pipe)", async () => {
    expect(await runWithPipe(afterConsoleBreak)).toBe("ITER first\nREADY\nSTREAM second\nDONE\n");
  });

  it("a second reader after releaseLock() (pipe)", async () => {
    expect(await runWithPipe(afterReleaseLock)).toBe("FIRST first\nREADY\nSECOND second\nDONE\n");
  });

  it.skipIf(isWindows)("Bun.stdin.stream() after the console iterator breaks (tty)", async () => {
    const output = await runWithTerminal(afterConsoleBreak);
    expect(output).toContain("ITER first");
    expect(output).toContain("STREAM second");
  });

  it.skipIf(isWindows)("a second reader after releaseLock() (tty)", async () => {
    const output = await runWithTerminal(afterReleaseLock);
    expect(output).toContain("FIRST first");
    expect(output).toContain("SECOND second");
  });

  // Only a ref that the release itself dropped comes back. A source the user
  // unref'd on purpose stays unref'd across a releaseLock()/getReader() cycle.
  it("a second reader does not undo an explicit unref()", async () => {
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const child = Bun.spawn({
          cmd: [${JSON.stringify(bunExe())}, "-e", "console.log('hi'); setTimeout(() => {}, 60_000)"],
          stdin: "ignore",
          stdout: "pipe",
          stderr: "ignore",
        });
        process.on("exit", () => child.kill());
        child.unref();
        const first = child.stdout.getReader();
        await first.read();
        first.releaseLock();
        const second = child.stdout.getReader();
        second.read().then(() => console.log("unexpected second read"));
        console.log("DONE");
        `,
      ],
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("DONE\n");
    expect(exitCode).toBe(0);
  });
});
