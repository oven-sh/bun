function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
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

function plusOne(n: number): number {
  return n + 1;
}

class Counter {
  n = 1;
  static all = 1;
  add(text: string): number {
    this.n += JSON.parse(text);
    return this.n;
  }
}

const table = [10, 20, 30];

function added(text: string): unknown {
  let n = 1;
  n += JSON.parse(text);
  return [n, typeof n, n + 1, plusOne(n), table[n]];
}

function addedTwice(text: string): unknown {
  let n = 1;
  n += JSON.parse(text);
  n += 1;
  n++;
  return [n, typeof n];
}

function otherOperators(text: string): unknown {
  let a = 6;
  let b = 6;
  let c = 6;
  let d = 6;
  let e = 6;
  a -= JSON.parse(text);
  b *= JSON.parse(text);
  c /= JSON.parse(text);
  d %= JSON.parse(text);
  e **= JSON.parse(text);
  return [a, b, c, d, e];
}

function bitOperators(text: string): unknown {
  let a = 6;
  let b = 6;
  let c = 6;
  let d = 6;
  a |= JSON.parse(text);
  b &= JSON.parse(text);
  c ^= JSON.parse(text);
  d <<= JSON.parse(text);
  return [a, b, c, d];
}

function logical(text: string): unknown {
  let zero = 0;
  let one = 1;
  let text1 = "";
  zero ||= JSON.parse(text);
  one &&= JSON.parse(text);
  text1 ||= JSON.parse(text);
  return [zero, typeof zero, zero + 1, one, typeof one, one + 1, text1, typeof text1, text1 + "!"];
}

function inALoop(text: string): unknown {
  let total = 0;
  for (let i = 0; i < 4; i++) total += i === 2 ? JSON.parse(text) : i;
  return [total, typeof total];
}

function anElement(text: string): unknown {
  const list = [1, 2];
  list[0] += JSON.parse(text);
  list[1] *= 2;
  let total = 0;
  for (const n of list) total += n;
  return [list, total];
}

function aMember(text: string): unknown {
  const p = { x: 1, y: 2 };
  p.x += JSON.parse(text);
  return [p.x, typeof p.x, p.x + p.y, JSON.stringify(p)];
}

function aText(text: string): unknown {
  let s = "a";
  s += JSON.parse(text);
  return [s, typeof s, s.length];
}

function chosen(text: string): unknown {
  const n: number = text.length > 0 ? JSON.parse(text) : 0;
  const m: number = JSON.parse(text) ?? 7;
  const o: number = JSON.parse(text) || 8;
  return [n, m, o, n + m + o];
}

const cases: [string, (text: string) => unknown][] = [
  ["added", added],
  ["added twice", addedTwice],
  ["other operators", otherOperators],
  ["bit operators", bitOperators],
  ["logical", logical],
  ["in a loop", inALoop],
  ["an element", anElement],
  ["a member", aMember],
  ["a field", text => [new Counter().add(text), typeof new Counter().add(text)]],
  ["a static field", text => [(Counter.all += JSON.parse(text)), typeof Counter.all, (Counter.all = 1)]],
  ["a text", aText],
  ["chosen", chosen],
];

for (const [name, run] of cases) {
  let rounds = 0;
  for (let i = 0; i < 2000; i++) {
    run("1");
    rounds++;
  }
  console.log(name + ": " + rounds + " honest rounds");
  for (const text of ["1", "0.5", "-0", '"1"', '"a"', '""', "true", "null", "[2]", "[]", "{}", "1e400"]) attempt(name + " " + text, () => run(text));
}

attempt("a bigint", () => {
  let n = 1;
  n += Object(2n).valueOf();
  return n;
});

export {};
