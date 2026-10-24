// Unions discriminated by a string field: `switch`, `if` chains, destructuring, filters.
type Circle = { kind: "circle"; radius: number }
type Square = { kind: "square"; side: number }
type Rect = { kind: "rect"; width: number; height: number }
type Empty = { kind: "empty" }
type Shape = Circle | Square | Rect | Empty
function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o) }
function area(s: Shape): number {
  switch (s.kind) {
    case "circle": return 3 * s.radius ** 2
    case "square": return s.side * s.side
    case "rect": return s.width * s.height
    case "empty": return 0
  }
}
function sides(s: Shape): number { if (s.kind === "circle" || s.kind === "empty") return 0; return s.kind === "square" ? s.side * 4 : 2 * (s.width + s.height) }
function viaLocal(s: Shape): string { const { kind } = s; const k = s.kind; return kind === k ? kind.length + kind[0] : "differs" }
const shapes: Shape[] = [{ kind: "circle", radius: 1 }, { side: 2, kind: "square" }, { width: 2, kind: "rect", height: 3.5 }, { kind: "empty" }, { radius: 0.5, kind: "circle" }]
console.log(shapes.map(area).join(), shapes.map(sides).join(), shapes.map(viaLocal).join(), shapes.map(show).join(" ; "))

// The same text, made at run time: a rope, a slice, a parsed string.
const pieces = ["cir", "cle", "squ", "are"]
const joined = (pieces[0] + pieces[1]) as "circle"
const sliced = "xxsquarexx".slice(2, 8) as "square"
const made: Shape[] = [{ kind: joined, radius: 2 }, { kind: sliced, side: 3 }, JSON.parse('{"kind":"rect","width":1,"height":2}'), JSON.parse('{"radius":3,"kind":"circle"}'), { kind: String(["empty"]) as "empty" }]
console.log(made.map(area).join(), made.map(sides).join(), made.map(viaLocal).join(), made.map(s => s.kind === shapes[0].kind).join())

const circles = [...shapes, ...made].filter((s): s is Circle => s.kind === "circle")
console.log(circles.map(c => c.radius).join(), circles.length)
const tally: Record<Shape["kind"], number> = { circle: 0, square: 0, rect: 0, empty: 0 }
for (const s of [...shapes, ...made]) tally[s.kind]++
console.log(show(tally))

// One payload name, another kind in each branch.
type Lit = { kind: "num"; value: number } | { kind: "str"; value: string } | { kind: "bool"; value: boolean } | { kind: "obj"; value: { inner: number } } | { kind: "list"; value: Lit[] } | { kind: "nil"; value: null }
function render(l: Lit): string {
  switch (l.kind) {
    case "num": return Object.is(l.value, -0) ? "-0" : String(l.value + 0)
    case "str": return '"' + l.value.toUpperCase() + '"'
    case "bool": return l.value ? "yes" : "no"
    case "obj": return "{" + l.value.inner + "}"
    case "list": return "[" + l.value.map(render).join() + "]"
    case "nil": return String(l.value)
  }
}
const lits: Lit[] = [{ kind: "num", value: 1.5 }, { value: "s", kind: "str" }, { kind: "bool", value: false }, { kind: "obj", value: { inner: 4 } }, { kind: "nil", value: null }, { kind: "num", value: -0 }, { kind: "num", value: NaN }]
lits.push({ kind: "list", value: lits.slice(0, 3) }, { kind: "list", value: [] })
console.log(lits.map(render).join(" "), lits.map(l => typeof l.value).join())

// A reducer: every action is an branch, the state is copied by spread.
type Item = { id: number; label: string; done?: boolean }
type State = { items: Item[]; nextId: number; last?: Action["type"] }
type Action = { type: "add"; label: string } | { type: "remove"; id: number } | { type: "toggle"; id: number } | { type: "rename"; id: number; label: string } | { type: "clear" }
function reduce(state: State, action: Action): State {
  switch (action.type) {
    case "add": return { ...state, items: [...state.items, { id: state.nextId, label: action.label }], nextId: state.nextId + 1, last: action.type }
    case "remove": return { ...state, items: state.items.filter(i => i.id !== action.id), last: "remove" }
    case "toggle": return { ...state, last: action.type, items: state.items.map(i => i.id === action.id ? { ...i, done: !i.done } : i) }
    case "rename": return { last: action.type, ...state, items: state.items.map(i => i.id === action.id ? { ...i, label: action.label } : i) }
    default: return { items: [], nextId: state.nextId }
  }
}
const actions: Action[] = [{ type: "add", label: "a" }, { type: "add", label: "b" }, { type: "toggle", id: 1 }, { label: "B", type: "rename", id: 2 }, { type: "toggle", id: 1 }, { type: "remove", id: 1 }, { type: "add", label: "c" }, { type: "clear" }, { type: "add", label: "d" }]
let state: State = { items: [], nextId: 1 }
for (const action of actions) { state = reduce(state, action); console.log(action.type, show(state)) }

// Nested unions, narrowed two levels deep.
type Reply = { status: "ok"; body: Shape } | { status: "error"; reason: { code: number; kind: "fatal" | "retry" } } | { status: "pending" }
function summarize(r: Reply): string {
  if (r.status === "ok") return r.body.kind === "circle" ? "circle of " + r.body.radius : r.body.kind + " of area " + area(r.body)
  if (r.status === "error") return r.reason.kind === "fatal" ? "fatal " + r.reason.code : "retry"
  return r.status
}
console.log(([{ status: "ok", body: shapes[0] }, { body: made[1], status: "ok" }, { status: "error", reason: { code: 5, kind: "fatal" } }, { status: "error", reason: { kind: "retry", code: 0 } }, { status: "pending" }] as Reply[]).map(summarize).join(" ; "))

let total = 0
const everything = [...shapes, ...made]
for (let i = 0; i < 5000; i++) total += area(everything[i % everything.length]) + render(lits[i % lits.length]).length
console.log(total)
