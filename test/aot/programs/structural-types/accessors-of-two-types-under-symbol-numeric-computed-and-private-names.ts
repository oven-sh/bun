function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(text).join(", ") + "]";
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

const key = Symbol("size");
const spelled = "computed";

class Box {
  kept = 1;
  get [key](): number {
    return this.kept;
  }
  set [key](value: number | string) {
    this.kept = typeof value === "string" ? value.length : value;
  }
  get [spelled](): number {
    return this.kept * 10;
  }
  set [spelled](value: number | string) {
    this.kept = typeof value === "string" ? value.length * 10 : value;
  }
  get 0(): number {
    return this.kept * 100;
  }
  set 0(value: number | string) {
    this.kept = typeof value === "string" ? value.length * 100 : value;
  }
  get "two words"(): number {
    return this.kept * 1000;
  }
  set "two words"(value: number | string) {
    this.kept = typeof value === "string" ? value.length * 1000 : value;
  }
  get #hidden(): number {
    return this.kept + 0.5;
  }
  set #hidden(value: number | string) {
    this.kept = typeof value === "string" ? -value.length : value;
  }
  hidden(value: number | string): unknown {
    this.#hidden = value;
    const first = this.#hidden;
    this.#hidden += 1;
    this.#hidden++;
    return [first, this.#hidden, this.kept];
  }
  static #shared = 1;
  static get #count(): number {
    return Box.#shared;
  }
  static set #count(value: number | string) {
    Box.#shared = typeof value === "string" ? value.length : value;
  }
  static count(value: number | string): unknown {
    Box.#count = value;
    return [Box.#count, (Box.#count += 1)];
  }
}

attempt("a symbol key", () => {
  const b = new Box();
  const store = (value: number | string): void => {
    b[key] = value;
  };
  store("four");
  const first = b[key];
  b[key] = b[key] + 1;
  b[key] = b[key] + 1;
  return [first, b[key], b.kept];
});
attempt("a computed name", () => {
  const b = new Box();
  const store = (value: number | string): void => {
    b[spelled] = value;
  };
  store("four");
  const first = b.computed;
  b.computed += 1;
  return [first, b[spelled], b.kept];
});
attempt("a numeric name", () => {
  const b = new Box();
  b[0] = "four";
  const first = b[0];
  b["0"] = 2;
  return [first, b[0], b.kept];
});
attempt("a quoted name", () => {
  const b = new Box();
  const store = (value: number | string): void => {
    b["two words"] = value;
  };
  store("four");
  const first = b["two words"];
  b["two words"] = b["two words"] - 1;
  return [first, b["two words"], b.kept];
});
attempt("a private name, a string", () => new Box().hidden("four"));
attempt("a private name, a number", () => new Box().hidden(4));
attempt("a static private name", () => [Box.count("four"), Box.count(1)]);
attempt("own keys", () => Reflect.ownKeys(new Box()).map(String));
attempt("keys of the prototype", () => Reflect.ownKeys(Box.prototype).map(String));
let sum = 0;
const shared = new Box();
for (let i = 0; i < 2000; i++) {
  shared[key] = i % 2 === 0 ? i : "ab";
  sum += shared[key] + shared[0];
}
console.log("2000 rounds: " + sum);
