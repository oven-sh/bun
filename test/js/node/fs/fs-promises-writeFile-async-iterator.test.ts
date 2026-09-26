import { expect, mock, test } from "bun:test";
import { open, writeFile } from "fs/promises";
import { tempDir } from "harness";
import { readFileSync } from "node:fs";
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

// Node's writeFileHandle encodes each string chunk with `encoding || "utf8"`.
// "é" is c3 a9 in utf8 and a single e9 byte in latin1, so the bytes show which encoding ran.
test("fs.promises.writeFile async iterator writes utf8 for an empty-string encoding", async () => {
  using dir = tempDir("fs-promises-writeFile-empty-encoding", {});
  const emptyEncoding = "" as BufferEncoding;
  const chunks = async function* () {
    yield "h\u00e9";
  };
  const writeThroughHandle = async (name: string, options: BufferEncoding | { encoding: BufferEncoding }) => {
    await using handle = await open(join(String(dir), name), "w");
    await handle.writeFile(chunks(), options);
  };

  await writeFile(join(String(dir), "path-options"), chunks(), { encoding: emptyEncoding });
  await writeThroughHandle("handle-string", emptyEncoding);
  await writeThroughHandle("handle-options", { encoding: emptyEncoding });

  expect({
    pathOptions: readFileSync(join(String(dir), "path-options"), "hex"),
    handleString: readFileSync(join(String(dir), "handle-string"), "hex"),
    handleOptions: readFileSync(join(String(dir), "handle-options"), "hex"),
  }).toEqual({
    pathOptions: "68c3a9",
    handleString: "68c3a9",
    handleOptions: "68c3a9",
  });
});
