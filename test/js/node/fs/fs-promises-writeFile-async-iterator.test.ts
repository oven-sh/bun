import { expect, mock, test } from "bun:test";
import { writeFile } from "fs/promises";
import { tempDir } from "harness";
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

// Node's getOptions() returns the defaults for a function in the `options` slot:
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/fs/promises.js#L1882-L1883
test("fs.promises.writeFile with iterable data takes a function in the options slot as the defaults", async () => {
  await using dir = tempDir("fs-promises-writeFile-async-iterator", {
    "file.txt": "old",
  });
  const path = dir + "/file.txt";
  // Each property changes the outcome if it is read.
  const options = Object.assign(() => {}, { encoding: "hex", flag: "a", signal: AbortSignal.abort() });
  await writeFile(path, ["68", "69"], options as any);
  expect(await Bun.file(path).text()).toBe("6869");
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
