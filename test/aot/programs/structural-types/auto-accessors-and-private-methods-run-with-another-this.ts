function show(title: string, run: () => unknown): void {
  let result: string;
  try {
    const value = run();
    result = typeof value + " " + (Object.is(value, -0) ? "-0" : String(value));
  } catch (error) {
    result = error instanceof TypeError ? "threw a TypeError" : error instanceof ReferenceError ? "threw a ReferenceError" : "threw something else";
  }
  console.log(title + ": " + result);
}

class Vault {
  accessor level: number = 5;
  static accessor opened: number = 0;
  #code: number = 1234;
  #twice(): number {
    return this.#code * 2;
  }
  get #half(): number {
    return this.#code / 2;
  }
  static #count: number = 0;
  readLevel(): number {
    return this.level;
  }
  storeLevel(): number {
    this.level = 6;
    return this.level;
  }
  twice(): number {
    return this.#twice();
  }
  half(): number {
    return this.#half;
  }
  has(): boolean {
    return #code in this;
  }
  sameCode(other: Vault): boolean {
    return this.#code === other.#code;
  }
  static count(): number {
    return ++this.#count;
  }
  static open(): number {
    return ++this.opened;
  }
}
class Sub extends Vault {}

const vault = new Vault();
const like = { level: 50 };

show("honest readLevel", () => vault.readLevel());
show("bare readLevel", () => (0, vault.readLevel)());
show("readLevel on a look-alike", () => vault.readLevel.call(like));
show("storeLevel on a look-alike", () => vault.storeLevel.call(like) + " " + like.level + " " + vault.level);
show("readLevel on an object made from the prototype", () => vault.readLevel.call(Object.create(Vault.prototype)));
show("storeLevel on an object made from the prototype", () => vault.storeLevel.call(Object.create(Vault.prototype)));
show("readLevel on a child of the vault", () => vault.readLevel.call(Object.create(vault)));
show("readLevel on a proxy of a vault", () => vault.readLevel.call(new Proxy(new Vault(), {})));
show("twice", () => vault.twice());
show("bare twice", () => (0, vault.twice)());
show("twice on a look-alike", () => vault.twice.call(like));
show("twice on another vault", () => vault.twice.call(new Vault()));
show("twice on a subclass instance", () => vault.twice.call(new Sub()));
show("twice on a proxy of a vault", () => vault.twice.call(new Proxy(new Vault(), {})));
show("half on a look-alike", () => vault.half.call(like));
show("has", () => vault.has());
show("has on a look-alike", () => vault.has.call(like));
show("has on a proxy of a vault", () => vault.has.call(new Proxy(new Vault(), {})));
show("has on a number", () => vault.has.call(5));
show("bare has", () => (0, vault.has)());
show("sameCode", () => vault.sameCode(new Vault()));
show("sameCode on a look-alike", () => vault.sameCode.call(like, vault));
show("sameCode with something made from the prototype", () => vault.sameCode(Object.create(Vault.prototype)));
show("static count", () => Vault.count());
show("static count on the subclass", () => Sub.count());
show("bare static count", () => (0, Vault.count)());
show("static open", () => Vault.open());
show("static open on the subclass", () => Sub.open());
show("static open on a look-alike", () => Vault.open.call({ opened: 10 }));
