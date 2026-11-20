import { write } from "bun";
import { describe, expect, test } from "bun:test";
import { closeSync, lstatSync, openSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { devNull, tmpdir } from "os";
import { join } from "path";
test("bun-file-exists", async () => {
  expect(await Bun.file(import.meta.path).exists()).toBeTrue();
  expect(await Bun.file(import.meta.path + "boop").exists()).toBeFalse();
  expect(await Bun.file(import.meta.dir).exists()).toBeFalse();
  expect(await Bun.file(import.meta.dir + "/").exists()).toBeFalse();
  const temp = join(tmpdir(), "bun-file-exists.test.js");
  try {
    unlinkSync(temp);
  } catch (e) {}
  expect(await Bun.file(temp).exists()).toBeFalse();
  await write(temp, "boop");
  expect(await Bun.file(temp).exists()).toBeTrue();
  unlinkSync(temp);
  expect(await Bun.file(temp).exists()).toBeFalse();
});

test.each([
  ["exists()", file => file.exists()],
  ["size", file => file.size],
])("one Bun.file() sees a file that is created after %s found none", async (_, look) => {
  using dir = tempDir("bun-file-exists-later", {});
  const file = Bun.file(join(String(dir), "later.txt"));
  await look(file);
  expect(await file.exists()).toBeFalse();
  writeFileSync(file.name, "boop");
  expect(await file.exists()).toBeTrue();
});

test("exists() is true for a path to the null device", async () => {
  expect(await Bun.file(devNull).exists()).toBeTrue();
});

test("exists() is true for a file descriptor of the null device", async () => {
  const fd = openSync(devNull, "r");
  try {
    expect(await Bun.file(fd).exists()).toBeTrue();
  } finally {
    closeSync(fd);
  }
});

// mkfifo and a socket on fd 0 are POSIX. The Unix socket cases are not verified on Windows.
describe.skipIf(isWindows)("exists() for a file that is not a regular file", () => {
  test("a path to a FIFO or a socket is true, a directory is false", async () => {
    using dir = tempDir("bun-file-exists-kinds", { regular: "hello" });
    const root = String(dir);
    mkfifo(join(root, "fifo"));
    using listener = Bun.listen({ unix: join(root, "socket"), socket: { data() {} } });

    expect({
      regular: await Bun.file(join(root, "regular")).exists(),
      fifo: await Bun.file(join(root, "fifo")).exists(),
      socket: await Bun.file(join(root, "socket")).exists(),
      directory: await Bun.file(root).exists(),
      missing: await Bun.file(join(root, "missing")).exists(),
    }).toEqual({
      regular: true,
      fifo: true,
      socket: true,
      directory: false,
      missing: false,
    });
  });

  // A listener unlinks the path it was given when it stops. A rename leaves the
  // socket inode behind with nothing listening on it, like a SIGKILLed process does.
  test("a stale socket that nothing listens on is true", async () => {
    using dir = tempDir("bun-file-exists-stale", {});
    const live = join(String(dir), "live.sock");
    const stale = join(String(dir), "stale.sock");
    {
      using listener = Bun.listen({ unix: live, socket: { data() {} } });
      renameSync(live, stale);
    }

    expect(lstatSync(stale).isSocket()).toBeTrue();
    expect(await Bun.file(stale).exists()).toBeTrue();
  });

  // Bun.spawn({ stdin: "pipe" }) gives the child a socket on fd 0.
  test("Bun.stdin is true when stdin is a socket from Bun.spawn", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `console.log(JSON.stringify({
          socket: require("fs").fstatSync(0).isSocket(),
          stdin: await Bun.stdin.exists(),
          fd: await Bun.file(0).exists(),
        }));`,
      ],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    proc.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: JSON.stringify({ socket: true, stdin: true, fd: true }),
      stderr: "",
      exitCode: 0,
    });
  });
});
