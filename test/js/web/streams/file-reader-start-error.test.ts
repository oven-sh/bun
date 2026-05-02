// On Windows, WindowsBufferedReader.start() can return `.err` when libuv's
// Source.open() rejects the fd (e.g. uv_pipe_open failure). Before the fix,
// FileReader.onStart() had already called incrementCount() and set
// waiting_for_onReaderDone=true, but the early `return .{ .err = e }` left
// both in place. Since start() failed before any I/O was registered,
// onReaderDone never fires, so the extra ref and the fd opened by
// openFileBlob() leak permanently (GC finalize drops ref_count to 1, never 0).
//
// PosixBufferedReader.start() can never return `.err`, so the test uses a
// bun:internal-for-testing hook to force the same branch on every platform.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";

const fixture = /* js */ `
const { fileReaderInternals } = require("bun:internal-for-testing");
const { writeFileSync, readdirSync } = require("fs");
const { join } = require("path");

const tmpfile = join(process.cwd(), "payload.bin");
writeFileSync(tmpfile, "hello world");

${
  isLinux
    ? `const countOpenFds = () => readdirSync("/proc/self/fd").length;`
    : `const countOpenFds = () => 0; // fd counting not available on this platform`
}

async function once() {
  fileReaderInternals.failNextReaderStart();
  let threw = false;
  try {
    const stream = Bun.file(tmpfile).stream();
    const reader = stream.getReader();
    await reader.read();
  } catch (e) {
    threw = true;
  }
  if (!threw) throw new Error("expected stream start to fail");
}

// Warm up any lazy one-time allocations and fds.
for (let i = 0; i < 5; i++) await once();
Bun.gc(true);
await Bun.sleep(0);
Bun.gc(true);

const before = countOpenFds();

const iterations = 50;
for (let i = 0; i < iterations; i++) await once();
Bun.gc(true);
await Bun.sleep(0);
Bun.gc(true);

const after = countOpenFds();
console.log(JSON.stringify({ before, after, leaked: after - before, iterations }));
`;

test("FileReader releases its ref and fd when reader.start() fails", async () => {
  using dir = tempDir("file-reader-start-error", {
    "fixture.js": fixture,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (!/^\{.*\}$/.test(stdout.trim())) {
    // Surface what the child actually printed so the failure is actionable.
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: expect.stringMatching(/^\{.*\}$/),
      stderr: "",
      exitCode: 0,
    });
  }
  const result = JSON.parse(stdout.trim());

  if (isLinux) {
    // Without the fix each iteration leaks the fd that openFileBlob()
    // opened, so `leaked` would be ~iterations. A small amount of slack
    // tolerates unrelated background fds (e.g. epoll, procfs dir handle).
    expect(result.leaked).toBeLessThan(result.iterations / 2);
  }
  expect(exitCode).toBe(0);
});
