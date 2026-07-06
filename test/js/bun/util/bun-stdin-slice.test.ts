import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";

async function runWithPipedStdin(script: string, input: string | Uint8Array) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write(input);
  await proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

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

  expect(stdout).toBe("ello world");
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

// A piped stdin cannot be seeked, so the start offset has to be consumed from
// the stream. It used to be dropped entirely, leaving `end` to act as a length.
test.concurrent("Bun.stdin.slice(start, end).text() honors start when stdin is a pipe", async () => {
  const { stdout, exitCode } = await runWithPipedStdin(
    `process.stdout.write(await Bun.stdin.slice(2, 7).text());`,
    "abcdefghij",
  );

  expect(stdout).toBe("cdefg");
  expect(exitCode).toBe(0);
});

test.concurrent("Bun.stdin.slice(start).text() honors start when stdin is a pipe", async () => {
  const { stdout, exitCode } = await runWithPipedStdin(
    `process.stdout.write(await Bun.stdin.slice(3).text());`,
    "abcdefghij",
  );

  expect(stdout).toBe("defghij");
  expect(exitCode).toBe(0);
});

test.concurrent("Bun.stdin.slice(start, end).bytes() honors start when stdin is a pipe", async () => {
  const { stdout, exitCode } = await runWithPipedStdin(
    `process.stdout.write(await Bun.stdin.slice(2, 7).bytes());`,
    "abcdefghij",
  );

  expect(stdout).toBe("cdefg");
  expect(exitCode).toBe(0);
});

test.concurrent("Bun.stdin.slice(start, end).stream() honors start when stdin is a pipe", async () => {
  const { stdout, exitCode } = await runWithPipedStdin(
    `for await (const chunk of Bun.stdin.slice(2, 7).stream()) process.stdout.write(chunk);`,
    "abcdefghij",
  );

  expect(stdout).toBe("cdefg");
  expect(exitCode).toBe(0);
});

test.concurrent("new Response(Bun.stdin.slice(start, end)) honors start when stdin is a pipe", async () => {
  const { stdout, exitCode } = await runWithPipedStdin(
    `process.stdout.write(await new Response(Bun.stdin.slice(2, 7)).text());`,
    "abcdefghij",
  );

  expect(stdout).toBe("cdefg");
  expect(exitCode).toBe(0);
});

// The offset is larger than a single read, so it has to survive across reads
// (and across poll re-arms) before any byte is kept.
test.concurrent("Bun.stdin.slice(start) skips offsets that span many reads", async () => {
  const input = Buffer.concat([Buffer.alloc(199_995, 0x61), Buffer.from("ZZZZZ")]);
  const { stdout, exitCode } = await runWithPipedStdin(
    `process.stdout.write(await Bun.stdin.slice(199995).text());`,
    input,
  );

  expect(stdout).toBe("ZZZZZ");
  expect(exitCode).toBe(0);
});

test.concurrent("Bun.stdin.slice(start) past the end of a piped stdin is empty", async () => {
  const { stdout, exitCode } = await runWithPipedStdin(
    `const text = await Bun.stdin.slice(100).text(); process.stdout.write(JSON.stringify(text));`,
    "abc",
  );

  expect(stdout).toBe(`""`);
  expect(exitCode).toBe(0);
});

// Draining the offset empties the pipe, so it has to hand control back to the
// event loop and re-arm the poll instead of reading an empty pipe. A writer that
// trickles bytes makes the reader re-arm once per byte of the offset, and then
// again on the byte that lands exactly on the boundary.
test.concurrent("Bun.stdin.slice(start, end).stream() handles a writer that trickles bytes", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `for await (const chunk of Bun.stdin.slice(5, 10).stream()) process.stdout.write(chunk);`],
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  for (const byte of "abcdefghij") {
    proc.stdin.write(byte);
    await proc.stdin.flush();
    await new Promise(resolve => setImmediate(resolve));
  }
  await proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, exitCode }).toEqual({ stdout: "fghij", exitCode: 0 });
  expect(stderr).not.toContain("error");
});

// The writer hangs up with the offset exactly consumed and nothing left over.
test.concurrent("Bun.stdin.slice(start, end).stream() handles a writer that closes at the offset", async () => {
  const { stdout, exitCode } = await runWithPipedStdin(
    `let n = 0; for await (const chunk of Bun.stdin.slice(5, 10).stream()) n += chunk.length; process.stdout.write(String(n));`,
    "abcde",
  );

  expect(stdout).toBe("0");
  expect(exitCode).toBe(0);
});

// A regular file stdin is seekable, so lseek applies the offset. Guards against
// the offset being consumed twice.
test.concurrent("Bun.stdin.slice(start, end) honors start when stdin is a regular file", async () => {
  using dir = tempDir("stdin-slice-file", { "input.txt": "abcdefghij" });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `process.stdout.write(await Bun.stdin.slice(2, 7).text());`],
    env: bunEnv,
    stdin: Bun.file(join(String(dir), "input.txt")),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, exitCode }).toEqual({ stdout: "cdefg", exitCode: 0 });
  expect(stderr).not.toContain("error");
});
