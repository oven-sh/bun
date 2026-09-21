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

// writeFile adds up what each write reports and truncates the file to that total. A short chunk is buffered and
// reported as written, and the large chunk after it used to report the short one's bytes again, so the total was
// too big and the file ended in NUL bytes.
test("fs.promises.writeFile async iterator writes exactly the chunks, short and long", async () => {
  await using dir = tempDir("fs-promises-writeFile-async-iterator-sizes", {});
  const path = dir + "/mixed.bin";
  const chunks = ["a", Buffer.alloc(40000, "b").toString(), "c", Buffer.alloc(10000, "é").toString()];

  await writeFile(
    path,
    (async function* () {
      yield* chunks;
    })(),
  );

  const written = await Bun.file(path).bytes();
  expect(written.length).toBe(1 + 40000 + 1 + 10000);
  expect(Buffer.from(written).equals(Buffer.from(chunks.join("")))).toBe(true);
});
