import { getState, setState, isCurrent, isCurrentUser, echo, same, touch, addTag, sortById, register, unregister, adder, Tank, kept, keptText, isKeptInner } from "./lib"
export function rows() {
  const out = []
  const o = { id: "o", width: 2 }
  out.push(["echo is the same object", echo(o) === o, same(o, echo(o))])
  addTag(o, "t"); out.push(["a store in typed code is seen here", JSON.stringify(o)])
  const item = { id: 1, label: "one", done: false }
  touch(item); touch(item); out.push(["stores to what is handed in", JSON.stringify(item)])
  out.push(["a registry by object", register(o), register(o), unregister(o), unregister(o)])
  const list = [{ id: 1, label: "a", done: false }, { id: 3, label: "c", done: true }, { id: 2, label: "b", done: false }]
  out.push(["an array is sorted where it is", sortById(list) === list, list.map(i => i.id).join()])
  const user = { name: "n" }, next = { user, items: list, winner: null, label: null }
  setState(next); out.push(["what is kept is what was handed in", getState() === next, isCurrent(next), getState().user === user, isCurrentUser(user)])
  const s = getState(); s.winner = list[0]; s.label = "w"; s.user = { name: "other" }
  out.push(["stores to a state object that is handed out", JSON.stringify(getState().winner), getState().label, isCurrentUser(s.user), getState().winner === list[0]])
  const [all, add] = adder(); const first = { id: 7, label: "f", done: false }
  out.push(["a closure of typed code", add(first), all[0] === first, all.length])
  const tank = new Tank(); out.push(["a method of a class", tank.take(first), tank.holds(first), tank.last === first, tank.count])
  kept.label = "changed"; kept.inner = { n: 5 }; out.push(["an exported object is stored to", keptText(), isKeptInner(kept.inner)])
  out.push(["more than the type says", JSON.stringify(echo({ id: "x", extra: [1, { deep: true }] }))])
  out.push(["less than the type says", JSON.stringify(echo({})), same(o, {})])
  return out
}
const held = { id: 4, label: "held", done: false }
export function offer(f) { return f(held) }
export function heldText() { return JSON.stringify(held) }
export function isHeld(x) { return x === held }
export function makeItem(id) { return { id, label: "made" + id, done: false } }
export function pour(sinks) { let sum = 0; for (const sink of sinks) sum += sink.take(held); return sum }
