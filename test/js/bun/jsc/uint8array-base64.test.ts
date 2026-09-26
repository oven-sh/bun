import { describe, expect, test } from "bun:test";

// Uint8Array.prototype.setFromBase64 passes the target's length to FromBase64 as
// maxLength, and FromBase64 step 3 returns { read: 0, written: 0 } for maxLength 0
// before looking at the string. So a zero-length target never rejects its input and
// never reports whitespace as read, no matter which options are in effect.
// https://tc39.es/proposal-arraybuffer-base64/spec/#sec-frombase64

const lastChunkHandlings = ["loose", "strict", "stop-before-partial"] as const;
const alphabets = ["base64", "base64url"] as const;

const inputs = [
  "!!!",
  "#",
  "a#",
  "aa#",
  "aaa#",
  "aaaa#",
  "Q", // partial chunk of one character: a SyntaxError even in loose mode once there is room
  "QQ",
  "QQ=",
  "QQ===", // too much padding
  "Q===",
  "QQ==!!!", // garbage after a complete chunk
  "QUJD", // valid, but nowhere to put it
  " ",
  "  ",
  " QUJD ",
  "\tQQ==\n",
  "+/", // only valid in the base64 alphabet
  "-_", // only valid in the base64url alphabet
  "\u00a0", // non-ASCII whitespace is not whitespace to base64
  "\u2212==",
  "\uff21\uff21", // 16-bit string
].map(input => [input.replace(/[^\x21-\x7e]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`), input]);

function zeroLengthTargets() {
  const buffer = new Uint8Array([1, 2, 3, 4]);

  const resizable = new ArrayBuffer(4, { maxByteLength: 8 });
  const lengthTracking = new Uint8Array(resizable);
  resizable.resize(0);

  const grown = new ArrayBuffer(2, { maxByteLength: 8 });
  const fixedAtOldEnd = new Uint8Array(grown, 2, 0);
  grown.resize(8);

  return {
    "new Uint8Array(0)": new Uint8Array(0),
    "zero-length subarray": buffer.subarray(2, 2),
    "length-tracking view of a buffer resized to 0": lengthTracking,
    "fixed zero-length view of a grown buffer": fixedAtOldEnd,
    buffer,
  };
}

describe("Uint8Array.prototype.setFromBase64 into a zero-length target", () => {
  test.each(inputs)('"%s" is not parsed', (_, input) => {
    const { buffer, ...views } = zeroLengthTargets();

    for (const [name, view] of Object.entries(views)) {
      expect(view.setFromBase64(input), name).toEqual({ read: 0, written: 0 });
      for (const alphabet of alphabets) {
        for (const lastChunkHandling of lastChunkHandlings) {
          const options = { alphabet, lastChunkHandling };
          expect(view.setFromBase64(input, options), `${name} ${alphabet} ${lastChunkHandling}`).toEqual({
            read: 0,
            written: 0,
          });
        }
      }
    }

    expect(Array.from(buffer)).toEqual([1, 2, 3, 4]);
  });

  test("the result is a fresh ordinary object with read before written", () => {
    const target = new Uint8Array(0);
    const first = target.setFromBase64("!!!");
    const second = target.setFromBase64("!!!");
    expect(first).not.toBe(second);
    expect(Object.getPrototypeOf(first)).toBe(Object.prototype);
    expect(Object.keys(first)).toEqual(["read", "written"]);
  });

  test("the argument and option checks that precede FromBase64 still run", () => {
    const target = new Uint8Array(0);

    for (const notAString of [undefined, null, 42, {}, [], Object("!!!")]) {
      expect(() => target.setFromBase64(notAString as any), String(notAString)).toThrow(TypeError);
    }
    for (const notAnObject of [null, false, 42, "!!!"]) {
      expect(() => target.setFromBase64("!!!", notAnObject as any), String(notAnObject)).toThrow(TypeError);
    }
    for (const alphabet of [null, 42, "hex", Object("base64")]) {
      expect(() => target.setFromBase64("!!!", { alphabet: alphabet as any }), String(alphabet)).toThrow(TypeError);
    }
    for (const lastChunkHandling of [null, 42, "lenient", Object("loose")]) {
      const options = { lastChunkHandling: lastChunkHandling as any };
      expect(() => target.setFromBase64("!!!", options), String(lastChunkHandling)).toThrow(TypeError);
    }

    const calls: string[] = [];
    const options = {
      get alphabet() {
        calls.push("alphabet");
        return "base64url" as const;
      },
      get lastChunkHandling() {
        calls.push("lastChunkHandling");
        return "strict" as const;
      },
    };
    expect(target.setFromBase64("!!!", options)).toEqual({ read: 0, written: 0 });
    expect(calls).toEqual(["alphabet", "lastChunkHandling"]);

    class GetterError extends Error {}
    expect(() =>
      target.setFromBase64("!!!", {
        get alphabet(): "base64" {
          throw new GetterError();
        },
      }),
    ).toThrow(GetterError);
  });

  test("a detached or out-of-bounds zero-length target is still a TypeError", () => {
    const detached = new Uint8Array(0);
    detached.buffer.transfer();
    expect(() => detached.setFromBase64("!!!")).toThrow(TypeError);
    expect(() => detached.setFromBase64("")).toThrow(TypeError);

    const detachedByGetter = new Uint8Array(0);
    expect(() =>
      detachedByGetter.setFromBase64("!!!", {
        get lastChunkHandling() {
          detachedByGetter.buffer.transfer();
          return undefined;
        },
      }),
    ).toThrow(TypeError);

    const resizable = new ArrayBuffer(4, { maxByteLength: 8 });
    const outOfBounds = new Uint8Array(resizable, 4, 0);
    resizable.resize(2);
    expect(() => outOfBounds.setFromBase64("!!!")).toThrow(TypeError);
  });

  test("a target with room still parses the string", () => {
    expect(() => new Uint8Array(1).setFromBase64("!!!")).toThrow(SyntaxError);
    expect(() => new Uint8Array(1).setFromBase64("Q", { lastChunkHandling: "strict" })).toThrow(SyntaxError);
    expect(() => new Uint8Array(1).setFromBase64("QQ==!!!")).toThrow(SyntaxError);
    expect(new Uint8Array(1).setFromBase64("  ")).toEqual({ read: 2, written: 0 });

    const target = new Uint8Array(1);
    expect(target.setFromBase64("/w==")).toEqual({ read: 4, written: 1 });
    expect(target[0]).toBe(255);

    const resizable = new ArrayBuffer(0, { maxByteLength: 8 });
    const lengthTracking = new Uint8Array(resizable);
    expect(lengthTracking.setFromBase64("!!!")).toEqual({ read: 0, written: 0 });
    resizable.resize(1);
    expect(() => lengthTracking.setFromBase64("!!!")).toThrow(SyntaxError);
    expect(lengthTracking.setFromBase64("/w==")).toEqual({ read: 4, written: 1 });
    expect(lengthTracking[0]).toBe(255);
  });

  test("Uint8Array.fromBase64 has no maxLength and still rejects unparseable input", () => {
    for (const input of ["!!!", "#", "Q", "=", "Q#"]) {
      expect(() => Uint8Array.fromBase64(input), input).toThrow(SyntaxError);
    }
    expect(Uint8Array.fromBase64("")).toEqual(new Uint8Array(0));
    expect(Uint8Array.fromBase64("  ")).toEqual(new Uint8Array(0));
    expect(Uint8Array.fromBase64("/w==")).toEqual(new Uint8Array([255]));
  });
});

describe("Uint8Array.prototype.setFromHex", () => {
  test("reports read and written in that order", () => {
    const target = new Uint8Array(2);
    const result = target.setFromHex("ff00");
    expect(Object.keys(result)).toEqual(["read", "written"]);
    expect(result).toEqual({ read: 4, written: 2 });
    expect(Array.from(target)).toEqual([255, 0]);
    expect(new Uint8Array(1).setFromHex("ff00")).toEqual({ read: 2, written: 1 });
  });

  test("a zero-length target skips the digits but not the odd-length check", () => {
    // FromHex rejects an odd length before it looks at maxLength, so unlike
    // setFromBase64 this one still throws for a zero-length target.
    expect(new Uint8Array(0).setFromHex("zz")).toEqual({ read: 0, written: 0 });
    expect(new Uint8Array(0).setFromHex("")).toEqual({ read: 0, written: 0 });
    expect(() => new Uint8Array(0).setFromHex("z")).toThrow(SyntaxError);
    expect(() => new Uint8Array(1).setFromHex("zz")).toThrow(SyntaxError);
  });
});
