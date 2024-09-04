import { describe, expect, it } from "bun:test";
import { fileDescriptorLeakChecker, isWindows, tmpdirSync } from "harness";
import { mkfifo } from "mkfifo";
import { join } from "node:path";

describe("FileSink", () => {
  const fixturesInput = [
    [["abcdefghijklmnopqrstuvwxyz"], "abcdefghijklmnopqrstuvwxyz"],
    [
      ["abcdefghijklmnopqrstuvwxyz", "ABCDEFGHIJKLMNOPQRSTUVWXYZ"],
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
    ],
    [["😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌"], "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌"],
    [
      ["abcdefghijklmnopqrstuvwxyz", "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌"],
      "abcdefghijklmnopqrstuvwxyz" + "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌",
    ],
    [
      ["abcdefghijklmnopqrstuvwxyz", "😋", " Get Emoji — All Emojis", " to ✂️ Copy and 📋 Paste 👌"],
      "(rope) " + "abcdefghijklmnopqrstuvwxyz" + "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌",
    ],
    [
      [
        new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz"),
        "😋",
        " Get Emoji — All Emojis",
        " to ✂️ Copy and 📋 Paste 👌",
      ],
      "(array) " + "abcdefghijklmnopqrstuvwxyz" + "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌",
    ],
  ] as const;

  const fixtures = fixturesInput.map(([input, label]) => {
    let expected;

    if (Array.isArray(input)) {
      expected = Buffer.concat(input.map(str => Buffer.from(str)));
    } else {
      expected = Buffer.from(input as any);
    }

    return [input, expected, label] as const;
  });

  function getPath(label: string) {
    const path = join(tmpdirSync(), `${Bun.hash(label).toString(10)}.txt`);
    try {
      require("fs").unlinkSync(path);
    } catch (e) {}
    return path;
  }

  var activeFIFO: Promise<string>;
  var decoder = new TextDecoder();

  function getFd(label: string, byteLength = 0) {
    const path = join(tmpdirSync(), `${Bun.hash(label).toString(10)}.txt`);
    try {
      require("fs").unlinkSync(path);
    } catch (e) {}
    mkfifo(path, 0o666);
    activeFIFO = (async function (stream: ReadableStream<Uint8Array>, byteLength = 0) {
      var chunks: Uint8Array[] = [];
      const original = byteLength;
      var got = 0;
      for await (const chunk of stream) {
        chunks.push(chunk);
        got += chunk.byteLength;
      }
      if (got !== original) throw new Error(`Expected ${original} bytes, got ${got} (${label})`);
      return Buffer.concat(chunks).toString();
      // test it on a small chunk size
    })(Bun.file(path).stream(64), byteLength);
    return path;
  }

  for (let isPipe of [true, false] as const) {
    // TODO: fix the `mkfifo` function for windows. They do have an API but calling it from bun:ffi didn't get great results.
    // once #8166 is merged, this can be written using it's 'bun:iternals-for-testing' feature
    describe.skipIf(isPipe && isWindows)(isPipe ? "pipe" : "file", () => {
      fixtures.forEach(([input, expected, label]) => {
        const getPathOrFd = () => (isPipe ? getFd(label, expected.byteLength) : getPath(label));

        it(`${JSON.stringify(label)}`, async () => {
          const path = getPathOrFd();
          {
            using _ = fileDescriptorLeakChecker();

            const sink = Bun.file(path).writer();
            for (let i = 0; i < input.length; i++) {
              sink.write(input[i]);
            }
            await sink.end();

            // For the file descriptor leak checker.
            await Bun.sleep(10);
          }

          if (!isPipe) {
            const output = new Uint8Array(await Bun.file(path).arrayBuffer());
            for (let i = 0; i < expected.length; i++) {
              expect(output[i]).toBe(expected[i]);
            }
            expect(output.byteLength).toBe(expected.byteLength);
          } else {
            console.log("reading");
            const output = await activeFIFO;
            expect(output).toBe(decoder.decode(expected));
          }
        });

        it(`flushing -> ${JSON.stringify(label)}`, async () => {
          const path = getPathOrFd();

          {
            using _ = fileDescriptorLeakChecker();
            const sink = Bun.file(path).writer();
            for (let i = 0; i < input.length; i++) {
              sink.write(input[i]);
              await sink.flush();
            }
            await sink.end();

            // For the file descriptor leak checker.
            await Bun.sleep(10);
          }

          if (!isPipe) {
            const output = new Uint8Array(await Bun.file(path).arrayBuffer());
            for (let i = 0; i < expected.length; i++) {
              expect(output[i]).toBe(expected[i]);
            }
            expect(output.byteLength).toBe(expected.byteLength);
          } else {
            const output = await activeFIFO;
            expect(output).toBe(decoder.decode(expected));
          }
        });

        it(`highWaterMark -> ${JSON.stringify(label)}`, async () => {
          const path = getPathOrFd();
          {
            using _ = fileDescriptorLeakChecker();
            const sink = Bun.file(path).writer({ highWaterMark: 1 });
            for (let i = 0; i < input.length; i++) {
              sink.write(input[i]);
              await sink.flush();
            }
            await sink.end();
            await Bun.sleep(10); // For the file descriptor leak checker.
          }

          if (!isPipe) {
            const output = new Uint8Array(await Bun.file(path).arrayBuffer());
            for (let i = 0; i < expected.length; i++) {
              expect(output[i]).toBe(expected[i]);
            }
            expect(output.byteLength).toBe(expected.byteLength);
          } else {
            const output = await activeFIFO;
            expect(output).toBe(decoder.decode(expected));
          }
        });
      });
    });
  }
});

import fs from "node:fs";
import path from "node:path";
import util from "node:util";

it("end doesn't close when backed by a file descriptor", async () => {
  using _ = fileDescriptorLeakChecker();
  const x = tmpdirSync();
  const fd = await util.promisify(fs.open)(path.join(x, "test.txt"), "w");
  const chunk = Buffer.from("1 Hello, world!");
  const file = Bun.file(fd);
  const writer = file.writer();
  const written = await writer.write(chunk);
  await writer.end();
  await util.promisify(fs.ftruncate)(fd, written);
  await util.promisify(fs.close)(fd);
});

it("end does close when not backed by a file descriptor", async () => {
  using _ = fileDescriptorLeakChecker();
  const x = tmpdirSync();
  const file = Bun.file(path.join(x, "test.txt"));
  const writer = file.writer();
  await writer.write(Buffer.from("1 Hello, world!"));
  await writer.end();
  await Bun.sleep(10); // For the file descriptor leak checker.
});

it("write result is not cummulative", async () => {
  using _ = fileDescriptorLeakChecker();
  const x = tmpdirSync();
  const fd = await util.promisify(fs.open)(path.join(x, "test.txt"), "w");
  const file = Bun.file(fd);
  const writer = file.writer();
  expect(await writer.write("1 ")).toBe(2);
  expect(await writer.write("Hello, ")).toBe(7);
  expect(await writer.write("world!")).toBe(6);
  await writer.end();
  await util.promisify(fs.close)(fd);
});

if (isWindows) {
  it("ENOENT, Windows", () => {
    expect(() => Bun.file("A:\\this-does-not-exist.txt").writer()).toThrow(
      expect.objectContaining({
        code: "ENOENT",
        path: "A:\\this-does-not-exist.txt",
        syscall: "open",
      }),
    );
  });
}
