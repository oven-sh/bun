import { expect, mock, test } from "bun:test";
import { open, writeFile } from "fs/promises";
import { tempDir } from "harness";
import { join } from "path";
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

// Expected bytes are from node v26.3.0.
test.each([
  ["binary", ["\u00e9", "\u00ff"], "e9ff"],
  ["latin1", ["\u00e9", "\u00ff"], "e9ff"],
  ["ascii", ["\u00e9", "\u00ff"], "e9ff"],
  ["hex", ["e9", "ff"], "e9ff"],
  ["base64", ["6Q==", "/w=="], "e9ff"],
  ["utf16le", ["\u00e9", "\u00ff"], "e900ff00"],
  ["utf8", ["\u00e9", "\u00ff"], "c3a9c3bf"],
] as const)(
  "fs.promises.writeFile decodes the string chunks of an iterable as %s",
  async (encoding, chunks, expected) => {
    using dir = tempDir("fs-promises-writeFile-iterable-encoding", {});
    const fromPath = join(String(dir), "path");
    const fromHandle = join(String(dir), "handle");

    await writeFile(
      fromPath,
      (function* () {
        yield* chunks;
      })(),
      encoding,
    );
    const handle = await open(fromHandle, "w");
    try {
      await handle.writeFile(
        (async function* () {
          yield* chunks;
        })(),
        { encoding },
      );
    } finally {
      await handle.close();
    }

    expect({
      path: Buffer.from(await Bun.file(fromPath).bytes()).toString("hex"),
      handle: Buffer.from(await Bun.file(fromHandle).bytes()).toString("hex"),
    }).toEqual({ path: expected, handle: expected });
  },
);
