// ES5-style constructor functions whose interface declares the members of `F.prototype`.
function rule(label: string, f: () => unknown) { try { console.log(label + ": no error", f()) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) } }
function send(o: any, name: string, ...args: unknown[]): any { return o[name](...args) }
function get(o: any, name: string): any { return o[name] }
interface Pt { x: number; y: number; norm(): number; scale?(k: number): Pt; label?: string }
function Pt(this: Pt, x: number, y: number) { this.x = x; this.y = y }
Pt.prototype.norm = function (this: Pt) { return Math.abs(this.x) + Math.abs(this.y) }
const PtCtor = Pt as unknown as new (x: number, y: number) => Pt
const p = new PtCtor(3, -4)
rule("method on F.prototype called by typed code", () => p.norm())
Pt.prototype.scale = function (this: Pt, k: number) { return new PtCtor(this.x * k, this.y * k) }
Pt.prototype.label = "shared"
console.log(typeof p.norm, p.scale, p.scale?.(2), p.label, "|", send(p, "norm"), typeof get(p, "scale"), JSON.stringify(send(p, "scale", 2)), get(p, "label"))
p.label = "own"
console.log(p.label, get(p, "label"), delete p.label, p.label, get(p, "label"))
rule("Object.create(F.prototype) as the type", () => { const created: Pt = Object.create(Pt.prototype); Pt.apply(created, [7, 8]); return created.x })
rule("the function applied to such an object", () => { const created: any = Object.create(Pt.prototype); Pt.apply(created, [7, 8]); return created.x })
