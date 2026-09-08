import { spawn, spawnSync } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows, shellExe, tempDir } from "harness";
import { join } from "node:path";

// A pipe reader keeps the event loop alive while it waits on the fd, and only then.

async function run(cmd: string[]) {
  await using child = spawn({ cmd, env: bunEnv, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode };
}

describe("a reader that filled its buffer and stopped polling does not keep the process alive", () => {
  // The child reads one chunk, keeps the reader locked, and never reads again while
  // the writer keeps the pipe full. The stream buffers up to its highWaterMark and
  // then stops polling the fd. Nothing can complete in that state, so it must not
  // hold the event loop open. (A reader that is still polling for more data does
  // hold it; that is not what these test.) The writer never finishes, so EOF cannot
  // end the child either: it exits only if the idle reader lets it.
  const readOneChunk = `
    const { value } = await reader.read();
    if (!(value?.byteLength > 0)) throw new Error("expected a first chunk");
    console.log("read one chunk");
    setTimeout(() => {
      console.error("the idle reader kept the process alive");
      process.exit(1);
    }, 10_000).unref();
  `;
  // Blocks writing to the full pipe and dies of EPIPE once the child is gone.
  const spawnWriter = `const proc = Bun.spawn({
    cmd: [process.execPath, "-e", 'const chunk = Buffer.alloc(65536, "x"); for (;;) require("fs").writeSync(1, chunk);'],
    stdin: "ignore", stdout: "pipe", stderr: "ignore",
  });`;

  it.concurrent("Bun.spawn() stdout, child unref'd", async () => {
    const result = await run([
      bunExe(),
      "-e",
      `${spawnWriter}
       const reader = proc.stdout.getReader();
       ${readOneChunk}
       proc.unref();`,
    ]);
    expect(result).toEqual({ stdout: "read one chunk\n", stderr: "", exitCode: 0 });
  });

  it.concurrent("Bun.spawn() stdout, child killed once the reader is idle", async () => {
    // 'beforeExit' fires only after the idle reader has let go of the loop. The kill then
    // leaves unread bytes and a hangup on a pipe that nothing polls.
    const result = await run([
      bunExe(),
      "-e",
      `${spawnWriter}
       const reader = proc.stdout.getReader();
       ${readOneChunk}
       proc.unref();
       process.once("beforeExit", async () => {
         proc.ref();
         proc.kill("SIGKILL");
         await proc.exited;
         console.log("exited with " + proc.signalCode);
       });`,
    ]);
    expect(result).toEqual({ stdout: "read one chunk\nexited with SIGKILL\n", stderr: "", exitCode: 0 });
  });

  // stdin redirected from a FIFO is a blocking pipe; Bun.spawn() stdio above is a socketpair.
  it.concurrent.skipIf(isWindows)("Bun.stdin.stream() on a pipe", async () => {
    using dir = tempDir("spawn-idle-stdin-reader", {});
    const fifo = join(String(dir), "stdin.fifo");
    expect(spawnSync({ cmd: ["mkfifo", fifo] }).exitCode).toBe(0);
    // `exec` makes each side a single process, so disposing of it leaves nothing behind.
    await using writer = spawn({
      cmd: [shellExe(), "-c", `exec cat /dev/zero > "$0"`, fifo],
      env: bunEnv,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    const result = await run([
      shellExe(),
      "-c",
      `exec "$0" -e "$1" < "$2"`,
      bunExe(),
      `const reader = Bun.stdin.stream().getReader(); ${readOneChunk}`,
      fifo,
    ]);
    expect(result).toEqual({ stdout: "read one chunk\n", stderr: "", exitCode: 0 });
    // cat dies of SIGPIPE once the child is gone.
    expect(await writer.exited).toBeGreaterThan(0);
  });
});

it.concurrent("a child_process stdout that resumes after backpressure keeps the process alive again", async () => {
  // The writer starts only once the parent is already polling the pipe ("s"). The
  // paused Readable then fills past its highWaterMark, which stops the native reader,
  // and resume() starts it again. The child is unref'd, so from then on the reading
  // pipe is the only thing that keeps the parent alive. "END" comes after a pause the
  // parent has to sit through idle on the pipe.
  const writer = `
    const fs = require("fs");
    const chunk = Buffer.alloc(65536, "x");
    const waitForParent = () => fs.readSync(0, Buffer.alloc(1), 0, 1, null);
    waitForParent();
    for (let i = 0; i < 16; i++) fs.writeSync(1, chunk);
    waitForParent();
    setTimeout(() => fs.writeSync(1, "END"), 100);
  `;
  const result = await run([
    bunExe(),
    "-e",
    `const { spawn } = require("node:child_process");
     const child = spawn(process.execPath, ["-e", ${JSON.stringify(writer)}], { stdio: ["pipe", "pipe", "inherit"] });
     child.unref();
     let received = 0;
     let paused = false;
     let drained = false;
     child.stdout.on("data", chunk => {
       received += chunk.length;
       if (!paused) {
         paused = true;
         child.stdout.pause();
         const resumeWhenFull = () => {
           if (child.stdout.readableLength >= child.stdout.readableHighWaterMark) {
             console.log("resume");
             child.stdout.resume();
           } else {
             setImmediate(resumeWhenFull);
           }
         };
         setImmediate(resumeWhenFull);
       } else if (!drained && received >= 16 * 65536) {
         drained = true;
         child.stdin.end("g");
       }
     });
     child.stdout.on("end", () => console.log("end " + received));
     setImmediate(() => child.stdin.write("s"));`,
  ]);
  expect(result).toEqual({ stdout: "resume\nend " + (16 * 65536 + 3) + "\n", stderr: "", exitCode: 0 });
});
