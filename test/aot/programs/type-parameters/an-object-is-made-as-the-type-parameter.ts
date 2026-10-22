// `{} as T`: the object is none of the layouts that the type argument names, and the caller goes on as if it were.
interface Options {
  start?: number;
  end?: number;
  name?: string;
  flag?: boolean;
}

interface Point {
  x: number;
  y: number;
}

function copy<T extends object>(source: T): T {
  const target = {} as T;
  for (const key in source) target[key] = source[key];
  return target;
}

function blank<T>(): T {
  return {} as T;
}

function fill<T extends object>(target: T, source: Partial<T>): T {
  return Object.assign(target, source);
}

function describe(options: Options): string {
  const { start, end = Infinity, name, flag } = copy(options);
  return [start, end, name, flag].map(String).join(",");
}

function run(turn: number): string {
  const point = copy<Point>({ x: turn, y: 2 });
  point.x += 1;
  const empty = blank<Point>();
  const filled = fill(blank<Point>(), { y: turn });
  const lines: unknown[] = [
    describe({}),
    describe({ start: turn }),
    describe({ start: 1, end: 2, name: "n", flag: true }),
    point.x + point.y,
    Object.keys(point).join(),
    empty.x,
    typeof empty.y,
    "x" in empty,
    filled.x,
    filled.y + 1,
    Object.keys(copy(Object.create({ inherited: 1 }) as { inherited: number })).join(),
  ];
  return lines.map(String).join(" ");
}

for (let turn = 0; turn < 3; turn++) console.log(run(turn));
