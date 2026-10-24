// Private fields on frozen objects.
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
class P {
  #f = 1
  pub = 2
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
console.log(attempt(() => p.callM()), attempt(() => p.readG()), attempt(() => p.writeG("abcd")), attempt(() => p.readM()), attempt(() => P.peek(p)), attempt(() => P.poke(p, 7)), attempt(() => p.callM()))
const foreign: any = {}
console.log(attempt(() => P.peek(foreign)), attempt(() => P.poke(foreign, 1)), Object.keys(foreign).length)
console.log(Object.getOwnPropertyNames(Object.getPrototypeOf(p)).join(), Reflect.ownKeys(p).join())
const q = new P()
const method: any = q.callM, reader: any = q.readG, writer: any = q.writeG
console.log(attempt(() => method.call(foreign)), attempt(() => reader.call(foreign)), attempt(() => writer.call(foreign, "x")), Object.keys(foreign).length)
