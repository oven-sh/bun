// Private fields, methods and accessors: a public property with the same spelling is unrelated, look-alike objects are rejected, and freezing does not affect private fields.
// #private names, TypeScript's `private`, parameter properties and statics, on objects also seen through interfaces, `any`, proxies and Object.create.
interface Owned { owner: string; level: number }
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
class Vault implements Owned {
  static #made = 0
  static count() { return Vault.#made }
  static isVault(o: object): o is Vault { return #secret in o }
  static peek(o: Vault): number { return o.#secret }
  #secret: number
  #log: string[] = []
  private soft = "soft"
  protected guard = true
  constructor(secret: number, public owner: string, readonly level: number = 1) { this.#secret = secret; Vault.#made++ }
  reveal(): number { this.#log.push("r"); return this.#secret }
  bump(by: number): this { this.#secret += by; this.#log.push("b"); return this }
  get history(): string { return this.#log.join("") }
  #hidden(): number { return this.#secret * 2 }
  twice(): number { return this.#hidden() }
  equals(o: Vault): boolean { return this.#secret === o.#secret }
  softly(): string { return this.soft + this.guard }
}
class Deep extends Vault {
  #secret = "deep"
  both(): string { return this.#secret + this.reveal() }
  static isDeep(o: object): boolean { return #secret in o }
}
const v = new Vault(7, "ann", 2), w = new Vault(7, "bob"), d = new Deep(1, "cy")
console.log(v.reveal(), v.bump(3).bump(0.5).reveal(), v.twice(), v.history, v.equals(w), w.equals(w), Vault.count(), v.softly())
console.log(Object.keys(v).join(), JSON.stringify(v), JSON.stringify(d), Object.getOwnPropertyNames(v).length, Reflect.ownKeys(d).length)
console.log(d.both(), Vault.peek(d), Vault.isVault(d), Deep.isDeep(d), Deep.isDeep(v), d.equals(new Vault(1, "x")))
// A property by the same spelling is another thing.
const loose: any = v
console.log(loose["#secret"], "#secret" in loose, loose.soft, loose.guard)
loose["#secret"] = "public"
console.log(v.reveal(), loose["#secret"], Object.keys(v).join())
delete loose["#secret"]
// Objects that look like a Vault but were not made by its constructor, held as what they are. (Held as a Vault or an Owned: type-rules/private-members.)
const heir: any = Object.create(v)
const wrapped: any = new Proxy(v as object, {})
const fake: any = { owner: "f", level: 0 }
console.log(heir.owner, heir.level, attempt(() => heir.reveal()), attempt(() => wrapped.reveal()), attempt(() => Vault.peek(fake)), attempt(() => v.equals(fake)))
console.log(attempt(() => Vault.prototype.twice.call(fake)), attempt(() => wrapped.history), attempt(() => heir.bump(1)), wrapped.owner)
console.log(Vault.isVault(heir), Vault.isVault(wrapped), Vault.isVault(fake), Vault.isVault({}), Vault.isVault(v), v.history)
// Freezing does not reach private names.
Object.freeze(w)
console.log(w.bump(1).reveal(), attempt(() => { w.owner = "z" }), w.owner, w.history, Object.isFrozen(w))
function ownerOf(o: Owned): string { return o.owner + o.level }
const owners: Owned[] = [v, w, d, { owner: "lit", level: 9 }]
console.log(owners.map(o => ownerOf(o)).join())
for (const o of owners) if (!Object.isFrozen(o)) o.owner += "'"
console.log(owners.map(o => ownerOf(o)).join())
// Private accessors and private static methods.
class Meter {
  #n = 0
  get #next(): number { return ++this.#n }
  set #next(x: number) { this.#n = x * 2 }
  tick(): number { return this.#next }
  reset(x: number): number { this.#next = x; return this.#n }
  static #helper(m: Meter): number { return m.#n + 100 }
  static read(m: Meter): number { return Meter.#helper(m) }
}
const meter = new Meter()
console.log(meter.tick(), meter.tick(), meter.reset(5), meter.tick(), Meter.read(meter), attempt(() => Meter.read({} as Meter)), Object.keys(meter).length)
// A private field that is read, through a method, before the constructor has stored to it.
class Early {
  #value: number
  #text = "t"
  first: string
  constructor(value: number) { this.first = this.show(); this.#value = value }
  show(): string { return String(this.#value) + this.#text }
}
const early = new Early(4)
console.log(early.first, early.show(), JSON.stringify(early))
let sum = 0
const vaults = [v, d, new Vault(0.5, "n"), new Deep(2, "m")]
for (let i = 0; i < 80; i++) sum += vaults[i % 4].bump(i % 3).reveal() + Vault.peek(vaults[(i + 1) % 4])
console.log(sum, vaults.map(x => x.history.length).join())
