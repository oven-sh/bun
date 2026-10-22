// Turning a field of a typed object into an accessor, making it non-enumerable, or deleting a required field succeeds, as every change JavaScript allows does, and typed code sees the change.
interface Command { name: string; description: string; hidden: boolean; count: number }
function lazy(target: object, key: string, make: () => unknown) {
  Object.defineProperty(target, key, { get: make, enumerable: true, configurable: true })
}
let calls = 0
function command(name: string, dynamic: boolean): Command {
  const made: Command = { name, description: dynamic ? "" : "static " + name, hidden: false, count: 1 }
  if (dynamic) try { lazy(made, "description", () => "made " + name + " " + ++calls); console.log("getter: no error") } catch (e) { console.log("getter:", e instanceof TypeError ? "TypeError" : "other " + e) }
  return made
}
const a = command("a", true), b = command("b", false)
console.log(JSON.stringify(a.description), b.description, calls, Object.keys(a).join(), JSON.stringify(a))
try { Object.defineProperty(b, "hidden", { enumerable: false }); console.log("not enumerable: no error") } catch (e) { console.log("not enumerable:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(Object.keys(b).join(), b.hidden, JSON.stringify(b))
let stored = 0
try { Object.defineProperty(a, "count", { get: () => stored, set: v => { stored = v * 10 }, enumerable: true, configurable: true }); console.log("getter and setter: no error") } catch (e) { console.log("getter and setter:", e instanceof TypeError ? "TypeError" : "other " + e) }
a.count = 4
console.log(a.count, stored, typeof Object.getOwnPropertyDescriptor(a, "count")!.get)
try { delete (a as any).count; console.log("delete of a required field: no error") } catch (e) { console.log("delete of a required field:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log("count" in a, Object.keys(a).join())
class Point { x = 1; y = 2; sum() { return this.x + this.y } }
const p = new Point()
try { Object.defineProperty(p, "x", { get: () => 40, configurable: true }); console.log("getter on an instance: no error") } catch (e) { console.log("getter on an instance:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(p.sum(), p.x, Object.keys(p).join())
