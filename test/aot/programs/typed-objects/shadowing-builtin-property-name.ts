// An own property with the name of a built-in method (`toString`, `valueOf` ..) on an object that the program created.
function attempt(label: string, f: () => unknown) { try { console.log(label, String(f())) } catch (e) { console.log(label, (e as Error).constructor.name) } }
function anySet(o: any, k: PropertyKey, v: unknown) { o[k] = v }
interface Rec { e?: number }
interface View { e?: number; toString?: () => string }
function make(flag: boolean): Rec { return flag ? { e: 1 } : { e: 2 } }
attempt("1", () => { const o = make(true); const v: View = o; v.toString = undefined; return Object.keys(o) })
attempt("2", () => { const o = make(true); const v: View = o; v.toString = () => "own"; return String(o) + Object.keys(o) })
attempt("3", () => { const o = make(true); const v: View = o; delete v.toString; v.toString = () => "own"; return String(o) + Object.keys(o) })
attempt("4", () => { const o = make(true); return Reflect.set(o, "constructor", true, Object.create(o)) })
attempt("5", () => { const o = make(true); const d = Object.create(o); d.constructor = true; d.toString = () => "d"; return String(d) + Object.keys(d) })
attempt("6", () => { const p: any = new Proxy<Rec>({ e: 1 }, {}); p.toString = 1; return Object.keys(p) })
attempt("7", () => { const o = make(true); anySet(o, "toString", 1); anySet(o, "valueOf", o); return Object.keys(o) })
attempt("8", () => { const o = make(true); return Reflect.set(o, "toString", 1) + " " + Object.keys(o) })
attempt("9", () => { const o = make(true); return Reflect.set(o, "toString", 1, {}) })
attempt("10", () => { const o: any = { plain: 1 }; return Reflect.set(o, "constructor", true, Object.create(o)) })
attempt("11", () => { const p: any = new Proxy({ plain: 1 } as any, {}); p.toString = 1; return Object.keys(p) })
attempt("12", () => { const o = make(true); Object.defineProperty(o, "toString", { value: () => "defined", configurable: true }); return String(o) })
class K { e = 1 }
attempt("13", () => { const o = new K(); const v: View = o; v.toString = () => "own"; return String(o) + Object.keys(o) })
attempt("14", () => { const o = new K(); return Reflect.set(o, "constructor", true, Object.create(o)) })
attempt("15", () => { const o = new K(); anySet(o, "hasOwnProperty", 1); return Object.keys(o) })
