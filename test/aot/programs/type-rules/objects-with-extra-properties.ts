// Objects with more properties than the type through which they are used.
interface Narrow { id: number }
function keysOf(x: Narrow): string { return Object.keys(x).join() }
function copy(x: Narrow): Narrow { return { ...x } }
function json(x: Narrow): string { return JSON.stringify(x) }
class Row { id = 2; cells = ["a"]; hidden?: string; constructor(public owner: string) {} width() { return this.cells.length } }
const row = new Row("r")
// ECMAScript: z,id,a / owner,id,cells,hidden / {"owner":"r","id":-1,"cells":["a"]} / id,secret,at,extra.
const foreign: Narrow = JSON.parse('{"z":0,"id":5,"a":[{"id":6}]}')
console.log(keysOf(foreign), json(foreign))
console.log(keysOf(row), keysOf(copy(row)), json({ ...(row as Narrow), id: -1 }))
function build(id: number): Narrow { const made = { id, secret: "s" + id, at: [id] }; return made }
const more = { ...build(1), extra: 1 }
console.log(keysOf(more), json(more))
// The copy is a plain object. A cast to the class lets it through unchanged, and `owner` is read from it as in ECMAScript.
const copiedRow = copy(row)
try { console.log((copiedRow as Row).owner); console.log("a copy cast to the class: no error") } catch (e) { console.log("a copy cast to the class:", e instanceof TypeError ? "TypeError" : "other " + e) }
// `Object.assign({}, x)` under a written result type keeps the key order of ECMAScript: {"owner":"r","id":2,"cells":["a"]}.
function assign(x: Narrow): Narrow { return Object.assign({}, x) }
try { console.log(json(assign(row))); console.log("Object.assign({}, x): no error") } catch (e) { console.log("Object.assign({}, x):", e instanceof TypeError ? "TypeError" : "other " + e) }
