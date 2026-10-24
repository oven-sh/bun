// The TypeError message for each kind of value that reaches a parameter of each kind of written type through `any`. An object type tests only that the value is an object: a property of the wrong type is reported by the typed read of that property. An `int32` is a promise that the build proves and has no test when the program runs.
import type { int32 } from "bun";

class Point { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } }
interface Labeled { label: string; size: number }
class Circle { kind: string = "circle"; radius: number = 1; }
class Square { kind: string = "square"; side: number = 2; }
class ShapeA { tag: string = "a"; a: number = 1; }
class ShapeB { tag: string = "b"; b: number = 2; }
class ShapeC { tag: string = "c"; c: number = 3; }
class ShapeD { tag: string = "d"; d: number = 4; }
class ShapeE { tag: string = "e"; e: number = 5; }

function takesNumber(value: number): unknown { return value; }
function takesInt32(value: int32): unknown { return value; }
function takesMethod(value: "GET" | "POST"): { method: "GET" | "POST" } { return { method: value }; }
function takesStrings(value: string[]): unknown { return value; }
function takesMap(value: Map<string, number>): unknown { return value; }
function takesPoint(value: Point): unknown { return value == null ? value : value.x + value.y; }
function takesLabeled(value: Labeled): unknown { return value == null ? value : value.label + value.size; }
function takesShape(value: Circle | Square): unknown { return value == null ? value : value.kind; }
function takesCallback(value: () => void): unknown { return value; }
function takesLetter(value: "a" | "b" | "c" | "d" | "e"): unknown { return value; }
function takesWideUnion(value: ShapeA | ShapeB | ShapeC | ShapeD | ShapeE): unknown { return value == null ? value : value.tag; }

function outcome(run: () => unknown): string {
  try { return "no error, " + typeof run(); } catch (error) { return (error as Error).name + ": " + (error as Error).message.replace(/ \(bun compile [^)]*\)/, ""); }
}

const parameters: [string, any][] = [
  ["number", takesNumber], ["int32", takesInt32], ['"GET" | "POST"', takesMethod], ["string[]", takesStrings], ["Map<string, number>", takesMap],
  ["Point", takesPoint], ["Labeled", takesLabeled], ["Circle | Square", takesShape], ["() => void", takesCallback],
];
const Legacy: any = (0, eval)("(class Legacy { constructor() { this.x = 1; this.y = 2; } })");
function greet(): void {}
const values: [string, any][] = [
  ["undefined", undefined], ["true", true], ["1.5", 1.5], ["a string of 60 characters", "abcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghij"],
  ["a symbol", Symbol("s")], ["a bigint", 10n], ["an array", ["a"]], ["a Set", new Set([1])],
  ["an object with a missing property", JSON.parse('{"x":1,"label":"tag"}')],
  ["an object with a wrong property", JSON.parse('{"x":"one","y":2,"label":3,"size":4,"kind":5}')],
  ["an instance of an untyped class", new Legacy()], ["a class", Point], ["a named function", greet], ["an anonymous function", function () {}],
];
for (const [type, takes] of parameters) for (const [kind, value] of values) console.log(type + " <- " + kind + ": " + outcome(() => takes(value)));

const tag: Labeled = { label: "tag", size: 1 };
console.log("number <- 7: " + outcome(() => (takesNumber as any)(7)));
console.log("int32 <- 7: " + outcome(() => (takesInt32 as any)(7)));
console.log('"GET" | "POST" <- "POST": ' + outcome(() => (takesMethod as any)("POST")));
console.log("string[] <- an empty array: " + outcome(() => (takesStrings as any)([])));
console.log("Map<string, number> <- a Map: " + outcome(() => (takesMap as any)(new Map([["a", 1]]))));
console.log("Point <- a Point: " + outcome(() => (takesPoint as any)(new Point(1, 2))));
console.log("Labeled <- a Labeled: " + outcome(() => (takesLabeled as any)(tag)));
console.log("Labeled <- an untyped object with all properties: " + outcome(() => (takesLabeled as any)(JSON.parse('{"label":"tag","size":1}'))));
console.log("Circle | Square <- a Circle: " + outcome(() => (takesShape as any)(new Circle())));
console.log("Circle | Square <- a Square: " + outcome(() => (takesShape as any)(new Square())));
console.log("() => void <- an arrow function: " + outcome(() => (takesCallback as any)(() => {})));

console.log("five literals <- 1.5: " + outcome(() => (takesLetter as any)(1.5)).replace(/"[a-e]"/g, '"x"'));
console.log('five literals <- "c": ' + outcome(() => (takesLetter as any)("c")));
console.log("five classes <- 1.5: " + outcome(() => (takesWideUnion as any)(1.5)).replace(/Shape[A-E]/g, "Shape"));
for (const shape of [new ShapeA(), new ShapeB(), new ShapeC(), new ShapeD(), new ShapeE()]) console.log("five classes <- " + shape.tag + ": " + outcome(() => (takesWideUnion as any)(shape)));
