// Frozen instances of classes with private fields, accessors and setters.
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
class Wrapped { #v = 0; raw = 0; get v() { return this.#v } set v(x: number) { this.#v = x } set r(x: number) { this.raw = x } }
const wrapped = new Wrapped()
Object.freeze(wrapped)
console.log(attempt(() => (wrapped.v = 5)), wrapped.v, attempt(() => (wrapped.r = 5)), wrapped.raw)
