function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": " + failure(error));
  }
}

let seen: string[] = [];

function size(item: string): number;
function size(item: number[]): number;
function size(item: string | number[], unit?: string, options?: { exact: boolean }): number | string {
  seen.push("item " + text(item) + ", unit " + text(unit) + ", options " + (Array.isArray(options) ? "a list of " + options.length : text(options)));
  if (unit === undefined) return item.length;
  return item.length + unit;
}

function shout(word: string): string;
function shout(word: string, mark?: string): string {
  seen.push("word " + text(word) + ", mark " + text(mark));
  return mark === undefined ? word.toUpperCase() : word.toUpperCase() + mark.repeat(2);
}

class Store {
  items: string[] = [];
  add(item: string): number;
  add(item: string, at?: string): number {
    seen.push("item " + text(item) + ", at " + text(at));
    if (at !== undefined) this.items.push(at + ":" + item);
    else this.items.push(item);
    return this.items.length;
  }
}

class Tag {
  name: string;
  secret: string;
  constructor(name: string);
  constructor(name: string, secret: string = "none") {
    this.name = name;
    this.secret = secret;
  }
}

function flush(): string {
  const out = seen.join(" ; ");
  seen = [];
  return out;
}

attempt("size of a text", () => size("abc") + 1);
attempt("size of a list", () => size([1, 2]) + 1);
console.log("  " + flush());

attempt("map size over texts", () => ["ab", "c", "def"].map(size).map(text));
console.log("  " + flush());
attempt("map size over lists", () => [[1], [2, 3]].map(size).map(text));
console.log("  " + flush());
attempt("the results are summed", () => {
  let sum = 0;
  for (const n of ["ab", "c"].map(size)) sum += n;
  return sum;
});
flush();

attempt("honest shout", () => shout("a"));
attempt("map shout", () => ["a", "b"].map(shout));
console.log("  " + flush());
attempt("replace with shout", () => "x-y".replace("-", shout));
console.log("  " + flush());

const store = new Store();
attempt("honest add", () => store.add("first"));
attempt("forEach add", () => ["x", "y"].forEach(store.add, store));
attempt("the store", () => store.items);
console.log("  " + flush());

attempt("honest tag", () => new Tag("t"));
function build<T>(type: new (name: string, index: number) => T, names: string[]): T[] {
  return names.map((name, index) => new type(name, index));
}
attempt("tags built with an index", () => build(Tag, ["a", "b"]).map(tag => tag.name + " " + text(tag.secret) + " " + text(tag.secret.length)));

let warm = 0;
for (let i = 0; i < 2000; i++) warm += size("abc") + size([i]) + shout("q").length;
seen = [];
console.log("2000 honest calls: " + warm);
attempt("map size after them", () => ["ab", "c"].map(size).map(text));
attempt("map shout after them", () => ["a", "b"].map(shout));
