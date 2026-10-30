import { expect, test } from "bun:test";
import { isASAN, isDebug, isLinux } from "harness";

function expectedBytes(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes.push(unit);
    else bytes.push(0xc0 | (unit >> 6), 0x80 | (unit & 0x3f));
  }
  return new Uint8Array(bytes);
}

test("a Latin-1 text leaves as UTF-8, whatever its length and wherever its characters stand", async () => {
  const every = String.fromCharCode(...Array.from({ length: 256 }, (_, unit) => unit));
  expect(await new Response(every).bytes()).toEqual(expectedBytes(every));
  // The runner of CI has a collection follow every expect(), and this test compares 4,992 times.
  const different: string[] = [];
  function compare(sender: string, text: string, bytes: Uint8Array, expected: Uint8Array) {
    if (bytes.toHex() !== expected.toHex())
      different.push(`${sender} of ${JSON.stringify(text)}: ${bytes.toHex()}, not ${expected.toHex()}`);
  }
  for (const unit of [0x80, 0xa0, 0xbf, 0xc0, 0xe9, 0xff]) {
    for (const before of [...Array(18).keys(), 31, 32, 33, 47, 48, 63, 64, 65]) {
      for (const after of [0, 1, 15, 16, 17, 63, 64, 65]) {
        const text =
          "a".repeat(before) + String.fromCharCode(unit) + "b".repeat(after) + String.fromCharCode(unit, unit);
        const expected = expectedBytes(text);
        compare("Response", text, await new Response(text).bytes(), expected);
        compare("Blob", text, await new Blob([text]).bytes(), expected);
        compare("TextEncoder", text, new TextEncoder().encode(text), expected);
        compare("Response.json", text, await Response.json(text).bytes(), expectedBytes(JSON.stringify(text)));
      }
    }
  }
  expect(different.slice(0, 20)).toEqual([]);
});

test.skipIf(!isLinux || process.arch !== "x64" || isDebug || isASAN)(
  "a text with accents leaves about as fast as one without",
  () => {
    const fastestOf = (send: (text: string) => unknown, text: string) => {
      let fastest = Infinity;
      for (let run = 0; run < 15; run++) {
        const began = performance.now();
        send(text);
        fastest = Math.min(fastest, performance.now() - began);
      }
      return fastest;
    };
    const plain = "voila un cafe tres serre, ".repeat(300000);
    const accented = "voil@ un caf@ tr@s serr@, ".replaceAll("@", String.fromCharCode(0xe9)).repeat(300000);
    const encoder = new TextEncoder();
    for (const send of [(text: string) => Response.json(text), (text: string) => encoder.encode(text)])
      expect(fastestOf(send, accented)).toBeLessThan(fastestOf(send, plain) * 4);
  },
);
