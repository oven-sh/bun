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
