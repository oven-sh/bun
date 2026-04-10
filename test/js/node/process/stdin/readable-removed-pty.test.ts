import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { join } from "node:path";

// Node's tty.ReadStream sets highWaterMark: 0 so push() returns false on
// every chunk and onStreamRead readStop()s. After the 'readable' listener is
// removed, the next chunk pushes → false → readStop, and a stdio:'inherit'
// child reads subsequent bytes from fd 0. Bun's stdin is wrapped around an
// async reader, so this exercises the equivalent disown-on-backpressure path.
test.skipIf(isWindows)("removing the last 'readable' listener releases fd 0 under a TTY", async () => {
  const script = join(import.meta.dir, "readable-removed-releases-tty.mjs");
  const pty = join(import.meta.dir, "run-with-pty-readable.py");

  await using proc = Bun.spawn({
    cmd: [Bun.which("python3") ?? Bun.which("python") ?? "python", pty, bunExe(), script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const childLines = stdout
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.startsWith("CHILD:"));

  // The parent may buffer at most one chunk (Node's backpressure semantics
  // with highWaterMark 0). The child must receive at least 4 of the 5 bytes
  // A–E. On the unfixed build, the parent buffers ≥2 bytes and the child
  // receives <4.
  expect({ stderr, childLines, exitCode }).toEqual({
    stderr: "",
    childLines: expect.arrayContaining(['CHILD:"B"', 'CHILD:"C"', 'CHILD:"D"', 'CHILD:"E"']),
    exitCode: 0,
  });
  expect(childLines.length).toBeGreaterThanOrEqual(4);
});
