// Where no code of the program stores a property of a literal by its name, the object is created with that property as its discriminant. It is an object like any other: every change untyped code makes to it succeeds, as in plain Bun.
import { run } from "./untyped.cjs";
enum E { A, B }
type OfNumber = { f: number };
type OfDigits = { f: 1 | 2 };
type OfEnum = { f: E };
type OfString = { f: string };
type Shape = { f: "circle"; r: number } | { f: "square"; side: number };
const makers: [string, () => object][] = [
  ["a number", (): OfNumber => ({ f: 1 })],
  ["one of two numbers", (): OfDigits => ({ f: 1 })],
  ["an enum", (): OfEnum => ({ f: E.A })],
  ["a string", (): OfString => ({ f: "s" })],
  ["a union by its tag", (): Shape => ({ f: "circle", r: 1 })],
];
for (const line of run(makers)) console.log(line);
