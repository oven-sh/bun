import { describe, expect, test } from "bun:test";
import path from "node:path";

const taken = {
  basename: 2,
  dirname: 1,
  extname: 1,
  isAbsolute: 1,
  matchesGlob: 2,
  normalize: 1,
  parse: 1,
  relative: 2,
  toNamespacedPath: 1,
} as const;

function textThatCounts(converted: number[], place: number) {
  const text = new String("/a/b" + place + ".c");
  text.toString = text.valueOf = () => (converted.push(place), "/x/y" + place + ".z");
  return text as unknown as string;
}

describe.each([
  ["posix", path.posix],
  ["win32", path.win32],
] as const)("path.%s", (_flavor, holder) => {
  test.each(Object.entries(taken))("%s takes %d and looks at no further argument", (name, count) => {
    const converted: number[] = [];
    const call = holder[name as keyof typeof taken] as (...all: string[]) => unknown;
    const given = Array.from({ length: count }, (_, place) => "/a/b" + place + ".c");
    expect(call(...given, textThatCounts(converted, count), textThatCounts(converted, count + 1))).toEqual(
      call(...given),
    );
    expect(converted).toEqual([]);
  });

  test.each([...Object.entries(taken).filter(([name]) => name !== "toNamespacedPath"), ["join", 4], ["resolve", 4]] as [
    keyof typeof taken,
    number,
  ][])("%s refuses a String object and does not convert it", (name, count) => {
    const converted: number[] = [];
    for (let at = 0; at < count; at++) {
      const given = Array.from({ length: count }, (_, place) => (place === at ? textThatCounts(converted, at) : "a"));
      expect(() => (holder[name] as (...all: string[]) => unknown)(...given)).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
          message: expect.stringContaining("must be of type string. Received an instance of String"),
        }),
      );
    }
    expect(converted).toEqual([]);
  });

  test("toNamespacedPath answers a String object as it is", () => {
    const converted: number[] = [];
    const text = textThatCounts(converted, 0);
    expect(holder.toNamespacedPath(text)).toBe(text);
    expect(converted).toEqual([]);
  });
});
