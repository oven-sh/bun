interface Thing {
  x: number;
  y: number;
  m(): number;
}

const log: string[] = [];

class Real {
  x = 1;
  y = 2;
  m(): number {
    return this.x + this.y;
  }
}

class Other {
  y = 20;
  extra = "extra";
  x = 10;
  m(): number {
    return this.x - this.y;
  }
}

let turn = 0;

function next(): Thing {
  switch (turn++ % 8) {
    case 0:
      return new Real();
    case 1:
      return new Other();
    case 2:
      return { m: () => 34, y: 4, x: 3 };
    case 3:
      return {
        get x() {
          log.push("get x");
          return 5;
        },
        set x(value: number) {
          log.push("set x " + value);
        },
        y: 6,
        m: () => 56,
      };
    case 4:
      return Object.create({ x: 7, y: 8, m: () => 78 });
    case 5:
      return Object.freeze({ x: 9, y: 10, m: () => 910 });
    case 6:
      return new Proxy(new Real(), {});
    default:
      return Object.defineProperty({ x: 11, y: 12, m: () => 1112 }, "y", { enumerable: false });
  }
}

function honest(): Thing {
  return new Real();
}

function attempt(body: () => unknown): string {
  try {
    return String(body());
  } catch (error) {
    return "threw " + (error instanceof Error ? error.constructor.name : typeof error);
  }
}

function round(label: string, use: () => unknown): void {
  turn = 0;
  const results: string[] = [];
  for (let i = 0; i < 8; i++) results.push(attempt(use));
  console.log(label + ": " + results.join(" | ") + " [" + log.join() + "]");
  log.length = 0;
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += honest().x + honest().m();
console.log("2000 honest results: " + warm);

round("read at once", () => next().x);
round("the second member", () => next().y);
round("called at once", () => next().m());
round("stored at once", () => (next().x = 99));
round("incremented at once", () => ++next().x);
round("keys", () => Object.keys(next()).join(""));
round("json", () => JSON.stringify(next()));
round("spread", () => JSON.stringify({ ...next() }));
round("for-in", () => {
  let keys = "";
  for (const key in next()) keys += key;
  return keys;
});
round("pattern", () => {
  const { y, x } = next();
  return x + ":" + y;
});
round("instanceof", () => next() instanceof Real);
round("constructor", () => next().constructor.name);
round("handed on", () => ((t: Thing) => t.x + t.m())(next()));
round("kept, then used twice", () => {
  const kept = next();
  return kept.x + kept.x;
});
round("in", () => "y" in next());
round("own", () => Object.hasOwn(next(), "x"));

async function later(): Promise<Thing> {
  return next();
}

function* stream(): Generator<Thing> {
  for (let i = 0; i < 8; i++) yield next();
}

turn = 0;
const awaited: string[] = [];
for (let i = 0; i < 8; i++) awaited.push(String((await later()).m()));
console.log("awaited: " + awaited.join(" | "));

turn = 0;
console.log("yielded: " + [...stream()].map(t => t.x * 100 + t.y).join(" | "));
log.length = 0;

turn = 0;
console.log("mapped: " + Array.from({ length: 8 }, next).map(t => t.m()).join(" | "));

export {};
