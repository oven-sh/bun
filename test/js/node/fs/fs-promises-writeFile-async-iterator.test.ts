import { expect, mock, test } from "bun:test";
import { writeFileSync } from "fs";
import { readFile, stat, writeFile } from "fs/promises";
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

  await expect(() => writeFile(dir + "/file2.txt", symbolStream() as any)).toThrow();
  await expect(() =>
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
  await expect(() => writeFile(String(dir), fn as any)).toThrow();
  expect(fn[Symbol.asyncIterator]).not.toBeCalled();
});

// Issue #47817: a chunk that flushed the bytes buffered before it was counted
// twice, and the file was resized to that sum, so it ended in zero bytes.
test.concurrent("fs.promises.writeFile with an iterable of chunks writes exactly the chunks", async () => {
  await using dir = tempDir("fs-promises-writeFile-async-iterator", {});
  const path = dir + "/out.bin";
  writeFileSync(path, Buffer.alloc(100_000, 7));

  const chunks = [new Uint8Array(100).fill(1), new Uint8Array(40_000).fill(2)];
  await writeFile(path, chunks);

  const bytes = await readFile(path);
  expect((await stat(path)).size).toBe(40_100);
  expect(bytes.equals(Buffer.concat(chunks))).toBe(true);
});

test.concurrent("fs.promises.writeFile keeps the chunks written before the iterable throws", async () => {
  await using dir = tempDir("fs-promises-writeFile-async-iterator", {});
  const path = dir + "/partial.bin";
  writeFileSync(path, Buffer.alloc(100_000, 7));

  const stop = new Error("stop");
  await expect(
    writeFile(
      path,
      (async function* () {
        yield Buffer.alloc(10, 1);
        throw stop;
      })(),
    ),
  ).rejects.toBe(stop);

  expect(await readFile(path)).toEqual(Buffer.alloc(10, 1));
});

test.concurrent("fs.promises.writeFile keeps the chunks written before an abort", async () => {
  await using dir = tempDir("fs-promises-writeFile-async-iterator", {});
  const path = dir + "/aborted.bin";
  writeFileSync(path, Buffer.alloc(100_000, 7));
  const ac = new AbortController();

  await expect(
    writeFile(
      path,
      (async function* () {
        yield Buffer.alloc(10, 1);
        ac.abort();
        yield Buffer.alloc(10, 2);
      })(),
      { signal: ac.signal },
    ),
  ).rejects.toMatchObject({ name: "AbortError", code: "ABORT_ERR" });

  expect(await readFile(path)).toEqual(Buffer.alloc(10, 1));
});
