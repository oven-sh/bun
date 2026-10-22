import { changeLast, identity, isLast, lastAsText, makeLine, makeList, makePoint, makeWide, type Point, remember, remembers, scribble, Tracked } from "./library.js";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

class Holder {
  point: Point;
  constructor(point: Point) {
    this.point = point;
  }
}

function move(p: Point): void {
  p.x += 10;
}

function same(p: Point): Point {
  return p;
}

for (const [name, make] of [["a point", makePoint], ["a wider point", makeWide]] satisfies [string, () => Point][]) {
  attempt(name + ": identity", () => {
    const p = make();
    const list: Point[] = [p];
    const holder = new Holder(p);
    const captured = () => p;
    return [isLast(p), isLast(same(p)), isLast(list[0]), isLast(holder.point), isLast(captured()), isLast({ ...p })];
  });
  attempt(name + ": a typed store is seen by the module", () => {
    const p = make();
    move(p);
    p.y = -1;
    return lastAsText();
  });
  attempt(name + ": the module's store is seen by typed code", () => {
    const p = make();
    const holder = new Holder(p);
    changeLast();
    return [p.x, holder.point.x, same(p).x];
  });
  attempt(name + ": keys", () => [Object.keys(make()), JSON.stringify(make())]);
}

attempt("a list", () => {
  const list = makeList();
  list.push(3);
  changeLast();
  return [isLast(list), list, lastAsText()];
});
attempt("one object reached twice", () => {
  const line = makeLine();
  move(line.from);
  return [line.from === line.to, line.to.x, lastAsText()];
});
attempt("typed objects go out and come back", () => {
  const p: Point = { x: 1, y: 2 };
  const holder = new Holder(p);
  const list = [1, 2];
  const f = (n: number): number => n;
  return [identity(p) === p, identity(holder) === holder, identity(holder).point === p, identity(list) === list, identity(f) === f];
});
attempt("remembered by the module", () => {
  const p: Point = { x: 1, y: 2 };
  const holder = new Holder(p);
  remember(p);
  remember(holder);
  return [remembers(p), remembers(holder), remembers(holder.point), remembers({ x: 1, y: 2 })];
});
attempt("the module scribbles on a typed object", () => {
  const p: Point = { x: 1, y: 2 };
  scribble(p);
  return [p.x, p.x + 1, Object.keys(p), JSON.stringify(p)];
});
attempt("the module scribbles on a field's object", () => {
  const holder = new Holder({ x: 1, y: 2 });
  scribble(holder.point);
  return [holder.point.x, JSON.stringify(holder)];
});
attempt("an instance of the module's class", () => {
  const t = new Tracked("first");
  return [t.isFirst(), t.secret(), Tracked.all[0] === t, t.name, Object.keys(t)];
});
attempt("an instance of a subclass without fields", () => {
  class Plain extends Tracked {}
  const t = new Plain("plain");
  return [Tracked.all[Tracked.all.length - 1] === t, t.secret(), t.name, Object.keys(t), t instanceof Tracked];
});
attempt("an instance of a subclass with a field", () => {
  class Extra extends Tracked {
    extra = 1;
  }
  const t = new Extra("extra");
  return [Tracked.all[Tracked.all.length - 1] === t, t.name, Object.keys(t), t instanceof Tracked, t.extra];
});
attempt("a private name of the base on a subclass with a field", () => {
  class Extra extends Tracked {
    extra = 1;
  }
  return new Extra("extra").secret();
});
