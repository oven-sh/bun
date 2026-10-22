function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

let log: string[] = [];

function now<T>(label: string, value: T): T {
  log.push(label);
  return value;
}

function soon<T>(label: string, value: T): Promise<T> {
  log.push(label + " asked");
  return Promise.resolve().then(() => {
    log.push(label + " answered");
    return value;
  });
}

function three(a: number, b: number, c: number): string {
  log.push("called");
  return a + "," + b + "," + c;
}

class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    log.push("constructed");
    this.x = x;
    this.y = y;
  }
  plus(n: number): number {
    return this.x + this.y + n;
  }
}

function tag(strings: TemplateStringsArray, ...values: number[]): string {
  return strings.join("_") + values.join("+");
}

const cases: [string, () => Promise<unknown>][] = [
  ["arguments", async () => three(now("a", 1), await soon("b", 2), now("c", 3))],
  ["two awaits in arguments", async () => three(await soon("a", 1), now("b", 2), await soon("c", 3))],
  ["an array", async () => [now("a", 1), await soon("b", 2), now("c", 3)]],
  ["an object", async () => ({ [now("key a", "a")]: await soon("value a", 1), [await soon("key b", "b")]: now("value b", 2) })],
  ["arithmetic", async () => now("a", 2) + (await soon("b", 3)) * now("c", 4)],
  ["a template", async () => `${now("a", 1)}-${await soon("b", 2)}-${now("c", 3)}`],
  ["a tagged template", async () => tag`x${now("a", 1)}y${await soon("b", 2)}z`],
  ["a method of an awaited object", async () => (await soon("object", new Point(1, 2))).plus(await soon("argument", 3))],
  ["new", async () => new Point(await soon("x", 1), now("y", 2))],
  ["a condition, true", async () => ((await soon("test", true)) ? await soon("yes", 1) : await soon("no", 2))],
  ["a condition, false", async () => ((await soon("test", false)) ? await soon("yes", 1) : await soon("no", 2))],
  ["and, cut short", async () => now("left", 0) && (await soon("right", 1))],
  ["or, cut short", async () => now("left", 1) || (await soon("right", 2))],
  ["nullish, not cut short", async () => now<number | null>("left", null) ?? (await soon("right", 2))],
  ["an optional chain that stops", async () => now<Point | undefined>("object", undefined)?.plus(await soon("argument", 1))],
  ["an optional chain that goes on", async () => now<Point | undefined>("object", new Point(1, 1))?.plus(await soon("argument", 1))],
  ["a computed member", async () => now("object", [10, 20, 30])[await soon("index", 1)]],
  ["a store to a computed member", async () => {
    const list = [0, 0];
    now("object", list)[await soon("index", 1)] = await soon("value", 5);
    return list;
  }],
  ["a spread", async () => three(...(await soon("list", [1, 2, 3] satisfies [number, number, number])))],
  ["an awaited function", async () => (await soon("function", three))(now("a", 1), now("b", 2), now("c", 3))],
  ["an increment of an awaited object's member", async () => {
    const p = new Point(1, 1);
    return [(await soon("object", p)).x++, p.x];
  }],
  ["typeof", async () => typeof (await soon("value", 1))],
  ["a comma", async () => (now("a", 1), await soon("b", 2), now("c", 3))],
  ["destructuring defaults", async () => {
    const { a = await soon("default a", 1), b = await soon("default b", 2) }: { a?: number; b?: number } = { b: 20 };
    return [a, b];
  }],
  ["a for loop", async () => {
    let rounds = 0;
    for (let i = await soon("start", 0); i < (await soon("limit", 2)); i += await soon("step", 1)) rounds++;
    return rounds;
  }],
  ["a switch", async () => {
    switch (await soon("subject", 2)) {
      case await soon("case 1", 1):
        return "one";
      case await soon("case 2", 2):
        return "two";
      case await soon("case 3", 3):
        return "three";
    }
    return "none";
  }],
  ["a comparison chain", async () => (await soon("a", 1)) < (await soon("b", 2)) === now("c", true)],
  ["await of await", async () => await await soon("inner", soon("never a promise of a promise", 1))],
];

for (const [label, run] of cases) {
  log = [];
  console.log(label + ": " + text(await run()));
  console.log("  " + log.join(", "));
}

export {};
