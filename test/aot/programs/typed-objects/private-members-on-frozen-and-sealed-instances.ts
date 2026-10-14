// Private fields and methods on frozen and sealed instances.
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
class P {
  #f = 1
  #m() { return "m" + this.#f }
  get #g() { return "g" + this.#f }
  set #g(v: string) { this.#f = v.length }
  callM() { return this.#m() }
  readG() { return this.#g }
  writeG(v: string) { this.#g = v; return this.#f }
  readM() { return typeof this.#m }
  static peek(o: any) { return o.#f }
  static poke(o: any, v: number) { o.#f = v; return o.#f }
}
const p = new P()
console.log(p.callM(), p.readG(), p.writeG("abc"), p.readM(), P.peek(p), P.poke(p, 9))
Object.freeze(p)
console.log(attempt(() => p.callM()), attempt(() => p.readG()), attempt(() => p.writeG("abcd")), attempt(() => p.readM()), attempt(() => P.peek(p)), attempt(() => P.poke(p, 7)))
const foreign: any = {}
console.log(attempt(() => P.prototype.callM.call(foreign)), attempt(() => P.prototype.readG.call(foreign)), attempt(() => P.prototype.writeG.call(foreign, "x")), attempt(() => P.prototype.readM.call(foreign)), attempt(() => P.peek(foreign)), attempt(() => P.poke(foreign, 1)), Object.keys(foreign).length)
console.log(Object.getOwnPropertyNames(P.prototype).join(), Reflect.ownKeys(p).join())
