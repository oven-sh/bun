import main, { callBack, Color, count, Dog, label, Level, limit, list, maybe, mutable, names, point, spoil, step, takes, version } from "./library.js";

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

function half(n: number): number {
  return n / 2;
}

function plusOne(n: number): number {
  return n + 1;
}

function size(s: string): number {
  return s.length;
}

function total(values: number[]): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  return sum;
}

function sum(p: { x: number; y: number }): number {
  return p.x + p.y;
}

attempt("honest", () => [half(4), plusOne(1), size("ab"), total([1, 2]), sum({ x: 1, y: 2 })]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += half(i) + plusOne(i) + size("ab") + total([i, 1]) + sum({ x: i, y: 1 });
console.log("2000 honest rounds", warm);

attempt("count: read", () => [count(), typeof count()]);
attempt("count: a parameter", () => [half(count()), plusOne(count())]);
attempt("count: a local", () => {
  const n: number = count();
  return [n + 1, n * 2, n === 7, n > 6, -n, n | 0];
});
attempt("count: a field", () => {
  class Holder {
    n = count();
    next(): number {
      return this.n + 1;
    }
  }
  return new Holder().next();
});
attempt("count: an element", () => {
  const values: number[] = [1, count(), 3];
  return [total(values), values];
});
attempt("count: captured", () => {
  let n = 0;
  const take = () => {
    n = count();
  };
  const read = () => n + 1;
  take();
  return read();
});
attempt("label", () => [label(), typeof label(), label() + "!"]);
attempt("label: size", () => size(label()));
attempt("label: a method", () => label().toUpperCase());
attempt("list: total", () => total(list()));
attempt("list: length and elements", () => [list().length, list()[1] + 1, Array.isArray(list())]);
attempt("list: iterated", () => {
  let result = 0;
  for (const n of list()) result += n;
  return result;
});
attempt("list: a method", () => list().map(n => n + 1));
attempt("point", () => [sum(point()), Object.keys(point()), JSON.stringify(point())]);
attempt("point: destructured", () => {
  const { x, y } = point();
  return [x - y, x + y];
});
attempt("point: stored to", () => {
  const p = point();
  p.y = 5;
  p.x = 6;
  return sum(p);
});
attempt("step", () => [step()(1), step()(1) + 1, half(step()(1)), [1, 2].map(step())]);
attempt("maybe", () => [maybe(), maybe() + 1, half(maybe()), typeof maybe()]);
attempt("limit", () => [limit, limit + 1, half(limit), typeof limit, limit === 10]);
attempt("version", () => [version, version === 3, version + 1]);
attempt("names: length", () => names.length);
attempt("names: iterated", () => [...names]);
attempt("names: an element", () => names[0].length);
attempt("names: a method", () => names.join("+"));
attempt("mutable before", () => [mutable, mutable + 1]);
spoil();
attempt("mutable after", () => [mutable, mutable + 1, half(mutable), typeof mutable]);
attempt("a class: fields", () => {
  const d = new Dog("rex");
  return [d.legs, d.name, d.legs + 1, Object.keys(d), Dog.kinds];
});
attempt("a class: a field used", () => new Dog("rex").name.length);
attempt("a class: a method", () => [new Dog("rex").bark(), new Dog("rex").bark() + 1, half(new Dog("rex").bark())]);
attempt("a class: a method that is not there", () => new Dog("rex").wag());
attempt("a class: extended", () => {
  class Puppy extends Dog {
    small = true;
    bark(): number {
      return super.bark() + 1;
    }
  }
  const p = new Puppy("pup");
  return [p.bark(), p.legs, Object.keys(p)];
});
attempt("parameters in another order", () => takes(1, "s"));
attempt("an enum", () => [Color.Red, Color.Green, Color.Red === 0, Color.Green + 1, typeof Color.Red, Color[0]]);
attempt("an enum: switch", () => {
  const name = (c: Color): string => {
    switch (c) {
      case Color.Red:
        return "red";
      case Color.Green:
        return "green";
    }
  };
  return [name(Color.Red), name(Color.Green), name(0), name(1)];
});
attempt("a const enum", () => [Level.Low, Level.High, Level.Low + 1]);
attempt("the module calls back", () => callBack(half));
attempt("the module calls back a closure", () => callBack(n => n + 1));
attempt("the default export", () => [main(), main() + 1, typeof main()]);
attempt("honest again", () => [half(4), plusOne(1), size("ab"), total([1, 2]), sum({ x: 1, y: 2 })]);
