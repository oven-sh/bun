// The helpers of a compiler's utilities, each called with arrays of several kinds, with callbacks that look into their own kind of element.
function forEach<T, U>(array: readonly T[] | undefined, callback: (element: T, index: number) => U | undefined): U | undefined {
  if (array !== undefined) {
    for (let i = 0; i < array.length; i++) {
      const result = callback(array[i], i);
      if (result) return result;
    }
  }
  return undefined;
}
function find<T>(array: readonly T[], predicate: (element: T) => boolean): T | undefined {
  for (const element of array) if (predicate(element)) return element;
  return undefined;
}
function first<T>(array: readonly T[]): T {
  return array[0];
}
function map<T, U>(array: readonly T[], f: (element: T) => U): U[] {
  const result: U[] = [];
  for (const element of array) result.push(f(element));
  return result;
}
function identity<T>(value: T): T {
  return value;
}
class Name {
  constructor(public text: string) {}
}
class Size {
  constructor(public width: number, public height: number) {}
}
const names = [new Name("a"), new Name("bb"), new Name("ccc")];
const sizes = [new Size(1, 2), new Size(3, 4)];
const numbers = [1.5, 2, 3];
const strings = ["x", "yy"];
const mixed: (Name | Size | number | string | undefined | null)[] = [names[0], sizes[1], 7, "z", undefined, null];
const lines: string[] = [];
for (let round = 0; round < 3; round++) {
  lines.push(String(find(names, n => n.text.length === round + 1)?.text));
  lines.push(String(find(sizes, s => s.width > round)?.height));
  lines.push(String(find(numbers, n => n > round)));
  lines.push(String(find(strings, s => s.length > round)));
  lines.push(String(find(mixed, m => typeof m === (round === 0 ? "number" : round === 1 ? "string" : "undefined"))));
  lines.push(first(names).text + first(sizes).width + first(numbers) + first(strings) + (first(mixed) as Name).text);
  lines.push(map(names, n => n.text.length).join() + " " + map(sizes, s => new Name(String(s.height))).map(n => n.text).join() + " " + map(numbers, n => n * 2).join());
  lines.push(String(forEach(names, (n, i) => (i === round ? n : undefined))?.text) + " " + String(forEach(sizes, s => (s.height > 3 ? s.width : undefined))) + " " + String(forEach(undefined, () => 1)));
  lines.push(identity(names[round]).text + identity(round) + identity("s") + String(identity(undefined)) + identity(sizes[round & 1]).height);
}
console.log(lines.join("\n"));
