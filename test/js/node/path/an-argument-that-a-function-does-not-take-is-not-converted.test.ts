import { describe, expect, test } from "bun:test";
import path from "node:path";

const taken = {
  basename: 2,
  dirname: 1,
  extname: 1,
  isAbsolute: 1,
  normalize: 1,
  parse: 1,
  relative: 2,
} as const;

function textThatCounts(converted: number[], place: number, throws: boolean) {
  const text = new String("/a/b" + place + ".c");
  text.toString = () => {
    converted.push(place);
    if (throws) throw new RangeError("the argument at " + place + " was converted");
    return "/x/y" + place + ".z";
  };
  return text as unknown as string;
}

describe.each([
  ["posix", path.posix],
  ["win32", path.win32],
] as const)("path.%s", (_flavor, holder) => {
  test.each(Object.entries(taken))("%s converts the %d it takes and no further argument", (name, count) => {
    const converted: number[] = [];
    const given = Array.from({ length: count + 2 }, (_, place) => textThatCounts(converted, place, place >= count));
    (holder[name as keyof typeof taken] as (...all: string[]) => unknown)(...given);
    expect(converted).toEqual(Array.from({ length: count }, (_, place) => place));
  });

  test.each(["join", "resolve"] as const)("%s converts every argument", name => {
    const converted: number[] = [];
    holder[name](...Array.from({ length: 4 }, (_, place) => textThatCounts(converted, place, false)));
    expect(converted.toSorted()).toEqual([0, 1, 2, 3]);
  });
});
