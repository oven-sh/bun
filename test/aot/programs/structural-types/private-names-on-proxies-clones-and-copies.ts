function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
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

class Safe {
  #code = 1234;
  #tries = 0;
  static #opened = 0;
  label = "safe";
  #check(guess: number): boolean {
    return guess === this.#code;
  }
  get #hint(): number {
    return this.#code % 10;
  }
  open(guess: number): boolean {
    this.#tries++;
    if (this.#check(guess)) Safe.#opened++;
    return this.#check(guess);
  }
  tries(): number {
    return this.#tries;
  }
  hint(): number {
    return this.#hint;
  }
  reset(code: number): number {
    this.#code = code;
    return this.#code;
  }
  sameCode(other: Safe): boolean {
    return this.#code === other.#code;
  }
  static isSafe(value: object): boolean {
    return #code in value;
  }
  static opened(): number {
    return Safe.#opened;
  }
  static peek(safe: Safe): number {
    return safe.#code;
  }
}

function open(safe: Safe): boolean {
  return safe.open(1234);
}

function peek(safe: Safe): number {
  return Safe.peek(safe);
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = new Safe();
  warm += (open(honest) ? 1 : 0) + peek(honest) + honest.tries() + honest.hint() + honest.reset(i) + (honest.sameCode(honest) ? 1 : 0) + (Safe.isSafe(honest) ? 1 : 0);
}
console.log("after 2000 honest safes", warm, Safe.opened());

function bare(): Safe {
  return Object.create(Safe.prototype);
}
function child(): Safe {
  return Object.create(new Safe());
}
function parsed(): Safe {
  return JSON.parse(JSON.stringify(new Safe()));
}
function dressed(): Safe {
  return Object.setPrototypeOf({ label: "dressed" }, Safe.prototype);
}
function unwrapping(): Safe {
  const target = new Safe();
  return new Proxy(target, {
    get(inner, key) {
      const member: unknown = Reflect.get(inner, key, inner);
      return typeof member === "function" ? member.bind(inner) : member;
    },
  });
}

const makers: [string, () => Safe][] = [
  ["an instance", () => new Safe()],
  ["a proxy", () => new Proxy(new Safe(), {})],
  ["a proxy that binds methods to its target", unwrapping],
  ["a structured clone", () => structuredClone(new Safe())],
  ["the bare prototype", bare],
  ["a child of an instance", child],
  ["an assigned copy", () => Object.assign({}, new Safe())],
  ["an assigned copy with the prototype", () => Object.assign(bare(), new Safe())],
  ["a parsed copy", parsed],
  ["a literal with the prototype", dressed],
];
for (const [name, make] of makers) {
  attempt(name + ": label", () => make().label);
  attempt(name + ": open", () => open(make()));
  attempt(name + ": tries", () => make().tries());
  attempt(name + ": hint", () => make().hint());
  attempt(name + ": reset", () => make().reset(1));
  attempt(name + ": peek", () => peek(make()));
  attempt(name + ": the brand", () => Safe.isSafe(make()));
  attempt(name + ": compared by an instance", () => new Safe().sameCode(make()));
  attempt(name + ": compares an instance", () => make().sameCode(new Safe()));
  attempt(name + ": instanceof", () => make() instanceof Safe);
  attempt(name + ": keys", () => Object.keys(make()));
}
attempt("an instance's method on a proxy", () => new Safe().open.call(new Proxy(new Safe(), {}), 1234));
attempt("a proxy's method on an instance", () => new Proxy(new Safe(), {}).open.call(new Safe(), 1234));
attempt("how far open got on a proxy", () => {
  const target = new Safe();
  try {
    new Proxy(target, {}).open(1234);
  } catch {}
  return target.tries();
});
attempt("honest again", () => [open(new Safe()), peek(new Safe())]);
