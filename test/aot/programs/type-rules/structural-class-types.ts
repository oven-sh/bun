// A method is borrowed for object literals that have only the fields the method reads.
class Vec {
  x: number; y: number
  constructor(x: number, y: number) { this.x = x; this.y = y }
  len2(): number { return this.x * this.x + this.y * this.y }
  get sum(): number { return this.x + this.y }
}
const real = new Vec(1, 2)
try { const made: Vec = Object.create(Vec.prototype); made.x = 5; console.log("Object.create(C.prototype) as a C: no error") } catch (e) { console.log("Object.create(C.prototype) as a C:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { const heir: Vec = Object.create(real); console.log("heir of an instance as a C: no error", heir.x) } catch (e) { console.log("heir of an instance as a C:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { const parsed = JSON.parse('{"y":9,"x":8}') as Vec; console.log("parsed text without the methods as a C: no error", parsed.x) } catch (e) { console.log("parsed text without the methods as a C:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { const copied: Vec = Object.assign({}, real); console.log("copy of the own properties as a C: no error", copied.x) } catch (e) { console.log("copy of the own properties as a C:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(Vec.prototype.len2.call({ x: 2, y: 3 })); console.log("method on a literal with the fields it reads: no error") } catch (e) { console.log("method on a literal with the fields it reads:", e instanceof TypeError ? "TypeError" : "other " + e) }
const getSum = Object.getOwnPropertyDescriptor(Vec.prototype, "sum")!.get!
try { console.log(getSum.call({ x: 1, y: 1 })); console.log("getter on a literal with the fields it reads: no error") } catch (e) { console.log("getter on a literal with the fields it reads:", e instanceof TypeError ? "TypeError" : "other " + e) }
const borrowed = { x: 0.5, y: 0.25, len2: Vec.prototype.len2 }
try { console.log(borrowed.len2()); console.log("method borrowed by a literal: no error") } catch (e) { console.log("method borrowed by a literal:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { (real as any).len2 = () => 999; console.log("own property in place of a method: no error") } catch (e) { console.log("own property in place of a method:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(real.len2(), real.sum, getSum.call(real), Object.keys(real).join())
