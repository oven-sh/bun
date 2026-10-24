interface Point {
  x: number;
  y: number;
}

const log: string[] = [];

function note<T>(name: string, value: T): T {
  log.push(name);
  return value;
}

function show(label: string, p: Point): void {
  console.log(label + ": " + Object.keys(p).join() + " " + JSON.stringify(p) + " x=" + p.x + " y=" + p.y + " [" + log.join() + "]");
  log.length = 0;
}

const onlyX: Partial<Point> = { x: 10 };
const onlyY: Partial<Point> = { y: 20 };
const none: Partial<Point> = {};
const yx: Point = { y: 200, x: 100 };
const missing: Partial<Point> | undefined = [onlyX][1];
const alsoMissing: Partial<Point> | null = log.length === 0 ? null : onlyX;
const keyX: "x" = "x";
const keyY: "y" = "y";

show("plain", { x: 1, y: 2 });
show("computed keys", { [keyY]: 2, [keyX]: 1 });
show("a computed key first", { [keyY]: 2, x: 1 });
show("an overwritten member keeps its place", { x: 1, y: 2, ...onlyX });
show("the second one overwritten", { x: 1, y: 2, ...onlyY });
show("an empty spread", { x: 1, ...none, y: 2 });
show("a spread first", { ...yx, x: 1 });
show("a spread between", { ...onlyY, ...onlyX, x: 1, y: 2 });
show("two spreads", { ...yx, ...{ x: 1, y: 2 } });
show("a spread of a spread", { ...{ ...yx } });
show("an absent spread adds nothing", { x: 1, ...missing, ...alsoMissing, y: 2 });
show("shorthand", (() => {
  const y = 2;
  const x = 1;
  return { y, x };
})());

show("evaluation order", {
  x: note("x", 1),
  ...note("spread", onlyY),
  y: note("y", 2),
});
show("evaluation order with computed keys", {
  [note("key y", keyY)]: note("value y", 2),
  [note("key x", keyX)]: note("value x", 1),
});

const withGetter = {
  get y(): number {
    log.push("get y");
    return 2;
  },
  x: 1,
};
show("a getter is read when it is spread", { ...withGetter });
const partly: Partial<Point> = withGetter;
show("and between other members", { x: note("x", 0), y: note("y", 0), ...partly });

function build(first: "x" | "y"): Point {
  return first === "x" ? { x: 1, y: 2 } : { y: 2, x: 1 };
}
show("chosen at run time, x", build("x"));
show("chosen at run time, y", build("y"));

function assemble(parts: Partial<Point>[]): Point {
  let result: Point = { x: 0, y: 0 };
  for (const part of parts) result = { ...part, ...result, ...part };
  return result;
}
show("assembled", assemble([onlyY, onlyX]));
show("assembled the other way", assemble([onlyX, onlyY]));

function fromEntries(order: ("x" | "y")[]): Point {
  const made: Partial<Point> = {};
  for (const key of order) made[key] = key === "x" ? 1 : 2;
  return { x: 0, y: 0, ...made };
}
show("defaults first", fromEntries(["y", "x"]));

let total = 0;
for (let i = 0; i < 2000; i++) total += Object.keys({ x: i, y: i, ...none }).length + Object.keys({ ...yx, x: i })[0].length;
console.log("2000 rounds: " + total);
show("then", { ...yx, x: 5 });

const many: Point[] = [];
for (let i = 0; i < 6; i++) many.push(i % 2 === 0 ? { x: i, y: i } : { ...yx, y: i });
console.log("in an array: " + JSON.stringify(many));

export {};
