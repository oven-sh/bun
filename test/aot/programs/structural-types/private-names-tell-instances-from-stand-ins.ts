function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + String(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Safe {
  #code = 42;
  label = "safe";
  static is(value: object): boolean {
    return #code in value;
  }
  static codeOf(safe: Safe): number {
    return safe.#code;
  }
  static reset(safe: Safe): void {
    safe.#code = 0;
  }
  same(other: Safe): boolean {
    return this.#code === other.#code;
  }
  open(): number {
    return this.#code;
  }
  #hidden(): string {
    return "hidden " + this.label;
  }
  reveal(other: Safe): string {
    return other.#hidden();
  }
}

class Vault extends Safe {
  label = "vault";
}

const real = new Safe();
const sub: Safe = new Vault();
const proxied: Safe = new Proxy(new Safe(), {});
const created: Safe = Object.create(Safe.prototype);
const cloned: Safe = structuredClone(new Safe());
const assigned: Safe = Object.assign(Object.create(Safe.prototype), new Safe());

const table: [string, Safe][] = [
  ["an instance", real],
  ["a subclass instance", sub],
  ["a proxy of an instance", proxied],
  ["an object with the prototype", created],
  ["a structured clone", cloned],
  ["the prototype and the public members", assigned],
];

for (const [name, safe] of table) {
  attempt(name + ", has the private name", () => Safe.is(safe));
  attempt(name + ", instanceof", () => safe instanceof Safe);
  attempt(name + ", label", () => safe.label);
  attempt(name + ", read by a static method", () => Safe.codeOf(safe));
  attempt(name + ", read by its own method", () => safe.open());
  attempt(name + ", compared by a real one", () => real.same(safe));
  attempt(name + ", private method", () => real.reveal(safe));
  attempt(name + ", stored by a static method", () => Safe.reset(safe));
}

let sum = 0;
for (let i = 0; i < 2000; i++) sum += Safe.codeOf(sub) + (real.same(sub) ? 1 : 0);
console.log("2000 honest reads: " + sum);
attempt("then the proxy", () => Safe.codeOf(proxied));
attempt("then the bare object", () => Safe.codeOf(created));
attempt("then an instance", () => Safe.codeOf(new Safe()));

class Returns {
  constructor(target: object) {
    return target;
  }
}

class Stamp extends Returns {
  #mark = "stamped";
  static read(value: Stamp): string {
    return value.#mark;
  }
  static has(value: object): boolean {
    return #mark in value;
  }
}

const plain = { own: 1 };
console.log("before the stamp: " + Stamp.has(plain));
const stamped = new Stamp(plain);
console.log("after the stamp: " + Stamp.has(plain) + " " + Stamp.read(stamped));
console.log("the result is the plain object: " + (Object.is(stamped, plain)) + " " + (stamped instanceof Stamp) + " " + JSON.stringify(stamped));
attempt("a second stamp on one object", () => new Stamp(plain));
attempt("a stamp on a frozen object", () => Stamp.has(new Stamp(Object.freeze({}))));

export {};
