import { stringsInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";

// `bun.strings.convertUTF16ToUTF8Append` (and `toUTF8ListWithType` on top of
// it) hands the destination's spare capacity to simdutf, which writes the
// converted text without being told how much room there is. It used to leave
// the sizing to its callers: appending to a fresh, empty vector wrote through
// the vector's dangling pointer and appending to one with too little spare
// room wrote past its allocation. It now reserves what the conversion needs
// itself, so this drives it from every interesting starting point: no spare
// room at all, one byte short, exactly enough, and more than the three bytes
// per code unit worst case (where it skips the length scan). Without the
// sizing, the fresh-vector cases crash inside simdutf on the dangling pointer
// and the others trip the debug assertion that commits simdutf's byte count
// into the vector.
//
// `reallocated` pins the sizing: the vector must grow exactly when the encoded
// text does not fit in the spare capacity it started with.

const { convertUTF16ToUTF8Append } = stringsInternals;

function units(text: string): Uint16Array {
  const out = new Uint16Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

// Unpaired surrogates are replaced with U+FFFD, which is also what
// `Buffer.from(text)` does, so it provides the expected bytes.
const inputs: Record<string, string> = {
  "empty": "",
  "ascii": "hello, world",
  "two-byte": "héllo wörld",
  "three-byte": "日本語のテキスト",
  "surrogate pairs": "😀👍🏽🎉",
  "lone lead surrogate": "\uD800",
  "lone trail surrogate": "\uDC00",
  "lone surrogates between text": "a\uD800b\uDC00c😀é",
  "lone lead surrogate at the end": "abc\uD83D",
  // simdutf's vector loops need about 28 code units of lookahead, so short
  // inputs only reach its scalar tail. The 1 and 2 byte mix is the case where
  // those loops store whole vectors and rely on that lookahead to stay inside
  // an exactly sized buffer.
  "long 1 and 2 byte mix": "aé".repeat(50),
  "long three-byte": "日".repeat(64),
  "long surrogate pairs": "😀".repeat(40),
  "long with a lone lead surrogate at the end": "aé".repeat(50) + "\uD800",
  "long with a lone trail surrogate in the middle": "é".repeat(40) + "\uDC00" + "a".repeat(40),
};

const prefixes: Record<string, Uint8Array> = {
  "fresh vector": new Uint8Array(0),
  "after existing bytes": new Uint8Array(Buffer.from("prefix:")),
};

describe.each([
  ["convertUTF16ToUTF8Append", false],
  ["toUTF8ListWithType", true],
])("%s", (_entryPoint, fallible) => {
  describe.each(Object.entries(prefixes))("%s", (_state, prefix) => {
    test.each(Object.entries(inputs))("%s", (_label, text) => {
      const input = units(text);
      const encoded = new Uint8Array(Buffer.from(text, "utf8"));
      const worstCase = input.length * 3;
      const spares = [...new Set([0, encoded.length - 1, encoded.length, encoded.length + 1, worstCase, worstCase + 5])]
        .filter(spare => spare >= 0)
        .sort((a, b) => a - b);
      const expectedBytes = Buffer.concat([prefix, encoded]).toString("hex");

      const results = spares.map(spare => {
        const { bytes, reallocated } = convertUTF16ToUTF8Append(input, prefix, spare, fallible);
        return { spare, bytes: Buffer.from(bytes).toString("hex"), reallocated };
      });

      expect(results).toEqual(
        spares.map(spare => ({ spare, bytes: expectedBytes, reallocated: spare < encoded.length })),
      );
    });
  });
});

test("the probe rejects arguments the table above could get wrong", () => {
  const bytesAsUnits = new Uint8Array(4) as unknown as Uint16Array;
  const unitsAsBytes = new Uint16Array(1) as unknown as Uint8Array;
  expect(() => convertUTF16ToUTF8Append(bytesAsUnits, new Uint8Array(0), 0, false)).toThrow("Uint16Array");
  expect(() => convertUTF16ToUTF8Append(units("ab"), unitsAsBytes, 0, false)).toThrow("Uint8Array");
  expect(() => convertUTF16ToUTF8Append(units("ab"), new Uint8Array(0), -1, false)).toThrow("spare capacity");
});
