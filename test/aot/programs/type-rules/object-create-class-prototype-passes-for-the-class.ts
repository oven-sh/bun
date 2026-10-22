// An object created with `Object.create(C.prototype)` and filled with `Object.assign` passes wherever the class `C` is the declared type, and the methods of the class take it for `this`.
class Order { id: number; lines: number[] = []; constructor(id: number) { this.id = id } total() { return this.lines.reduce((x, y) => x + y, 0) } }
function clone<T extends object>(o: T): T { return Object.assign(Object.create(Object.getPrototypeOf(o)), o) }
const order = new Order(4)
order.lines.push(1, 2.5)
try { const cloned = clone(order); console.log("clone of an instance: no error", cloned.id) } catch (e) { console.log("clone of an instance:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { const cloned: Order = Object.assign(Object.create(Order.prototype), order); console.log("the same to a variable: no error", cloned.id) } catch (e) { console.log("the same to a variable:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { const cloned = Object.assign(Object.create(Order.prototype), order) as Order; console.log("the same with as: no error", cloned.id) } catch (e) { console.log("the same with as:", e instanceof TypeError ? "TypeError" : "other " + e) }
// Through `any`: it is an instance by `instanceof`, and a method of the class runs on it.
const loose: any = Object.assign(Object.create(Order.prototype), order)
console.log(loose instanceof Order, loose.id, Object.keys(loose).join(), order.total())
try { console.log("a method on it: no error", loose.total()) } catch (e) { console.log("a method on it:", e instanceof TypeError ? "TypeError" : "other " + e) }
