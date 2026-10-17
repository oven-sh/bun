// Optional class fields that are declared without an initializer exist from the start and hold undefined.
class C { label = "x"; tag?: string; n?: number }
function read(c: C): string { return String(c.tag) + "/" + String(c.n) + "/" + ("tag" in c) + "/" + Object.hasOwn(c, "tag") }
const list: C[] = []
for (let i = 0; i < 5; i++) list.push(new C())
list[1].tag = "own"
console.log(list.map(read).join(" "))
list[2].tag = "mine"
console.log(list.map(read).join(" "), read(new C()))
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
console.log(attempt(() => { list[3].tag = "x"; return "stored" }), attempt(() => { list[2].tag = "y"; return "stored" }), list.map(read).join(" "))
list[3].n = 7
console.log(list.map(read).join(" "), read(new C()), Object.keys(list[3]).join())
