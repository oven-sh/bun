import { describe as describeValue, heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";

// encodeURI, encodeURIComponent, escape, decodeURI, decodeURIComponent and unescape return their
// argument when no code unit changes (oven-sh/WebKit#839), and build the result in one exact-size
// string otherwise. The expectations are V8's (node 26).

// A string decoded from UTF-16 bytes is 16-bit, whatever it holds. One or no code unit is an
// interned 8-bit string whatever the source.
function sixteenBit(string: string): string {
  return Buffer.from(string, "utf16le").toString("utf16le");
}

function is8Bit(string: string): boolean {
  return describeValue(string).includes("8Bit:(1)");
}

const functions = { encodeURIComponent, encodeURI, escape, decodeURIComponent, decodeURI, unescape };

const expectations: Record<keyof typeof functions, [string, string | ErrorConstructor][]> = {
  encodeURIComponent: [
    ["", ""],
    ["photos", "photos"],
    ["my-bucket-2026-10-16-cat.jpg", "my-bucket-2026-10-16-cat.jpg"],
    ["my file (1) \u00e9+copy&x=1.jpg", "my%20file%20(1)%20%C3%A9%2Bcopy%26x%3D1.jpg"],
    ["!'()*-._~", "!'()*-._~"],
    ["!#$&'()*+,-./:;=?@_~", "!%23%24%26'()*%2B%2C-.%2F%3A%3B%3D%3F%40_~"],
    ["%", "%25"],
    ["\u00ff", "%C3%BF"],
    ["\u20ac", "%E2%82%AC"],
    ["a\u{1F600}b", "a%F0%9F%98%80b"],
    ["\uD800x", URIError],
    ["\uDC00", URIError],
    ["x\uD83D", URIError],
  ],
  encodeURI: [
    ["photos", "photos"],
    ["!#$&'()*+,-./:;=?@_~", "!#$&'()*+,-./:;=?@_~"],
    ["my file (1) \u00e9+copy&x=1.jpg", "my%20file%20(1)%20%C3%A9+copy&x=1.jpg"],
    ["<>", "%3C%3E"],
    ["\u{1F600}", "%F0%9F%98%80"],
    ["\uDC00", URIError],
  ],
  escape: [
    ["", ""],
    ["photos", "photos"],
    ["@*+-./_", "@*+-./_"],
    ["my file (1) \u00e9+copy&x=1.jpg", "my%20file%20%281%29%20%E9+copy%26x%3D1.jpg"],
    ["\u00ff", "%FF"],
    ["\u20ac", "%u20AC"],
    ["\u{1F600}", "%uD83D%uDE00"],
    ["\uD800x", "%uD800x"],
  ],
  decodeURIComponent: [
    ["", ""],
    ["photos", "photos"],
    ["100%", URIError],
    ["%zz", URIError],
    ["%41", "A"],
    ["%u0041", URIError],
    ["%E2%82%AC", "\u20ac"],
    ["%F0%9F%98%80", "\u{1F600}"],
    ["\u00e9t\u00e9", "\u00e9t\u00e9"],
    ["\u20ac", "\u20ac"],
  ],
  decodeURI: [
    ["photos", "photos"],
    ["%2F%41", "%2FA"],
    ["%E2%82%AC", "\u20ac"],
    ["%zz", URIError],
  ],
  unescape: [
    ["", ""],
    ["photos", "photos"],
    ["%", "%"],
    ["100%", "100%"],
    ["%41", "A"],
    ["%zz", "%zz"],
    ["%u0041", "A"],
    ["%u00e9", "\u00e9"],
    ["%uD83D%uDE00", "\u{1F600}"],
    ["%E9", "\u00e9"],
    ["\u20ac%41", "\u20acA"],
  ],
};

describe("URI functions", () => {
  for (const [name, rows] of Object.entries(expectations) as [keyof typeof functions, typeof expectations.escape][]) {
    const fn = functions[name];
    test(`${name} matches V8 for 8-bit and 16-bit strings`, () => {
      for (const [input, expected] of rows) {
        for (const string of [input, sixteenBit(input)]) {
          expect(string).toBe(input);
          if (typeof expected === "string") {
            const result = fn(string);
            expect(result).toBe(expected);
            // A result is 8-bit when it can be: a 16-bit argument that is returned as is is
            // narrowed, and an escaped result is ASCII.
            if (result.length && [...result].every(c => c.charCodeAt(0) < 0x100)) {
              expect(is8Bit(result), `${name}(${JSON.stringify(input)}) 16-bit`).toBe(true);
            }
          } else {
            expect(() => fn(string)).toThrow(expected);
          }
        }
      }
    });
  }

  test("the argument is read as a string once", () => {
    for (const [name, fn] of Object.entries(functions)) {
      let calls = 0;
      const object = {
        toString() {
          calls++;
          return "a b";
        },
      };
      fn(object as any);
      expect(calls, name).toBe(1);
      expect(() => fn(Symbol() as any), name).toThrow(TypeError);
    }
    expect(encodeURIComponent(1e21 as any)).toBe("1e%2B21");
    expect(escape(null as any)).toBe("null");
    expect(unescape(undefined as any)).toBe("undefined");
  });

  test("a result with the argument's code units is the argument, not a new string", () => {
    const inputs = {
      encodeURIComponent: "photos",
      encodeURI: "/a/b?c=d",
      escape: "photos",
      decodeURIComponent: "photos",
      decodeURI: "/a/b?c=d",
      unescape: "photos",
    };
    const keep: string[] = [];
    const stringCells = () => {
      Bun.gc(true);
      return heapStats().objectTypeCounts.string ?? 0;
    };
    const before = stringCells();
    for (const [name, input] of Object.entries(inputs)) {
      const fn = functions[name as keyof typeof functions];
      for (let i = 0; i < 5000; i++) keep.push(fn(input));
      expect(keep.at(-1)).toBe(input);
    }
    const after = stringCells();
    // Without the identity return each call makes one string cell: 30000 here.
    expect(after - before).toBeLessThan(500);
  });
});
