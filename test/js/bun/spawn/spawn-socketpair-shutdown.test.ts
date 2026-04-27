import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Regression test: Bun used to call shutdown(SHUT_WR) on the parent's read end
// of a SOCK_STREAM socketpair used for subprocess stdout. This sent a FIN to
// the child's write end, causing programs that poll stdout for readability
// (like Python's asyncio connect_write_pipe) to interpret it as "peer closed"
// and tear down their write transport.
//
// This broke all Python MCP servers using the model_context_protocol SDK
// whenever they took more than a few seconds to initialize.

test("subprocess stdout pipe stays writable after idle delay", async () => {
  // Spawn a child that delays before writing to stdout.
  // The child uses poll() on stdout to detect if the read end was shutdown.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
            // Wait 2 seconds, then write to stdout
            await Bun.sleep(2000);
            process.stdout.write("hello after delay\\n");
            `,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(stdout).toBe("hello after delay\n");
  expect(exitCode).toBe(0);
});

// Skip on Windows: Python's asyncio connect_write_pipe uses
// CreateIoCompletionPort internally, which doesn't work with
// subprocess pipe handles on Windows (OSError: [WinError 6]).
test.skipIf(isWindows)("subprocess stdout pipe works with Python asyncio connect_write_pipe", async () => {
  // This is the exact scenario from the bug report: Python's asyncio
  // connect_write_pipe registers stdout with epoll for read-readiness
  // monitoring. If shutdown(SHUT_WR) was called on the parent's end,
  // the child sees an immediate EPOLLIN event and interprets it as
  // "connection closed".
  const pythonScript = `
import sys, asyncio, os

async def main():
    loop = asyncio.get_event_loop()
    w_transport, w_protocol = await loop.connect_write_pipe(
        asyncio.streams.FlowControlMixin, sys.stdout
    )
    writer = asyncio.StreamWriter(w_transport, w_protocol, None, loop)

    # Idle period - this is where the bug would manifest
    await asyncio.sleep(2)

    writer.write(b"hello from asyncio\\n")
    await writer.drain()
    writer.close()

asyncio.run(main())
`;

  await using proc = Bun.spawn({
    cmd: ["python3", "-c", pythonScript],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    console.error("stderr:", stderr);
  }

  expect(stdout).toBe("hello from asyncio\n");
  expect(exitCode).toBe(0);
});

test("subprocess stdin pipe stays readable for child after idle delay", async () => {
  // Also verify stdin works correctly after idle delay
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
            // Wait, then read from stdin
            await Bun.sleep(2000);
            const reader = Bun.stdin.stream().getReader();
            const { value } = await reader.read();
            process.stdout.write(new TextDecoder().decode(value));
            `,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  // Write to stdin after child is waiting
  proc.stdin.write("hello via stdin\n");
  proc.stdin.flush();
  proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(stdout).toBe("hello via stdin\n");
  expect(exitCode).toBe(0);
});

test("subprocess stdin pipe stays readable while consuming a streamed local fetch", async () => {
  using dir = tempDir("stdin-fetch-stream", {
    "tiny.txt": "X",
  });

  const fileURL = pathToFileURL(join(String(dir), "tiny.txt")).href;

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const fileURL = ${JSON.stringify(fileURL)};
        const decoder = new TextDecoder();
        const stdinReader = Bun.stdin.stream().getReader();
        const firstRead = stdinReader.read();

        const response = await fetch(fileURL);
        const fileReader = response.body?.getReader();
        if (!fileReader) {
          process.exit(2);
        }

        while (true) {
          const { done } = await fileReader.read();
          if (done) break;
        }

        console.log("FETCH_DONE");

        const first = await firstRead;
        const firstValue = first.value ? decoder.decode(first.value) : null;
        console.log("FIRST:" + JSON.stringify({ done: first.done, value: firstValue }));

        const second = await stdinReader.read();
        const secondValue = second.value ? decoder.decode(second.value) : null;
        console.log("SECOND:" + JSON.stringify({ done: second.done, value: secondValue }));

        process.exit(!first.done && firstValue === "ONE" && !second.done && secondValue === "TWO" ? 0 : 1);
      `,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const stdoutReader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let output = "";
  let sentFirst = false;
  let sentSecond = false;

  while (true) {
    const { done, value } = await stdoutReader.read();
    if (done) break;

    output += decoder.decode(value, { stream: true });

    if (!sentFirst && output.includes("FETCH_DONE\n")) {
      sentFirst = true;
      proc.stdin.write("ONE");
    }

    if (!sentSecond && output.includes("FIRST:")) {
      sentSecond = true;
      proc.stdin.write("TWO");
      proc.stdin.end();
    }
  }

  output += decoder.decode();

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  const filteredStderr = stderr
    .split(/\r?\n/)
    .filter(line => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith("WARNING: ASAN interferes");
    })
    .join("\n");

  expect(output).toContain('FIRST:{"done":false,"value":"ONE"}');
  expect(output).toContain('SECOND:{"done":false,"value":"TWO"}');
  expect(filteredStderr).toBe("");
  expect(exitCode).toBe(0);
});
