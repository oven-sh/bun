// Bun.deepEquals and node:assert on compiled objects: fields, added properties, symbol keys, accessors and index keys.
import { deepStrictEqual } from "node:assert";

class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

class Vector {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

class Segment {
  start: Point;
  end: Point;
  constructor(start: Point, end: Point) {
    this.start = start;
    this.end = end;
  }
}

class Polyline {
  points: Point[];
  constructor(points: Point[]) {
    this.points = points;
  }
}

interface Coordinates {
  x: number;
  y: number;
}

interface Labeled {
  x: number;
  label?: string;
}

const tag = Symbol("tag");

function untyped(value: object): any {
  return value;
}

function isStrictlyEqual(left: unknown, right: unknown): boolean {
  try {
    deepStrictEqual(left, right);
    return true;
  } catch {
    return false;
  }
}

function compare(name: string, left: unknown, right: unknown): void {
  console.log(
    name,
    Bun.deepEquals(left, right),
    Bun.deepEquals(right, left),
    Bun.deepEquals(left, right, true),
    Bun.deepEquals(right, left, true),
    isStrictlyEqual(left, right),
    isStrictlyEqual(right, left),
  );
}

function withProperty(point: Point, key: string | symbol | number, value: unknown): Point {
  untyped(point)[key] = value;
  return point;
}

function withHidden(point: Point, value: number): Point {
  Object.defineProperty(point, "hidden", { value, enumerable: false, configurable: true, writable: true });
  return point;
}

function withAccessor(point: Point, value: number): Point {
  Object.defineProperty(point, "computed", { get: () => value, enumerable: true, configurable: true });
  return point;
}

const literal: Coordinates = { x: 1, y: 2 };
const reordered: Coordinates = { y: 2, x: 1 };
const other: Coordinates = { x: 1, y: 3 };
const onlyX: { x: number } = { x: 1 };

compare("same class", new Point(1, 2), new Point(1, 2));
compare("same class, another value", new Point(1, 2), new Point(1, 3));
compare("instance and literal", new Point(1, 2), literal);
compare("instance and parsed literal", new Point(1, 2), JSON.parse('{"x":1,"y":2}'));
compare("fields in another order", literal, reordered);
compare("instance and reordered literal", new Point(1, 2), reordered);
compare("literals, another value", literal, other);
compare("two classes, same fields", new Point(1, 2), new Vector(1, 2));

compare("symbol on both", withProperty(new Point(1, 2), tag, 1), withProperty(new Point(1, 2), tag, 1));
compare("symbol, another value", withProperty(new Point(1, 2), tag, 1), withProperty(new Point(1, 2), tag, 2));
compare("symbol on one side", withProperty(new Point(1, 2), tag, 1), new Point(1, 2));

compare("added on both", withProperty(new Point(1, 2), "z", 3), withProperty(new Point(1, 2), "z", 3));
compare("added, another value", withProperty(new Point(1, 2), "z", 3), withProperty(new Point(1, 2), "z", 4));
compare("added on one side", withProperty(new Point(1, 2), "z", 3), new Point(1, 2));
compare("added undefined on one side", withProperty(new Point(1, 2), "z", undefined), new Point(1, 2));
compare(
  "added in another order",
  withProperty(withProperty(new Point(1, 2), "z", 3), "w", 4),
  withProperty(withProperty(new Point(1, 2), "w", 4), "z", 3),
);

compare(
  "nested",
  new Segment(new Point(1, 2), new Point(3, 4)),
  new Segment(new Point(1, 2), new Point(3, 4)),
);
compare(
  "nested, another value",
  new Segment(new Point(1, 2), new Point(3, 4)),
  new Segment(new Point(1, 2), new Point(3, 5)),
);
compare(
  "array of compiled objects",
  new Polyline([new Point(1, 2), new Point(3, 4)]),
  new Polyline([new Point(1, 2), new Point(3, 4)]),
);
compare(
  "array, another length",
  new Polyline([new Point(1, 2), new Point(3, 4)]),
  new Polyline([new Point(1, 2)]),
);
compare("bare arrays", [new Point(1, 2)], [new Point(1, 2)]);
compare("array, two classes", [new Point(1, 2)], [new Vector(1, 2)]);

compare("non-enumerable on one side", withHidden(new Point(1, 2), 1), new Point(1, 2));
compare("non-enumerable, another value", withHidden(new Point(1, 2), 1), withHidden(new Point(1, 2), 2));

compare("accessor on one side", withAccessor(new Point(1, 2), 3), new Point(1, 2));
compare("accessor and data property", withAccessor(new Point(1, 2), 3), withProperty(new Point(1, 2), "computed", 3));
compare("accessors, same answer", withAccessor(new Point(1, 2), 3), withAccessor(new Point(1, 2), 3));
compare("accessors, another answer", withAccessor(new Point(1, 2), 3), withAccessor(new Point(1, 2), 4));
compare("accessor literal", { get x() { return 1; }, y: 2 } as Coordinates, literal);

compare("missing field", new Point(1, 2), onlyX);
const absent: Labeled = { x: 1 };
const explicitUndefined: Labeled = { x: 1, label: undefined };
compare("undefined and missing", explicitUndefined, absent);
compare("undefined and label", explicitUndefined, { x: 1, label: "a" } as Labeled);

compare("index on both", withProperty(new Point(1, 2), 0, "a"), withProperty(new Point(1, 2), 0, "a"));
compare("index, another value", withProperty(new Point(1, 2), 0, "a"), withProperty(new Point(1, 2), 0, "b"));
compare("index on one side", withProperty(new Point(1, 2), 0, "a"), new Point(1, 2));
