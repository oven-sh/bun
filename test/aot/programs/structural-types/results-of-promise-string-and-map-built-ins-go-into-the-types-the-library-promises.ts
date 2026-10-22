interface Point {
  x: number;
  y: number;
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

async function attempt(label: string, run: () => unknown): Promise<void> {
  try {
    console.log(label + " -> " + show(await run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function sum(p: Point): number {
  return p.x + p.y;
}

function size(s: string): number {
  return s.length;
}

const point: Point = { x: 1, y: 2 };

await attempt("Promise.all of a tuple", async () => {
  const [n, s, p]: [number, string, Point] = await Promise.all([1, Promise.resolve("two"), Promise.resolve(point)]);
  return [n + 1, size(s), sum(p)];
});
await attempt("Promise.all of a list", async () => {
  const points: Point[] = await Promise.all([point, Promise.resolve({ x: 3, y: 4 })]);
  return points.map(sum);
});
await attempt("Promise.allSettled", async () => {
  const results: PromiseSettledResult<Point>[] = await Promise.allSettled([Promise.resolve(point), Promise.reject(new Error("no"))]);
  return results.map(result => (result.status === "fulfilled" ? sum(result.value) : result.status));
});
await attempt("Promise.race and Promise.any", async () => {
  const first: Point = await Promise.race([Promise.resolve(point)]);
  const any: Point = await Promise.any([Promise.reject(new Error("no")), Promise.resolve(point)]);
  return [sum(first), sum(any)];
});
await attempt("Promise.withResolvers and Promise.try", async () => {
  const { promise, resolve } = Promise.withResolvers<Point>();
  resolve(point);
  const tried: number = await Promise.try(sum, point);
  return [sum(await promise), tried + 1];
});
await attempt("then and finally", () => {
  const chained: Promise<number> = Promise.resolve(point)
    .then(sum)
    .finally(() => "ignored")
    .then(n => n + 1);
  return chained;
});
await attempt("Array.fromAsync", async () => {
  async function* make(): AsyncGenerator<Point> {
    yield point;
    yield { x: 3, y: 4 };
  }
  const points: Point[] = await Array.fromAsync(make());
  return points.map(sum);
});
await attempt("texts", () => {
  const pieces: string[] = "a,b".split(",");
  const padded: string = "a".padStart(3, "-");
  const at: string | undefined = "ab".at(-1);
  const code: number = "a".charCodeAt(0);
  const point2: number | undefined = "a".codePointAt(0);
  const index: number = "abc".indexOf("c");
  const chars: string[] = [..."ab"];
  const replaced: string = "aa".replaceAll("a", "b");
  const normalized: string = "a".normalize();
  return [pieces.map(size), size(padded), at, code + 1, point2, index + 1, chars.map(size), replaced, size(normalized)];
});
await attempt("matches", () => {
  const match: RegExpExecArray | null = /(a)(?<rest>b)/.exec("ab");
  const all: RegExpExecArray[] = [..."aXa".matchAll(/a/g)];
  const found: RegExpMatchArray | null = "ab".match(/b/);
  return [match?.index, match?.[1], match?.groups?.rest, all.map(m => m.index), found?.[0]];
});
await attempt("maps and weak maps", () => {
  const map = new Map<string, Point>([["a", point]]);
  const got: Point | undefined = map.get("a");
  const none: Point | undefined = map.get("b");
  const same: Map<string, Point> = map.set("c", { x: 3, y: 4 });
  const weak = new WeakMap<Point, number>([[point, 1]]);
  const n: number | undefined = weak.get(point);
  const ref: Point | undefined = new WeakRef(point).deref();
  return [got && sum(got), none, same === map, [...map.values()].map(sum), n, ref && sum(ref)];
});
await attempt("numbers", () => {
  const parsed: number = Number.parseFloat("1.5");
  const whole: number = parseInt("12px", 10);
  const fixed: string = (1.005).toFixed(2);
  const max: number = Math.max(1, 2);
  const none: number = Math.max();
  const big: bigint = BigInt(5) * 2n;
  const clamped: number = Math.trunc(-0.5);
  return [parsed * 2, whole + 1, size(fixed), max + 1, none, big, clamped];
});
await attempt("json", () => {
  const text: string = JSON.stringify(point);
  const pretty: string = JSON.stringify(point, null, 1);
  const some: string = JSON.stringify(point, ["x"]);
  return [size(text), size(pretty), some];
});
await attempt("symbols and dates", () => {
  const shared: symbol = Symbol.for("s");
  const key: string | undefined = Symbol.keyFor(shared);
  const description: string | undefined = Symbol("d").description;
  const time: number = new Date(5).getTime();
  const iso: string = new Date(0).toISOString();
  return [typeof shared, key, description, time + 1, size(iso)];
});

export {};
