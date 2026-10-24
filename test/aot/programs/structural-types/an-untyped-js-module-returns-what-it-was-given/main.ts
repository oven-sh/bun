import { Bag, call, callOn, each, keep, kept_, pick, same, spoil } from "./library.js";

interface Point {
  x: number;
  y: number;
}

class Pixel {
  constructor(
    public x: number,
    public y: number,
  ) {}
  sum(): number {
    return this.x + this.y;
  }
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function sum(p: Point): number {
  return p.x + p.y;
}

function plusOne(n: number): number {
  return n + 1;
}

function size(s: string): number {
  return s.length;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const p: Point = same({ x: i, y: 1 });
  const n: number = pick({ n: i }, "n");
  warm += sum(p) + plusOne(n) + call(plusOne, i) + new Bag(i).get() + each([i], plusOne)[0] + callOn(new Pixel(i, 1), Pixel.prototype.sum);
}
console.log("2000 honest rounds: " + warm);

attempt("a text comes back as a number", () => {
  const n: number = same("3");
  return [n + 1, plusOne(n), typeof n, [10, 20, 30, 40][n]];
});
attempt("a list comes back as a point", () => {
  const p: Point = same([1, 2]);
  return [p.x, sum(p), Object.keys(p).join()];
});
attempt("another literal comes back as a point", () => {
  const p: Point = same({ y: "2", x: "1", z: 0 });
  return [p.x + p.y, sum(p), JSON.stringify(p)];
});
attempt("a literal comes back as an instance", () => {
  const p: Pixel = same({ x: 1, y: 2 });
  return [p.x + p.y, p instanceof Pixel, typeof p.sum];
});
attempt("a literal comes back as an instance, its method", () => {
  const p: Pixel = same({ x: 1, y: 2 });
  return p.sum();
});
attempt("a member that is not there", () => {
  const n: number = pick({ n: 1 }, "m");
  const s: string = pick({ s: "a" }, "t");
  return [n + 1, s + "!", typeof n];
});
attempt("a member that is not there, its length", () => size(pick({ s: "a" }, "t")));
attempt("kept and read back as something else", () => {
  keep("k", { x: "kept", y: 1 });
  const p: Point = kept_("k");
  const list: Point[] = [kept_("k"), kept_("none")];
  return [sum(p), list[0].x, list[1]];
});
attempt("typed functions are called with other operands", () => [call(plusOne, "1"), call(plusOne), call(plusOne, null), call(sum, { x: "1", y: 2 }), call(sum, [1, 2]), call(size, [1, 2, 3]), call(size, 5)]);
attempt("a typed function is called with nothing for its point", () => call(sum));
attempt("a method is called on other receivers", () => [callOn({ x: "1", y: 2 }, Pixel.prototype.sum), callOn([1], Pixel.prototype.sum), callOn(5, Pixel.prototype.sum), callOn("xy", Pixel.prototype.sum)]);
attempt("a method is called on nothing", () => callOn(undefined, Pixel.prototype.sum));
attempt("a typed callback gets the elements of another list", () => [each(["1", null, [2]], plusOne), each("ab", size), each(new Set([{ x: 1, y: "2" }]), sum)]);
attempt("a bag", () => {
  const n: number = new Bag("3").get();
  const p: Point = new Bag(null).content;
  return [n + 1, p];
});
attempt("a typed literal is stored to over there", () => {
  const p: Point = { x: 1, y: 2 };
  spoil(p, "x", "text");
  return [p.x, typeof p.x, sum(p), JSON.stringify(p)];
});
attempt("an instance is stored to over there", () => {
  const p = new Pixel(1, 2);
  spoil(p, "y", [3]);
  spoil(p, "z", 4);
  return [p.y, p.sum(), JSON.stringify(p)];
});
attempt("a method is replaced over there", () => {
  const p = new Pixel(1, 2);
  spoil(p, "sum", () => "replaced");
  return [p.sum(), new Pixel(1, 2).sum()];
});
attempt("a list of numbers is stored to over there", () => {
  const list = [1, 2, 3];
  spoil(list, 1, "two");
  spoil(list, 5, 6);
  let total = 0;
  for (const n of list) total += n;
  return [total, list.length, list.map(plusOne)];
});
attempt("honest again", () => [sum(same({ x: 1, y: 2 })), call(plusOne, 1), each([1], plusOne)]);
