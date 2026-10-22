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

type Entry = [number, string];

function readTwice(view: readonly [number, string], between: () => void): string {
  const before = view[0] + 1;
  const nameBefore = view[1].length;
  const lengthBefore = view.length;
  between();
  return show(before) + " " + nameBefore + " " + lengthBefore + " then " + typeof view[0] + " " + show(view[0]) + " " + typeof view[1] + " " + show(view[1]) + " " + view.length;
}

function sumTwice(view: readonly number[], between: () => void): string {
  let before = 0;
  for (let i = 0; i < view.length; i++) before += view[i];
  between();
  let after = 0;
  for (let i = 0; i < view.length; i++) after += view[i];
  return before + " then " + show(after) + " length " + view.length;
}

class Holder {
  readonly entry: readonly [number, string];
  constructor(entry: readonly [number, string]) {
    this.entry = entry;
  }
  next(): number {
    return this.entry[0] + 1;
  }
  shout(): string {
    return this.entry[1].toUpperCase();
  }
}

let total = 0;
for (let i = 0; i < 2000; i++) {
  const entry: Entry = [i, "n"];
  total += readTwice(entry, () => {}).length + new Holder(entry).next() + sumTwice([i, 1], () => {}).length;
}
console.log("2000 honest rounds: " + total);

function study(title: string, change: (entry: Entry) => void): void {
  attempt(title, () => {
    const entry: Entry = [1, "a"];
    return readTwice(entry, () => change(entry));
  });
  attempt(title + ": in a field", () => {
    const entry: Entry = [1, "a"];
    const holder = new Holder(entry);
    const before = holder.next() + holder.shout();
    change(entry);
    return [before, holder.next()];
  });
  attempt(title + ": in a field, the string", () => {
    const entry: Entry = [1, "a"];
    const holder = new Holder(entry);
    change(entry);
    return holder.shout();
  });
}

study("nothing", () => {});
study("honest stores", entry => {
  entry[0] = 5;
  entry[1] = "five";
});
study("reversed", entry => entry.reverse());
study("popped", entry => entry.pop());
study("shifted", entry => entry.shift());
study("pushed to", entry => entry.push(3));
study("filled", entry => entry.fill("x"));
study("emptied", entry => entry.splice(0));

attempt("a readonly list is cut", () => {
  const list = [1, 2, 3];
  return sumTwice(list, () => (list.length = 1));
});
attempt("a readonly list is made longer", () => {
  const list = [1, 2, 3];
  return sumTwice(list, () => (list.length = 5));
});
attempt("a readonly list is pushed to", () => {
  const list = [1, 2, 3];
  return sumTwice(list, () => list.push(0.5));
});

export {};
