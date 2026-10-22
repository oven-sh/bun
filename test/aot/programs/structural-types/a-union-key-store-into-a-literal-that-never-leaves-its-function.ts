function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
}

interface Point {
  x: number;
  y: number;
  name: string;
}

function set<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
  target[key] = value;
}

function setSlowly<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
  for (let i = 0; i < 3; i++) {
    try {
      if (i === 2) target[key] = value;
    } finally {
      if (i > 5) throw new Error("never");
    }
  }
}

const yes: boolean = process.argv.length > 0;

function stringIntoInteger(): string {
  const p: Point = { x: 1, y: 2.5, name: "p" };
  set(p, yes ? "x" : "name", "text");
  return typeof p.x + " " + show(p.x) + " " + show(p.x + 1) + " " + show(p.x * 2) + " " + show(p.x | 0) + " " + show(p.x === 1) + " " + show(p.y + 1) + " " + JSON.stringify(p);
}

function stringIntoFraction(): string {
  const p: Point = { x: 1, y: 2.5, name: "p" };
  set(p, yes ? "y" : "name", "7");
  return typeof p.y + " " + show(p.y) + " " + show(p.y + 1) + " " + show(p.y * 2) + " " + show(p.y < 10) + " " + show(p.x + p.y) + " " + JSON.stringify(p);
}

function numberIntoString(): string {
  const p: Point = { x: 1, y: 2.5, name: "p" };
  set(p, yes ? "name" : "x", 7);
  return typeof p.name + " " + show(p.name) + " " + show(p.name + "!") + " " + show(p.name.length) + " " + show(p.name === "p") + " " + JSON.stringify(p);
}

function numberIntoStringThenAMethod(): string {
  const p: Point = { x: 1, y: 2.5, name: "p" };
  set(p, yes ? "name" : "x", 7);
  try {
    return p.name.toUpperCase();
  } catch (error) {
    return "threw " + (error instanceof TypeError);
  }
}

function stringIntoIntegerThenAMethod(): string {
  const p: Point = { x: 1, y: 2.5, name: "p" };
  set(p, yes ? "x" : "name", "text");
  try {
    return p.x.toFixed(1);
  } catch (error) {
    return "threw " + (error instanceof TypeError);
  }
}

function readBeforeAndAfter(): string {
  const p: Point = { x: 1, y: 2.5, name: "p" };
  const before = p.x + 1;
  set(p, yes ? "x" : "name", "text");
  const after = p.x + 1;
  return show(before) + " " + show(after);
}

function slowly(): string {
  const p: Point = { x: 1, y: 2.5, name: "p" };
  const before = p.x + p.y;
  setSlowly(p, yes ? "x" : "name", "slow");
  return show(before) + " " + typeof p.x + " " + show(p.x + p.y) + " " + JSON.stringify(p);
}

function written(): string {
  const p: Point = { x: 1, y: 2.5, name: "p" };
  const wide: { x: number | string; y: number; name: string } = p;
  wide.x = "alias";
  return typeof p.x + " " + show(p.x + 1) + " " + JSON.stringify(p);
}

function inALoop(): string {
  const p: Point = { x: 0, y: 0.5, name: "p" };
  let text = "";
  for (let i = 0; i < 4; i++) {
    text += show(p.x + 1) + " ";
    if (i === 1) set(p, yes ? "x" : "name", "late");
    if (i === 2) set(p, "x", 10);
  }
  return text;
}

function honest(i: number): number {
  const p: Point = { x: i, y: 0.5, name: "p" };
  set(p, "x", i + 1);
  set(p, "y", p.y * 2);
  set(p, "name", "q");
  return p.x + p.y + p.name.length;
}

let total = 0;
for (let i = 0; i < 2000; i++) total += honest(i);
console.log("2000 honest rounds: " + total);
console.log("a string into the integer: " + stringIntoInteger());
console.log("a string into the fraction: " + stringIntoFraction());
console.log("a number into the string: " + numberIntoString());
console.log("a number into the string, then a method: " + numberIntoStringThenAMethod());
console.log("a string into the integer, then a method: " + stringIntoIntegerThenAMethod());
console.log("read before and after: " + readBeforeAndAfter());
console.log("by a setter that is not small: " + slowly());
console.log("by a wider alias: " + written());
console.log("in a loop: " + inALoop());

export {};
