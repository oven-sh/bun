function isMissing(n: number): boolean {
  return n === undefined;
}

function first<T>(list: T[]): T {
  return list[0];
}

function third(a: number, b: number): number {
  return arguments[2];
}

function at(list: number[], index: number): number {
  return list[index];
}

interface Size {
  width: number;
}

const integers = [1, 2, 3];
console.log("past the end " + isMissing(integers[9]));
const fractions = [0.5, 1.5];
console.log("past the end of fractions " + isMissing(fractions[9]));
console.log("through a function " + isMissing(at([1, 2, 3], 9)) + " " + isMissing(at([1, 2, 3], 1)));
const holes = new Array<number>(2);
console.log("a hole " + isMissing(holes[0]));
const tuple: [string, number] = ["a", 1];
tuple.pop();
console.log("a popped tuple " + isMissing(tuple[1]));
const view = new Float64Array(1);
console.log("past the end of a typed array " + isMissing(view[5]));
console.log("the first of an empty list " + isMissing(first<number>([])));
console.log("an argument that was not passed " + isMissing(third(1, 2)));
const two = [1, 2];
const [, , fromAPattern] = two;
console.log("the third of a pattern over two " + isMissing(fromAPattern));
const blank: Partial<Size> = { width: undefined };
const merged: Size = { ...{ width: 1 }, ...blank };
console.log("blanked by a spread " + isMissing(merged.width));
const source = { width: 1, height: 2 };
const partial: Partial<typeof source> = source;
delete partial.width;
console.log("deleted " + isMissing(source.width));
const narrow = { x: 1 };
const wide: { x: number | undefined } = narrow;
wide.x = undefined;
console.log("stored through a wider alias " + isMissing(narrow.x));
const ages: Record<string, number> = { ann: 30 };
console.log("a missing entry of a record " + isMissing(ages.bob) + " " + isMissing(ages.ann));

export {};
