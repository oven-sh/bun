import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// Reading a sliced non-regular file blob (like stdin from a pipe) with a size
// close to Blob.max_size used to overflow when computing the initial read
// buffer capacity. The overflow was only reachable on POSIX; on Windows the
// ReadFileUV path already bailed on size > ULONG_MAX before the addition.
test.skipIf(isWindows)("Bun.stdin.slice(1).text() does not crash when stdin is a pipe", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `process.stdout.write(await Bun.stdin.slice(1).text());`],
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write("hello world");
  await proc.stdin.end();

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toBe("hello world");
  expect(exitCode).toBe(0);
});

test.skipIf(isWindows)("Bun.stdin.slice(0, N).text() caps reads at N bytes", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `process.stdout.write(await Bun.stdin.slice(0, 3).text());`],
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write("0123456789");
  await proc.stdin.end();

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toBe("012");
  expect(exitCode).toBe(0);
});

// Streaming a slice of a pipe is the POSIX path where the chunk that ends the
// slice is handed to a read that is already waiting (FileReader::on_read_chunk
// with a parked read); a regular file is read straight into the pull buffer
// instead. stdin is never closed here, so only the end of the slice can end the
// stream and let the child exit.
describe("Bun.stdin.slice(0, N).stream() over a pipe that stays open", () => {
  function spawnSliceEcho(n: number) {
    return Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `for await (const chunk of Bun.stdin.slice(0, ${n}).stream()) process.stdout.write(chunk);`,
      ],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  test.concurrent.skipIf(isWindows)("ends after N bytes of a larger write", async () => {
    await using proc = spawnSliceEcho(3);
    proc.stdin.write("0123456789");
    await proc.stdin.flush();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "012", stderr: "", exitCode: 0 });
  });

  test.concurrent.skipIf(isWindows)(
    "delivers a chunk that leaves the slice open, then ends on the one that fills it",
    async () => {
      await using proc = spawnSliceEcho(4);
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let stdout = "";

      proc.stdin.write("01");
      await proc.stdin.flush();
      // Wait for the first chunk to come back out so the second write is a separate read in the child.
      for (let r; !stdout.includes("01") && !(r = await reader.read()).done; ) {
        stdout += decoder.decode(r.value, { stream: true });
      }
      expect(stdout).toBe("01");

      proc.stdin.write("23456");
      await proc.stdin.flush();
      for (let r; !(r = await reader.read()).done; ) stdout += decoder.decode(r.value, { stream: true });

      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "0123", stderr: "", exitCode: 0 });
    },
  );
});

// The bytes after the window have to stay in the pipe for whoever reads stdin
// next. The slice is consumed by a grandchild that shares the child's stdin
// and prints the window as <chunk>...; once it has exited the child prints "|"
// followed by whatever is still in the pipe. A reader that asks the kernel for
// more than the window leaves nothing for the child. The stdin Bun.spawn hands
// out is a socketpair on POSIX and a named pipe on Windows; the window is
// enforced the same way on both, so unlike the tests above these run everywhere.
describe("Bun.stdin.slice(0, N) over a pipe that stays open leaves the bytes after the window in the pipe", () => {
  const consumers = {
    // One <...> per chunk, so an empty window prints nothing.
    "stream()": {
      script: (n: number) =>
        `for await (const chunk of Bun.stdin.slice(0, ${n}).stream()) process.stdout.write("<" + Buffer.from(chunk) + ">");`,
      emptyWindow: "",
    },
    // A native sink reading the file stream (HTMLRewriter) instead of JS pulls; prints the whole window once it has ended.
    "HTMLRewriter.transform(new Response(slice))": {
      script: (n: number) =>
        `process.stdout.write("<" + (await new HTMLRewriter().transform(new Response(Bun.stdin.slice(0, ${n}))).text()) + ">");`,
      emptyWindow: "<>",
    },
  };

  function spawnWindowThenRest(consumer: keyof typeof consumers, n: number) {
    const readWindow = consumers[consumer].script(n);
    const proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const window = Bun.spawn({ cmd: [process.execPath, "-e", ${JSON.stringify(readWindow)}], stdin: "inherit", stdout: "inherit", stderr: "inherit" });
         process.exitCode = await window.exited;
         process.stdout.write("|");
         process.stdout.write(await Bun.stdin.text());`,
      ],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let stdout = "";
    // Drained from the start so a failing child can never block on a full stderr pipe while stdout is being waited on.
    const stderr = proc.stderr.text();
    return {
      proc,
      async stdoutUntil(marker: string) {
        for (let r; !stdout.includes(marker) && !(r = await reader.read()).done; ) {
          stdout += decoder.decode(r.value, { stream: true });
        }
        return stdout;
      },
      async finish() {
        await proc.stdin.end();
        for (let r; !(r = await reader.read()).done; ) stdout += decoder.decode(r.value, { stream: true });
        return { stdout, stderr: await stderr, exitCode: await proc.exited };
      },
    };
  }

  for (const consumer of Object.keys(consumers) as (keyof typeof consumers)[]) {
    describe(consumer, () => {
      test.concurrent("a write larger than the window", async () => {
        const child = spawnWindowThenRest(consumer, 3);
        await using proc = child.proc;
        proc.stdin.write("0123456789");
        await proc.stdin.flush();
        // "|" means the window reader exited while stdin was still open.
        expect(await child.stdoutUntil("|")).toBe("<012>|");

        expect(await child.finish()).toEqual({ stdout: "<012>|3456789", stderr: "", exitCode: 0 });
      });

      test.concurrent("an empty window ends without waiting for any input", async () => {
        const { emptyWindow } = consumers[consumer];
        const child = spawnWindowThenRest(consumer, 0);
        await using proc = child.proc;
        // Nothing has been written: only the window itself can end the grandchild's stream.
        expect(await child.stdoutUntil("|")).toBe(`${emptyWindow}|`);

        proc.stdin.write("xyz");
        expect(await child.finish()).toEqual({ stdout: `${emptyWindow}|xyz`, stderr: "", exitCode: 0 });
      });
    });
  }

  test.concurrent("stream(): the write that fills the window is larger than what is left of it", async () => {
    const child = spawnWindowThenRest("stream()", 4);
    await using proc = child.proc;
    proc.stdin.write("01");
    await proc.stdin.flush();
    // Wait for the first chunk to come back out so the second write is a separate read in the grandchild.
    expect(await child.stdoutUntil("<01>")).toBe("<01>");

    proc.stdin.write("23456");
    await proc.stdin.flush();
    expect(await child.stdoutUntil("|")).toBe("<01><23>|");

    expect(await child.finish()).toEqual({ stdout: "<01><23>|456", stderr: "", exitCode: 0 });
  });
});
