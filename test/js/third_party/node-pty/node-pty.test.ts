import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isMusl, isWindows } from "harness";
import { createHash } from "node:crypto";
import { join } from "node:path";

// node-pty opens the pty with O_NONBLOCK and wraps its master in a
// tty.ReadStream. It reads and writes through that stream, resizes the pty
// through the fd, and expects destroy() to close it.
// The package has no binary for musl. On Windows it does not use tty.ReadStream.
describe.skipIf(isWindows || isMusl)("@lydell/node-pty", () => {
  async function run(scenario: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "node-pty.fixture.ts"), scenario],
      env: bunEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode, signalCode: proc.signalCode };
  }

  // https://github.com/oven-sh/bun/issues/25822, https://github.com/oven-sh/bun/issues/29112
  test.concurrent("a shell runs a command, takes a resize and exits", async () => {
    expect(await run("shell")).toEqual({
      stdout: JSON.stringify({ sawOutput: true, exit: { exitCode: 0, signal: 0 }, cols: 100, rows: 30 }),
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  // The second entry point of the package: what is written to one end of the pty is read at the other.
  test.concurrent("open() reads and writes both ends of a pty, and destroy() closes the master", async () => {
    expect(await run("open")).toEqual({
      stdout: JSON.stringify({
        slave: "hello\n",
        master: "hello\r\nout\r\n",
        size: [100, 30],
        closed: ["master", "slave"],
        masterIsOpen: false,
      }),
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  // The slave of open() is a tty.ReadStream too. What it writes beyond what the pty holds waits for the loop, and
  // the master reads it on the same loop.
  test.concurrent("open() writes more than the pty holds to the slave, and the master reads all of it", async () => {
    const text = Buffer.alloc(1 << 20, "abcdefghijklmnopqrstuvwxyz0123456789");
    expect(await run("flood")).toEqual({
      stdout: JSON.stringify({
        ret: false,
        written: null,
        drained: true,
        bytes: text.length,
        sha256: createHash("sha256").update(text).digest("hex"),
        closed: ["master", "slave"],
      }),
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  test.concurrent("pause() and resume() around every chunk lose none of the output", async () => {
    const expected = Buffer.from(Array.from({ length: 20000 }, (_, i) => `${i + 1}\n`).join(""));
    expect(await run("flow")).toEqual({
      stdout: JSON.stringify({
        bytes: expected.length,
        sha256: createHash("sha256").update(expected).digest("hex"),
        exit: { exitCode: 0, signal: 0 },
      }),
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });
});
