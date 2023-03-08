import { ArrayBufferSink } from "bun";
import { describe, expect, it } from "bun:test";
import { mkfifo } from "mkfifo";

describe("FileSink", () => {
  const fixtures = [
    [
      ["abcdefghijklmnopqrstuvwxyz"],
      new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz"),
      "abcdefghijklmnopqrstuvwxyz",
    ],
    [
      ["abcdefghijklmnopqrstuvwxyz", "ABCDEFGHIJKLMNOPQRSTUVWXYZ"],
      new TextEncoder().encode("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"),
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
    ],
    [
      ["😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌"],
      new TextEncoder().encode("😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌"),
      "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌",
    ],
    [
      ["abcdefghijklmnopqrstuvwxyz", "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌"],
      new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz" + "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌"),
      "abcdefghijklmnopqrstuvwxyz" + "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌",
    ],
    [
      ["abcdefghijklmnopqrstuvwxyz", "😋", " Get Emoji — All Emojis", " to ✂️ Copy and 📋 Paste 👌"],
      new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz" + "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌"),
      "(rope) " + "abcdefghijklmnopqrstuvwxyz" + "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌",
    ],
    [
      [
        new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz"),
        "😋",
        " Get Emoji — All Emojis",
        " to ✂️ Copy and 📋 Paste 👌",
      ],
      new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz" + "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌"),
      "(array) " + "abcdefghijklmnopqrstuvwxyz" + "😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌",
    ],
  ] as const;

  function getPath(label) {
    const path = `/tmp/bun-test-${Bun.hash(label).toString(10)}.txt`;
    try {
      require("fs").unlinkSync(path);
    } catch (e) {}
    return path;
  }

  var activeFIFO: Promise<string>;
  var decoder = new TextDecoder();

  function getFd(label) {
    const path = `/tmp/bun-test-${Bun.hash(label).toString(10)}.txt`;
    try {
      require("fs").unlinkSync(path);
    } catch (e) {}
    mkfifo(path, 0o666);
    activeFIFO = (async function (stream: ReadableStream<Uint8Array>) {
      var chunks: Uint8Array[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks).toString();
      // test it on a small chunk size
    })(Bun.file(path).stream(64));
    return path;
  }

  for (let isPipe of [true, false] as const) {
    describe(isPipe ? "pipe" : "file", () => {
      for (const [input, expected, label] of fixtures) {
        var getPathOrFd = () => (isPipe ? getFd(label) : getPath(label));

        it(`${JSON.stringify(label)}`, async () => {
          const path = getPathOrFd();
          const sink = Bun.file(path).writer();
          for (let i = 0; i < input.length; i++) {
            sink.write(input[i]);
          }
          await sink.end();

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
          const sink = Bun.file(path).writer();
          for (let i = 0; i < input.length; i++) {
            sink.write(input[i]);
            await sink.flush();
          }
          await sink.end();
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
          const sink = Bun.file(path).writer({ highWaterMark: 1 });
          for (let i = 0; i < input.length; i++) {
            sink.write(input[i]);
            await sink.flush();
          }
          await sink.end();

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
      }
    });
  }
});
