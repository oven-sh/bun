// Functions that cast their parameter to a subtype before testing anything about the object, and then store the subtype's fields.
const show = (what: string, o: object) => console.log(what, JSON.stringify(Object.keys(o)), JSON.stringify(o), "members" in o, Object.hasOwn(o, "count"))
interface Base { id: number; tags: string[] }
interface Generic extends Base { params: string[] }
interface Tuple extends Generic { size: number }
interface WithMembers extends Base { members: string[]; count: number }
interface Filled extends Base { filled: boolean[] }
interface Other { id: number; tags: string[]; name: string[] }
function BaseCtor(this: Base, id: number, tags: string[]) { this.id = id; this.tags = tags }
const BaseObject = BaseCtor as unknown as new (id: number, tags: string[]) => Base
let nextId = 0
function createBase(...tags: string[]): Base { return new BaseObject(++nextId, tags) }
function createGeneric(params: string[]): Generic { const g = createBase("g") as Generic; g.params = params; return g }
function createTuple(size: number): Tuple { const t = createGeneric(["T"]) as Tuple; t.size = size; return t }
function resolve(type: Base): WithMembers {
  if (!(type as WithMembers).members) {
    (type as WithMembers).members = ["m" + type.id];
    (type as WithMembers).count = type.tags.length
  }
  return type as WithMembers
}
function fill(it: Base | Other, value: boolean) { const filled = it as Filled; filled.filled = [value]; return filled }
function asGeneric(type: Base, params: string[]) { if (type.tags.length > 1) (type as Generic).params = params; return type }
function hasMembers(type: Base) { return !!(type as WithMembers).members }

// After it has been made something else.
const generic = createGeneric(["A", "B"]); show("generic", generic); console.log(hasMembers(generic))
const resolved = resolve(generic); show("generic, resolved", generic); console.log(resolved === generic as Base, resolved.members.length + resolved.count, hasMembers(generic), generic.params.join())
console.log(resolve(generic).members === resolved.members)
const tuple = createTuple(3); show("tuple", resolve(tuple)); console.log(tuple.size + resolve(tuple).count, tuple.params.length)
// Before.
const early = createBase("x", "y"); show("base", early); resolve(early); show("base, resolved", early)
asGeneric(early, ["late"]); show("then generic", early); console.log((early as Generic).params.join(), resolve(early).members.join(), resolve(early).count)
// Never.
const plain = createBase(); show("plain", plain); console.log(hasMembers(plain), (plain as WithMembers).members, (plain as WithMembers).count)
// Two phases on one object, in both orders.
const both = createGeneric([]); fill(both, true); resolve(both); show("filled, resolved", both)
const other = createGeneric([]); resolve(other); fill(other, false); show("resolved, filled", other)
const named: Other = { id: 0, tags: [], name: ["n"] }; show("other", fill(named, true)); console.log(named.name.join(), (named as unknown as Filled).filled.join())
// Many, so that the stores are compiled.
let sum = 0
for (let i = 0; i < 2000; i++) { const g = i % 2 ? createGeneric(["p"]) : createTuple(i); sum += resolve(g).members[0].length + resolve(g).count + fill(g, i % 3 == 0).filled.length }
console.log(sum)
// What untyped code sees.
const untyped: any = createGeneric(["u"])
console.log(untyped.members, "count" in untyped, delete untyped.members, Object.keys(untyped).join())
untyped.members = ["by any"]; untyped.count = 7; show("untyped", untyped); console.log(resolve(untyped).members.join(), resolve(untyped).count)
