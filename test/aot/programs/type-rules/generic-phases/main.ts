// A function casts its parameter to a subtype before testing anything and stores the subtype's fields with values of the wrong type.
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ": no error", JSON.stringify(f())) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) }
}
interface Base { id: number; tags: string[] }
interface Generic extends Base { params: string[] }
interface WithMembers extends Base { members: string[]; count: number }
interface Stranger { id: number; tags: string[]; far: string[] }
function BaseCtor(this: Base, id: number, tags: string[]) { this.id = id; this.tags = tags }
const BaseObject = BaseCtor as unknown as new (id: number, tags: string[]) => Base
function createGeneric(params: string[]): Generic { const g = new BaseObject(1, []) as Generic; g.params = params; return g }
function resolve(type: Base): WithMembers {
  if (!(type as WithMembers).members) { (type as WithMembers).members = []; (type as WithMembers).count = 0 }
  return type as WithMembers
}
console.log(resolve(createGeneric(["a"])).count)
attempt("a number under `members` of a Generic", () => { const g: any = createGeneric([]); g.members = 5; return g })
attempt("a string under `count` of a Generic", () => { const g: any = createGeneric([]); g.count = "many"; return g })
attempt("a number under `members` of a Base", () => { const b: any = new BaseObject(2, []); b.members = 5; return b })
attempt("defineProperty", () => { const g: any = createGeneric([]); Object.defineProperty(g, "count", { value: "many", writable: true, enumerable: true, configurable: true }); return g })
// What fits is stored. A name that is stored through no such cast makes an extra property, and so does any name on an object of another family.
attempt("an array under `members`", () => { const g: any = createGeneric([]); g.members = ["m"]; return g })
attempt("undefined under `count`", () => { const g: any = createGeneric([]); g.count = undefined; return Object.keys(g) })
attempt("another name", () => { const g: any = createGeneric([]); g.extra = 5; return g })
attempt("a stranger", () => { const s: Stranger = { id: 3, tags: [], far: [] }; (s as any).members = 5; return s })
// The stores above are taken as plain Bun takes them. Any object passes the cast to the subtype. The value is tested at the first typed read of the field.
attempt("then: the number is read as string[] by typed code", () => { const g: any = createGeneric([]); g.members = 5; const r = resolve(g); return [typeof r.members, r.members.length, r.count] })
attempt("then: joined", () => { const g: any = createGeneric([]); g.members = 5; const r = resolve(g); return r.members.join("+") })
attempt("then: count is read as a number", () => { const g: any = createGeneric([]); g.members = ["m"]; g.count = "many"; const r = resolve(g); return [typeof r.count, r.count + 1] })
