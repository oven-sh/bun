import { expect, mock, test } from "bun:test";
import { readFileSync } from "fs";
import { writeFile } from "fs/promises";
import { tempDirWithFiles } from "harness";
import { join } from "path";
import { Readable } from "stream";
test("fs.promises.writeFile async iterator", async () => {
  const dir = tempDirWithFiles("fs-promises-writeFile-async-iterator", {
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

test("fs.promises.writeFile async iterator writes exact byte count for many small string chunks", async () => {
  const dir = tempDirWithFiles("fs-promises-writeFile-async-iterator-size", {
    "placeholder": "",
  });
  const path = join(dir, "out.bin");
  const chunk = "0123456789";
  const count = 500;

  async function* gen() {
    for (let i = 0; i < count; i++) yield chunk;
  }
  await writeFile(path, gen());

  const buf = readFileSync(path);
  expect(buf.length).toBe(chunk.length * count);
  expect(buf.toString()).toBe(Buffer.alloc(count * chunk.length, chunk).toString());
});

test("fs.promises.writeFile async iterator writes exact byte count for many small Buffer chunks", async () => {
  const dir = tempDirWithFiles("fs-promises-writeFile-async-iterator-size-buf", {
    "placeholder": "",
  });
  const path = join(dir, "out.bin");
  const chunk = Buffer.from("0123456789");
  const count = 500;

  async function* gen() {
    for (let i = 0; i < count; i++) yield chunk;
  }
  await writeFile(path, gen());

  const buf = readFileSync(path);
  expect(buf.length).toBe(chunk.length * count);
  expect(buf.equals(Buffer.alloc(chunk.length * count, chunk))).toBe(true);
});

test("fs.promises.writeFile with a node Readable stream writes exact byte count", async () => {
  const dir = tempDirWithFiles("fs-promises-writeFile-readable-size", {
    "placeholder": "",
  });
  const path = join(dir, "out.bin");
  const count = 500;
  let i = 0;
  const rs = new Readable({
    read() {
      while (i < count) {
        i++;
        if (!this.push("0123456789")) return;
      }
      this.push(null);
    },
  });
  await writeFile(path, rs);

  const buf = readFileSync(path);
  expect(buf.length).toBe(10 * count);
  expect(buf.subarray(0, 10 * count).equals(Buffer.alloc(10 * count, "0123456789"))).toBe(true);
});

test("fs.promises.writeFile async iterator with multi-byte UTF-8 chunks writes exact byte count", async () => {
  const dir = tempDirWithFiles("fs-promises-writeFile-async-iterator-utf8", {
    "placeholder": "",
  });
  const path = join(dir, "out.bin");
  // "héllo" = 6 bytes in UTF-8 (é is 2 bytes)
  const chunk = "héllo";
  const chunkBytes = Buffer.byteLength(chunk);
  expect(chunkBytes).toBe(6);
  const count = 1000;

  async function* gen() {
    for (let i = 0; i < count; i++) yield chunk;
  }
  await writeFile(path, gen());

  const buf = readFileSync(path);
  expect(buf.length).toBe(chunkBytes * count);
  expect(buf.toString("utf8")).toBe(Buffer.alloc(count * chunkBytes, chunk).toString("utf8"));
});

test("fs.promises.writeFile async iterator throws on invalid input", async () => {
  const dir = tempDirWithFiles("fs-promises-writeFile-async-iterator", {
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
  expect(() => writeFile(dir, fn)).toThrow();
  expect(fn[Symbol.asyncIterator]).not.toBeCalled();
});
