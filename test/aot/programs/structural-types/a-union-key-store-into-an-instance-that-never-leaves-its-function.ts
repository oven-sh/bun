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

class Point {
  x = 1;
  y = 2.5;
  name = "p";
  sum(): number {
    return this.x + this.y;
  }
  shout(): string {
    return this.name.toUpperCase();
  }
}

function set<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
  target[key] = value;
}

function swap<T, K extends keyof T>(target: T, a: K, b: K): void {
  const kept = target[a];
  target[a] = target[b];
  target[b] = kept;
}

const yes: boolean = process.argv.length > 0;

function stringIntoInteger(): string {
  const p = new Point();
  set(p, yes ? "x" : "name", "text");
  return typeof p.x + " " + show(p.x + 1) + " " + show(p.sum()) + " " + show(p.x * 2) + " " + JSON.stringify(p);
}

function stringIntoFraction(): string {
  const p = new Point();
  set(p, yes ? "y" : "name", "7");
  return typeof p.y + " " + show(p.y + 1) + " " + show(p.sum()) + " " + show(p.y * 2) + " " + JSON.stringify(p);
}

function numberIntoString(): string {
  const p = new Point();
  set(p, yes ? "name" : "x", 7);
  let shouted: string;
  try {
    shouted = p.shout();
  } catch (error) {
    shouted = "threw " + (error instanceof TypeError);
  }
  return typeof p.name + " " + show(p.name + "!") + " " + show(p.name.length) + " " + shouted + " " + JSON.stringify(p);
}

function exchanged(): string {
  const p = new Point();
  swap(p, "x", "name");
  return typeof p.x + " " + typeof p.name + " " + show(p.sum()) + " " + show(p.name + 1) + " " + JSON.stringify(p);
}

function methodReplaced(): string {
  const p = new Point();
  set(p, yes ? "sum" : "shout", p.shout);
  return typeof p.sum() + " " + show(p.sum()) + " " + Object.keys(p).join();
}

function blanked(): string {
  const p = new Point();
  const view: Partial<Point> = p;
  view.x = undefined;
  delete view.y;
  return typeof p.x + " " + typeof p.y + " " + show(p.sum()) + " " + show(p.x + 1) + " " + Object.keys(p).join() + " " + JSON.stringify(p);
}

function nulled(): string {
  const p = new Point();
  const view: { [K in keyof Point]: Point[K] | null } = p;
  view.x = null;
  view.name = null;
  return typeof p.x + " " + show(p.x + 1) + " " + show(p.sum()) + " " + show(p.name + "!") + " " + JSON.stringify(p);
}

function twoInstances(): string {
  const a = new Point();
  const b = new Point();
  set(a, yes ? "x" : "name", "only a");
  return show(a.sum()) + " " + show(b.sum()) + " " + typeof a.x + " " + typeof b.x;
}

function honest(i: number): number {
  const p = new Point();
  set(p, "x", i);
  swap(p, "x", "y");
  return p.sum() + p.shout().length;
}

let total = 0;
for (let i = 0; i < 2000; i++) total += honest(i);
console.log("2000 honest rounds: " + total);
console.log("a string into the integer: " + stringIntoInteger());
console.log("a string into the fraction: " + stringIntoFraction());
console.log("a number into the string: " + numberIntoString());
console.log("exchanged: " + exchanged());
console.log("a method is replaced by the other: " + methodReplaced());
console.log("blanked and deleted: " + blanked());
console.log("nulled: " + nulled());
console.log("two instances: " + twoInstances());

export {};
