// Object rest patterns (`const { id, ...rest } = props`) on typed objects and on proxies of them.
interface Props { id: number; title: string; hidden?: boolean; size?: number; style: { color: string; width?: number } }
function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o) }
const props: Props = { title: "t", id: 1, style: { color: "red" }, size: 0 }
// No cast, no any.
const which: "id" | "title" = props.id > 0 ? "title" : "id"
const { [which]: chosen, ...others } = props
console.log(String(chosen), show(others))
const log: string[] = []
try {
  const proxied: Props = new Proxy(props, { get(t, k, r) { log.push("get:" + String(k)); return Reflect.get(t, k, r) }, ownKeys(t) { log.push("keys"); return Reflect.ownKeys(t) } })
  const { title: proxiedTitle, ...proxiedRest } = proxied
  console.log("a proxy as Props: no error", proxiedTitle, show(proxiedRest))
} catch (e) { console.log("a proxy as Props:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(log.length)
