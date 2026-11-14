import { expect, test } from "bun:test";

test("holes before an empty spread are part of the length", () => {
  const empty: unknown[] = [];
  const one = [1];
  // prettier-ignore
  const arrays = [
    [, ...empty], [, , ...empty], [1, , ...empty], [...one, , ...empty], [, ...empty, ...empty], [, ...empty, , ...empty], [, ...empty, ,], [, ...one], [, ...empty, 1], [, 1, ...empty],
  ];
  expect(arrays.map(array => array.length)).toEqual([1, 2, 2, 2, 1, 2, 2, 2, 2, 2]);
  expect(arrays.map(array => Object.keys(array).join())).toEqual(["", "", "0", "0", "", "", "", "1", "1", "1"]);
});
