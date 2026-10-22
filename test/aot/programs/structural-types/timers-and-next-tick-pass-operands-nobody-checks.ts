interface Point {
  x: number;
  y: number;
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function guarded(run: () => unknown): string {
  try {
    return show(run());
  } catch (error) {
    return "threw " + (error instanceof Error ? error.constructor.name : typeof error);
  }
}

const lines: string[] = [];
let label = "";

function takesPoint(p: Point, n: number): void {
  lines.push(label + " -> " + guarded(() => [p.x, p.x + p.y]) + " " + guarded(() => [n, n + 1, typeof n]));
}

function takesNothing(): void {
  lines.push(label + " -> " + arguments.length + " operands");
}

const loose = JSON.parse('[{"x":"1","y":2},"3"]');
const values: [string, ReturnType<typeof JSON.parse>[]][] = [
  ["honest", [{ x: 1, y: 2 }, 3]],
  ["parsed", loose],
  ["swapped", [3, { x: 1, y: 2 }]],
  ["too few", [{ x: 1, y: 2 }]],
  ["none", []],
  ["nulls", [null, null]],
];

function tick(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

for (const [name, operands] of values) {
  label = "nextTick, " + name;
  process.nextTick(takesPoint, ...operands);
  await tick();
  label = "setTimeout, " + name;
  await new Promise<void>(resolve => {
    setTimeout(takesPoint, 0, ...operands);
    setTimeout(resolve, 1);
  });
  label = "setImmediate, " + name;
  setImmediate(takesPoint, ...operands);
  await tick();
  await tick();
}

label = "a timer gives a function without parameters";
await new Promise<void>(resolve => {
  setTimeout(takesNothing, 0);
  setTimeout(resolve, 1);
});
label = "queueMicrotask gives";
queueMicrotask(takesNothing);
await tick();

label = "an interval";
await new Promise<void>(resolve => {
  let count = 0;
  const timer = setInterval(
    (p: Point) => {
      lines.push(label + " " + count + " -> " + guarded(() => p.x + p.y));
      if (++count === 2) {
        clearInterval(timer);
        resolve();
      }
    },
    0,
    loose[0],
  );
});

for (const line of lines) console.log(line);

export {};
