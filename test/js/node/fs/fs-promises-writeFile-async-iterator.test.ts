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

// The file is truncated to the sum of the byte counts the chunks reported, so a count that is too
// high leaves NUL bytes at the end.
test("fs.promises.writeFile async iterator with a short chunk before a long one", async () => {
  await using dir = tempDir("fs-promises-writeFile-async-iterator", {});
  const path = dir + "/file.txt";
  const long = Buffer.alloc(50000, "x").toString();

  await writeFile(
    path,
    (async function* () {
      yield "ab";
      yield long;
    })(),
  );

  const bytes = await Bun.file(path).bytes();
  expect(bytes.length).toBe(50002);
  expect(Buffer.from("ab" + long).equals(bytes)).toBe(true);
});

test("fs.promises.writeFile async iterator throws on invalid input", async () => {
  await using dir = tempDir("fs-promises-writeFile-async-iterator", {
    "file1.txt": "0 Hello, world!",
  });
  const symbolStream = async function* () {
    yield Symbol("lolwhat");
  };

  expect(() => writeFile(dir + "/file2.txt", symbolStream())).toThrow();
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
  expect(() => writeFile(String(dir), fn)).toThrow();
  expect(fn[Symbol.asyncIterator]).not.toBeCalled();
});
