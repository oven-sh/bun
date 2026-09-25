import { write } from "bun";
import { describe, expect, test } from "bun:test";
import { closeSync, constants, openSync, unlinkSync } from "fs";
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

test("exists() is true for a path to the null device", async () => {
  expect(await Bun.file(devNull).exists()).toBeTrue();
});

test("exists() on a file descriptor is true for a regular file, false for the null device", async () => {
  const regular = openSync(import.meta.path, "r");
  const nullDevice = openSync(devNull, "r");
  try {
    expect({
      regular: await Bun.file(regular).exists(),
      nullDevice: await Bun.file(nullDevice).exists(),
    }).toEqual({ regular: true, nullDevice: false });
  } finally {
    closeSync(regular);
    closeSync(nullDevice);
  }
});

describe.skipIf(isWindows)("exists() on a file that is not a regular file", () => {
  test("a path is true for a FIFO and a socket, false for a directory", async () => {
    using dir = tempDir("bun-file-exists", { "regular": "hello" });
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

  test("a file descriptor for a FIFO is true", async () => {
    using dir = tempDir("bun-file-exists-fifo", {});
    const path = join(String(dir), "fifo");
    mkfifo(path);
    const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      expect(await Bun.file(fd).exists()).toBeTrue();
    } finally {
      closeSync(fd);
    }
  });

  // Programs read stdin only if Bun.stdin.exists() is true. With stdin from /dev/null there is nothing to read.
  test("Bun.stdin from /dev/null stays false", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `console.log(JSON.stringify({
          characterDevice: require("fs").fstatSync(0).isCharacterDevice(),
          stdin: await Bun.stdin.exists(),
          fd: await Bun.file(0).exists(),
        }));`,
      ],
      env: bunEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(JSON.parse(stdout)).toEqual({ characterDevice: true, stdin: false, fd: false });
    expect(exitCode).toBe(0);
  });
});
