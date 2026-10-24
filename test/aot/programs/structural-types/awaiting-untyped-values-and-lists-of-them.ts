interface Point {
  x: number;
  y: number;
}

const log: string[] = [];

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

async function attempt(label: string, run: () => unknown): Promise<void> {
  log.length = 0;
  let line: string;
  try {
    line = label + " -> " + show(await run());
  } catch (error) {
    line = label + " threw " + (error instanceof Error ? error.constructor.name : typeof error);
  }
  console.log(log.length > 0 ? line + " | " + log.join(" ") : line);
}

function sum(p: Point): number {
  return p.x + p.y;
}

function plusOne(n: number): number {
  return n + 1;
}

const things = new Map<string, unknown>([
  ["a number", 3],
  ["a text", "3"],
  ["null", null],
  ["a point", { x: 1, y: 2 }],
  ["a promise of a number", Promise.resolve(3)],
  ["a promise of a text", Promise.resolve("3")],
  ["a promise of a promise", Promise.resolve(Promise.resolve("deep"))],
  [
    "a thenable",
    {
      then(resolve: (value: unknown) => void) {
        log.push("then");
        resolve("from then");
      },
    },
  ],
  [
    "a thenable that answers twice",
    {
      then(resolve: (value: unknown) => void) {
        resolve(1);
        resolve("second");
      },
    },
  ],
  [
    "a thenable with a getter",
    {
      get then() {
        log.push("get then");
        return undefined;
      },
      x: 1,
      y: 2,
    },
  ],
  ["then is a number", { then: 5, x: 1, y: 2 }],
  [
    "a thenable that rejects",
    {
      then(resolve: unknown, reject: (reason: unknown) => void) {
        reject("rejected");
      },
    },
  ],
]);
const lookUp: Function = (name: string) => things.get(name);

let warm = 0;
for (let i = 0; i < 500; i++) {
  const n: number = await lookUp("a number");
  const [m]: number[] = await Promise.all([lookUp("a number")]);
  warm += plusOne(n) + plusOne(m);
}
console.log("500 honest rounds: " + warm);

for (const name of things.keys()) {
  await attempt("awaited as a number, " + name, async () => {
    const n: number = await lookUp(name);
    return [typeof n, n + 1, plusOne(n)];
  });
  await attempt("awaited as a point, " + name, async () => {
    const p: Point = await lookUp(name);
    return [p.x, sum(p)];
  });
  await attempt("Promise.all, " + name, async () => {
    const list = lookUp(name) === null ? [null] : [lookUp(name), 1];
    const [n, m]: number[] = await Promise.all(list);
    return [typeof n, n + 1, m + 1];
  });
  await attempt("Promise.resolve and then, " + name, () => Promise.resolve(lookUp(name)).then((n: number) => plusOne(n)));
  await attempt("Promise.race, " + name, async () => {
    const n: number = await Promise.race([lookUp(name)]);
    return plusOne(n);
  });
  await attempt("returned by an async function, " + name, async () => {
    const f = async (): Promise<number> => lookUp(name);
    return plusOne(await f());
  });
  await attempt("for await, " + name, async () => {
    const seen: number[] = [];
    for await (const n of [lookUp(name)]) seen.push(plusOne(n));
    return seen;
  });
}

await attempt("Promise.all of a parsed list", async () => {
  const [a, b, c]: number[] = await Promise.all(JSON.parse('[1,"2",null]'));
  return [a + 1, b + 1, c + 1];
});
await attempt("Promise.all of a parsed text", async () => {
  const numbers: number[] = await Promise.all(JSON.parse('"12"'));
  return numbers.map(plusOne);
});
await attempt("Promise.all of a parsed number", async () => {
  const numbers: number[] = await Promise.all(JSON.parse("12"));
  return numbers.map(plusOne);
});
await attempt("Promise.all of nothing", async () => {
  const none: Point[] = await Promise.all([]);
  return [none.length, none[0]];
});

export {};
