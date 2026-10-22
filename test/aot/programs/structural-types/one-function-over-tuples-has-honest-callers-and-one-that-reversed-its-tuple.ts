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

function weigh(entry: Entry): number {
  return entry[0] * 2 + entry[1].length;
}

function label(entry: Entry): string {
  const [count, name] = entry;
  return name.toUpperCase() + count.toFixed(1);
}

class Shelf {
  top: Entry = [1, "top"];
  all: Entry[] = [
    [1, "a"],
    [2, "b"],
  ];
  weight(): number {
    let sum = weigh(this.top);
    for (const entry of this.all) sum += weigh(entry);
    return sum;
  }
}

function fromALocal(i: number): number {
  const entry: Entry = [i, "local"];
  return weigh(entry);
}

function fromAParameter(entry: Entry): number {
  return weigh(entry);
}

function fromAClosure(entry: Entry): () => number {
  return () => weigh(entry);
}

function theOddOne(entry: Entry): number {
  entry.reverse();
  return weigh(entry);
}

function theOddLabel(entry: Entry): string {
  entry.reverse();
  return label(entry);
}

const shelf = new Shelf();
let total = 0;
for (let i = 0; i < 2000; i++) total += fromALocal(i) + fromAParameter([i, "p"]) + fromAClosure([i, "c"])() + shelf.weight() + label([i, "l"]).length;
console.log("2000 honest rounds: " + total);

attempt("the odd caller", () => theOddOne([1, "abc"]));
attempt("the odd caller: the label", () => theOddLabel([1, "abc"]));
attempt("honest callers afterwards", () => [fromALocal(1), fromAParameter([1, "p"]), fromAClosure([1, "c"])(), shelf.weight(), label([1, "l"])]);

shelf.top.reverse();
attempt("the tuple in a field is reversed", () => shelf.weight());
shelf.top.reverse();
shelf.all[1].reverse();
attempt("a tuple that is an element is reversed", () => shelf.weight());
attempt("a tuple that is an element is reversed: labels", () => shelf.all.map(label));
shelf.all[1].reverse();
attempt("both are put back", () => [shelf.weight(), shelf.all.map(label)]);

const captured: Entry = [4, "four"];
const later = fromAClosure(captured);
attempt("a captured tuple", () => later());
captured.reverse();
attempt("a captured tuple is reversed", () => later());
captured.pop();
attempt("and popped", () => later());
captured.pop();
attempt("and popped again", () => later());

export {};
