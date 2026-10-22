import * as values from "./values.ts";

interface Point {
  x: number;
  y: number;
}

interface Labeled {
  label: string;
}

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function read(p: Point): number {
  return p.x * 100 + p.y;
}

function setX(p: Point, value: number): number {
  p.x = value;
  return p.x;
}

function listing(o: object): string {
  const walked: string[] = [];
  for (const key in o) walked.push(key);
  return Object.keys(o).join() + " | " + walked.join() + " | " + JSON.stringify(o) + " | " + Object.keys({ ...o }).join();
}

function sumWhileMoving(p: Point): number {
  let sum = 0;
  for (let i = 0; i < 2000; i++) {
    sum += p.x;
    if (i === 999) values.move(1);
  }
  return sum;
}

const plain: Point = { x: 1, y: 2 };
let total = 0;
for (let i = 0; i < 2000; i++) total += read(plain);
console.log("2000 plain: " + total);

const point: Point = values;
console.log("the namespace as a point: " + read(point));
console.log("its keys are sorted: " + listing(point));
values.move(10);
console.log("after the module moved: " + read(point) + " " + point.x + " " + values.x);
console.log("a loop during which the module moves: " + sumWhileMoving(point));

attempt("a store", () => setX(point, 5));
attempt("an increment", () => point.y++);
attempt("Object.assign", () => Object.assign(point, { x: 5 }).x);
attempt("Reflect.set", () => Reflect.set(point, "x", 5));
attempt("defineProperty", () => Object.defineProperty(point, "x", { value: 5 }).x);
attempt("delete", () => Reflect.deleteProperty(point, "x"));
console.log("unchanged: " + read(point));
console.log("frozen " + Object.isFrozen(point) + " sealed " + Object.isSealed(point) + " extensible " + Object.isExtensible(point));
console.log("prototype is null: " + (Object.getPrototypeOf(point) === null) + ", tag " + Object.prototype.toString.call(point));
attempt("turned into a string", () => String(point));
attempt("hasOwnProperty as a method", () => Object.hasOwn(point, "x") + " " + ("hasOwnProperty" in point));

const copy: Point = { ...point };
values.move(1);
console.log("a copy does not follow: " + read(copy) + " against " + read(point));
console.log("a copy can be stored to: " + setX(copy, 5));

const labeled: Labeled = values;
console.log("a string member: " + labeled.label);
values.rename("renamed");
console.log("after the module renamed it: " + labeled.label);

class Holder {
  constructor(public point: Point) {}
  read(): number {
    return this.point.x * 100 + this.point.y;
  }
}
const holder = new Holder(values);
console.log("a field: " + holder.read());
values.move(1);
console.log("a field, after a move: " + holder.read());

const list: Point[] = [plain, values, copy];
console.log("elements: " + list.map(read).join());
attempt("stores through elements", () => list.map(p => setX(p, 0)).join());
console.log("afterwards: " + list.map(read).join());

const { x, y } = point;
values.move(1);
console.log("a pattern takes the values of that moment: " + x + " " + y + " against " + point.x + " " + point.y);
