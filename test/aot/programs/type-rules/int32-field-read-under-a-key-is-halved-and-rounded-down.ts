// Halves int32 fields that are read under a key which is a parameter, an enum member or a name of the type, out of interfaces, classes, copies and nested objects, rounds the halves down, and passes, stores, returns and declares them as int32.
import type { int32 } from "bun";

interface Point {
  x: int32;
  y: int32;
}
interface Line {
  from: Point;
  to: Point;
}
enum Axis {
  X = "x",
  Y = "y",
}
class Cell {
  x: int32 = -7;
  y: int32 = 2147483647;
}

function take(n: int32): int32 {
  return n;
}

function passed(point: Point, key: "x" | "y") {
  return take(Math.floor(point[key] / 2));
}
function stored(point: Point, key: "x" | "y", into: Point) {
  into.x = Math.floor(point[key] / 2);
  into.y = Math.floor(point[key] / 2) + 1;
  return into.x + into.y;
}
function returned(point: Point, key: keyof Point): int32 {
  return Math.floor(point[key] / 2);
}
function declared(point: Point, key: keyof Point) {
  const half: int32 = Math.floor(point[key] / 2) + 1;
  return half;
}
function underEnumMember(point: Point): int32 {
  return Math.floor(point[Axis.Y] / 2);
}
function ofClass(cell: Cell, key: "x" | "y"): int32 {
  return Math.floor(cell[key] / 2);
}
function ofNestedObject(line: Line, key: "x" | "y"): int32 {
  return take(Math.floor(line.to[key] / 2) + 1);
}
function ofCopy(point: Point, key: "x" | "y"): int32 {
  const copy = { ...point };
  const typed: Point = { ...point };
  return take(Math.floor(copy[key] / 2)) ^ take(Math.floor(typed[key] / 2));
}
function ofPattern(point: Point, key: "x" | "y"): int32 {
  const { [key]: value } = point;
  return Math.floor(value / 2);
}
function ofVariable(point: Point, key: "x" | "y"): int32 {
  const value = point[key];
  return Math.floor(value / 2) + 1;
}
function ofOptionalRead(point: Point, key: "x" | "y"): int32 {
  return Math.floor(point?.[key] / 2);
}
function ofEitherRead(point: Point, key: "x" | "y", first: boolean): int32 {
  return Math.floor((first ? point[key] : point.x) / 2);
}

const points: Point[] = [
  { x: 12, y: 5 },
  { x: -1, y: -2147483648 },
  { x: 0, y: 2147483647 },
  { x: 1, y: -3 },
];
const keys: ("x" | "y")[] = ["x", "y"];
for (const point of points) {
  for (const key of keys) {
    console.log(
      passed(point, key),
      stored(point, key, { x: 0, y: 0 }),
      returned(point, key),
      declared(point, key),
      underEnumMember(point),
      ofClass(new Cell(), key),
      ofNestedObject({ from: points[0], to: point }, key),
      ofCopy(point, key),
      ofPattern(point, key),
      ofVariable(point, key),
      ofOptionalRead(point, key),
      ofEitherRead(point, key, true),
      ofEitherRead(point, key, false),
    );
  }
}
