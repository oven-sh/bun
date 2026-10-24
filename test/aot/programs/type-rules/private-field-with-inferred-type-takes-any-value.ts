// A private field without a written type takes a value of any kind through `any`: an inferred type tests nothing. The field stays writable on a frozen object.
class P {
  #f = 1
  #m() { return "m" + this.#f }
  callM() { return this.#m() }
  static poke(o: any, v: number) { o.#f = v; return o.#f }
  static pokeString(o: any) { o.#f = "str"; return o.#f }
}
const p = new P()
try { console.log(P.pokeString(p)); console.log("a string stored to a private number field: no error") } catch (e) { console.log("a string stored to a private number field:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(p.callM(), P.poke(p, 7), p.callM())
// `#f` stays writable on a frozen object.
Object.freeze(p)
try { console.log(P.pokeString(p)); console.log("the same, frozen: no error") } catch (e) { console.log("the same, frozen:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(P.poke(p, 9), p.callM())
