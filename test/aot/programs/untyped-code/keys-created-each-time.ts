interface Address { city: string; zip?: string; floor: number }
interface User { id: number; nick?: string; address: Address; tags: string[] }
class Kept { field = "f"; method() { return "m"; } get got() { return "g"; } }
function hide(value: unknown): any { return value; }
let count = 0;
function show(name: string, make: () => unknown) {
  let out: string;
  try { out = JSON.stringify(make(), (_k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : v)); } catch (e) { out = "THROWN " + (e as Error).name + ": " + (e as Error).message; }
  console.log(String(++count).padStart(2, "0"), name + ":", out);
}
function dlv(obj: any, key: string, def?: unknown): unknown { const parts = key.split("."); let p = 0; for (; p < parts.length; p++) obj = obj ? obj[parts[p]] : undefined; return obj === undefined ? def : obj; }
function has(obj: any, key: string): boolean[] { return key.split(".").map(k => k in obj); }
function set(obj: any, key: string, value: unknown) { const parts = key.split("."); let p = 0; for (; p < parts.length - 1; p++) obj = obj[parts[p]]; obj[parts[p]] = value; }
function many(f: () => unknown): unknown[] { const out: unknown[] = []; for (let i = 0; i < 40; i++) out.push(f()); return [out[0], out[39], out.every(v => JSON.stringify(v) === JSON.stringify(out[0]))]; }
const make = (): User => ({ id: 1, address: { city: "c", floor: 2.5 }, tags: ["a", "b"] });
show("fields along a path", () => { const x = make(); return [many(() => dlv(x, "address.city")), many(() => dlv(x, "address.floor")), many(() => dlv(x, "id"))]; });
show("an absent optional field, a missing name, a default", () => { const x = make(); return [many(() => dlv(x, "nick")), many(() => dlv(x, "address.zip", "none")), many(() => dlv(x, "address.nothing.more", "none")), many(() => dlv(x, "nothing"))]; });
show("set, then read, then deleted, then read", () => { const x = make(); const out = [dlv(x, "address.zip")]; x.address.zip = "z"; out.push(dlv(x, "address.zip")); delete x.address.zip; out.push(dlv(x, "address.zip")); x.nick = undefined; out.push(dlv(x, "nick", "default")); return out; });
show("through an array and its length", () => { const x = make(); return [many(() => dlv(x, "tags.1")), many(() => dlv(x, "tags.length")), many(() => dlv(x, "tags.7", "none"))]; });
show("inherited names", () => { const x = make(); return [typeof dlv(x, "toString"), typeof dlv(x, "address.hasOwnProperty"), dlv(x, "constructor.name"), typeof dlv(x, "__proto__")]; });
show("an instance: a field, a method, a getter", () => { const x = new Kept(); return [many(() => dlv(x, "field")), typeof dlv(x, "method"), many(() => dlv(x, "got"))]; });
show("extras", () => { const x = make(); hide(x).extra = { deep: 1 }; hide(x.address).more = "m"; return [many(() => dlv(x, "extra.deep")), many(() => dlv(x, "address.more")), many(() => dlv(x, "address.city"))]; });
show("another prototype", () => { const x = Object.setPrototypeOf(hide(make()), JSON.parse('{"above":{"it":1},"nick":"inherited"}')); return [many(() => dlv(x, "above.it")), many(() => dlv(x, "nick")), many(() => dlv(x, "id"))]; });
show("typed and plain in turn", () => { const list = [make(), JSON.parse('{"address":{"city":"p"}}'), make(), JSON.parse("{}"), make()]; return list.map(x => dlv(x, "address.city", "none")); });
show("in", () => { const x = make(); return [many(() => has(x, "id.nick.address.nothing.toString")), many(() => has(x.address, "city.zip.floor"))]; });
show("stores", () => { const x = make(); for (let i = 0; i < 40; i++) { set(x, "address.city", "c" + i); set(x, "id", i); set(x, "address.floor", i + 0.5); } set(x, "nick", "n"); set(x, "address.zip", "z"); set(x, "extra", 1); return [x, Object.keys(x).join(), Object.keys(x.address).join()]; });
show("frozen", () => { const x = Object.freeze(make()); return [many(() => dlv(x, "address.city")), many(() => dlv(x, "id"))]; });
show("keys with odd text", () => { const x = make(); return ["", ".", "0", "id.", ".id", "address..city", " id"].map(k => dlv(x, k, "none")); });
