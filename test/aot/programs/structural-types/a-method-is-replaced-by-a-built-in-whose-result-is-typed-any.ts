class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  norm(): number {
    return this.x * this.x + this.y * this.y;
  }
}

class Reader {
  count(text: string): number {
    return text.length;
  }
  title(text: string): string {
    return text.trim();
  }
  point(text: string): Point {
    return new Point(text.length, 1);
  }
  list(text: string): number[] {
    return [text.length];
  }
  copy(p: Point): Point {
    return new Point(p.x, p.y);
  }
  child(p: Point): Point {
    return new Point(p.x + 1, p.y + 1);
  }
  member(p: Point, key: string): number {
    return key === "x" ? p.x : p.y;
  }
  parse: (text: string) => Point = text => new Point(text.length, 2);
}

function show(value: unknown): string {
  return typeof value + " " + (typeof value === "object" ? JSON.stringify(value) : String(value));
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + show(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function countPlusOne(r: Reader, text: string): number {
  return r.count(text) + 1;
}

function titleLength(r: Reader, text: string): number {
  return r.title(text).length;
}

function titleInCapitals(r: Reader, text: string): string {
  return r.title(text).toUpperCase();
}

function pointSum(r: Reader, text: string): number {
  const p = r.point(text);
  return p.x + p.y;
}

function pointNorm(r: Reader, text: string): number {
  return r.point(text).norm();
}

function listTotal(r: Reader, text: string): number {
  let total = 0;
  for (const n of r.list(text)) total += n;
  return total;
}

function copyNorm(r: Reader, p: Point): number {
  return r.copy(p).norm();
}

function copyKeys(r: Reader, p: Point): string {
  const c = r.copy(p);
  return Object.keys(c).join() + " " + c.x + " " + (c instanceof Point);
}

function childFacts(r: Reader, p: Point): string {
  const c = r.child(p);
  return c.x + " " + c.y + " " + c.norm() + " own " + Object.keys(c).join();
}

function memberTimesTwo(r: Reader, p: Point, key: string): number {
  return r.member(p, key) * 2;
}

function parsedSum(r: Reader, text: string): number {
  const p = r.parse(text);
  return p.x + p.y;
}

function round(label: string, r: Reader): void {
  const p = new Point(3, 4);
  attempt(label + ", a number plus one, from 41", () => countPlusOne(r, "41"));
  attempt(label + ", a number plus one, from a quoted text", () => countPlusOne(r, '"41"'));
  attempt(label + ", a number plus one, from null", () => countPlusOne(r, "null"));
  attempt(label + ", the length of a string, from a quoted text", () => titleLength(r, '"abc"'));
  attempt(label + ", the length of a string, from 5", () => titleLength(r, "5"));
  attempt(label + ", capitals, from 5", () => titleInCapitals(r, "5"));
  attempt(label + ", a point's sum, from the right members", () => pointSum(r, '{"x":1,"y":2}'));
  attempt(label + ", a point's sum, in another order with strings", () => pointSum(r, '{"y":"2","z":0,"x":"1"}'));
  attempt(label + ", a point's sum, from a list", () => pointSum(r, "[1,2]"));
  attempt(label + ", a point's method", () => pointNorm(r, '{"x":1,"y":2}'));
  attempt(label + ", a list's total, from numbers", () => listTotal(r, "[1,2,3]"));
  attempt(label + ", a list's total, from strings", () => listTotal(r, '["1","2"]'));
  attempt(label + ", a list's total, from a quoted text", () => listTotal(r, '"12"'));
  attempt(label + ", a list's total, from an object", () => listTotal(r, "{}"));
  attempt(label + ", the method of a copy", () => copyNorm(r, p));
  attempt(label + ", the keys of a copy", () => copyKeys(r, p));
  attempt(label + ", a child", () => childFacts(r, p));
  attempt(label + ", a member times two", () => memberTimesTwo(r, p, "x") + " " + memberTimesTwo(r, p, "norm") + " " + memberTimesTwo(r, p, "missing"));
  attempt(label + ", the function field", () => parsedSum(r, '{"x":"a","y":"b"}'));
}

const r = new Reader();
let warm = 0;
for (let i = 0; i < 2000; i++) warm += countPlusOne(r, "ab") + titleLength(r, "ab") + pointSum(r, "ab") + pointNorm(r, "ab") + listTotal(r, "ab") + copyNorm(r, new Point(1, 1)) + parsedSum(r, "ab");
console.log("2000 honest: " + warm);
round("the methods", r);

r.count = JSON.parse;
r.title = JSON.parse;
r.point = JSON.parse;
r.list = JSON.parse;
r.copy = structuredClone;
r.child = Object.create;
r.member = Reflect.get;
r.parse = JSON.parse;
round("built-ins", r);
round("another reader", new Reader());

export {};
