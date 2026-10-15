import { expect, mock, test } from "bun:test";
import { writeFile } from "fs/promises";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "node:path";
test("fs.promises.writeFile async iterator", async () => {
  await using dir = tempDir("fs-promises-writeFile-async-iterator", {
    "file1.txt": "0 Hello, world!",
  });
  const path = dir + "/file2.txt";

  const stream = async function* () {
    yield "1 ";
    yield "Hello, ";
    yield "world!";
  };

  await writeFile(path, stream());
  expect(await Bun.file(path).text()).toBe("1 Hello, world!");

  const bufStream = async function* () {
    yield Buffer.from("2 ");
    yield Buffer.from("Hello, ");
    yield Buffer.from("world!");
  };

  await writeFile(path, bufStream());

  expect(await Bun.file(path).text()).toBe("2 Hello, world!");
});

test("fs.promises.writeFile async iterator throws on invalid input", async () => {
  await using dir = tempDir("fs-promises-writeFile-async-iterator", {
    "file1.txt": "0 Hello, world!",
  });
  const symbolStream = async function* () {
    yield Symbol("lolwhat");
  };

  expect(() => writeFile(dir + "/file2.txt", symbolStream() as any)).toThrow();
  expect(() =>
    writeFile(
      dir + "/file3.txt",
      (async function* () {
        yield "once";
        throw new Error("good");
      })(),
    ),
  ).toThrow("good");
  const fn = {
    [Symbol.asyncIterator]: mock(() => {}),
  };
  expect(() => writeFile(String(dir), fn as any)).toThrow();
  expect(fn[Symbol.asyncIterator]).not.toBeCalled();
});

// The writer buffers a small chunk and reports it as written. With a file size limit of 0
// the write at the end of the tick fails, and the failure has to reach the promise.
test.skipIf(!isLinux)("fs.promises.writeFile async iterator rejects when a chunk cannot be written", async () => {
  using dir = tempDir("fs-promises-writeFile-efbig", {});
  const script = `
    const { writeFile } = require("node:fs/promises");
    async function* chunks() {
      yield "first\\n";
      await new Promise(resolve => setImmediate(resolve));
      yield "second\\n";
    }
    try {
      await writeFile(${JSON.stringify(join(String(dir), "out.txt"))}, chunks());
      console.log("resolved");
    } catch (e) {
      console.log(e.code);
    }
  `;
  await using proc = Bun.spawn({
    cmd: ["sh", "-c", 'ulimit -f 0 && exec "$@"', "sh", bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "EFBIG\n", stderr: "", exitCode: 0 });
});
