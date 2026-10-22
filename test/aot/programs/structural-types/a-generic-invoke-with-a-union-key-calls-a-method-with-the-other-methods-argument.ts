function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (list.length > 40) return "array of " + list.length + " with keys " + Object.keys(list).join();
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

class Printer {
  copies = 1;
  title = "doc";
  setCopies(count: number): string {
    this.copies = count * 2;
    return "copies " + count.toFixed(0);
  }
  setTitle(title: string): string {
    this.title = title.trim();
    return "title " + title.toUpperCase();
  }
  addBoth(count: number): number {
    return this.copies + count;
  }
}

interface Commands<A> {
  setCopies(argument: A): string;
  setTitle(argument: A): string;
}

interface Adds<A> {
  addBoth(argument: A): number;
}

function invoke<A, K extends keyof Commands<A>>(target: Commands<A>, key: K, argument: A): string {
  return target[key](argument);
}

function invokeAll<A>(target: Commands<A>, keys: (keyof Commands<A>)[], argument: A): string[] {
  return keys.map(key => target[key](argument));
}

function add<A>(target: Adds<A>, argument: A): number {
  return target.addBoth(argument);
}

const yes: boolean = process.argv.length > 0;

function state(p: Printer): string {
  return typeof p.copies + " " + show(p.copies) + ", " + typeof p.title + " " + show(p.title) + ", " + JSON.stringify(p);
}

let width = 0;
const warm = new Printer();
for (let i = 0; i < 2000; i++) width += warm.setCopies(i).length + warm.setTitle("t" + i).length + add(warm, 1);
console.log("2000 honest rounds: " + width);

const b = new Printer();
attempt("a string for the method that takes a number", () => invoke<number | string, "setCopies" | "setTitle">(b, yes ? "setCopies" : "setTitle", "three"));
console.log("afterwards: " + state(b));

const c = new Printer();
attempt("a number for the method that takes a string", () => invoke<number | string, "setCopies" | "setTitle">(c, yes ? "setTitle" : "setCopies", 3));
console.log("afterwards: " + state(c));

const h = new Printer();
attempt("each gets what it takes", () => [invoke<number | string, "setCopies">(h, "setCopies", 2), invoke<number | string, "setTitle">(h, "setTitle", " x "), state(h)]);

const d = new Printer();
attempt("a string is added", () => add<number | string>(d, "1"));
attempt("a string is added: typeof", () => typeof add<number | string>(d, "1"));
attempt("null is added", () => add<number | null>(d, null));
attempt("undefined is added", () => add<number | undefined>(d, undefined));
attempt("an object with valueOf is added", () => add<number | { valueOf(): number }>(d, { valueOf: () => 41 }));

const e = new Printer();
attempt("both methods get a number", () => invokeAll<number | string>(e, ["setCopies", "setTitle"], 4));
console.log("afterwards: " + state(e));
const f = new Printer();
attempt("both methods get a string", () => invokeAll<number | string>(f, ["setTitle", "setCopies"], " s "));
console.log("afterwards: " + state(f));
attempt("honest again", () => [warm.setCopies(1), warm.setTitle("z"), add(warm, 1), state(warm)]);

export {};
