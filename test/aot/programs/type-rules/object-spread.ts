// Object spread of typed objects, of proxies of them and of objects that inherit from them.
interface State { count: number; label: string; done?: boolean; nested: { deep: number } }
function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o) }
const s0: State = { count: 1, label: "a", nested: { deep: 1 } }
// A field that is made not enumerable is not copied by the spread.
const dressed: State = { count: 1, label: "d", nested: { deep: 0 } }
try { Object.defineProperty(dressed, "label", { enumerable: false }); console.log("not enumerable: no error") } catch (e) { console.log("not enumerable:", e instanceof TypeError ? "TypeError" : "other " + e) }
const undressed: State = { ...dressed }
console.log(show(undressed), "label" in undressed)
const traps: string[] = []
try {
  const proxied: State = new Proxy(s0, { ownKeys(t) { traps.push("keys"); return Reflect.ownKeys(t) }, get(t, k, r) { traps.push("get:" + String(k)); return Reflect.get(t, k, r) } })
  console.log("a proxy as State: no error", show({ ...proxied }))
} catch (e) { console.log("a proxy as State:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(traps.length)
// An object that inherits the fields: the spread copies its own properties only.
try { const heir: State = Object.create(s0); heir.count = 100; console.log("an heir as State: no error", show({ ...heir })) } catch (e) { console.log("an heir as State:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(show(s0))
