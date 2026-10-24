type Three = { accept: string; "content-type": string; "x-id": string };
type Mixed = { a: string; b: number; c: boolean; d: null; e: undefined; f?: string };
function hide(value: unknown): any { return value; }
let count = 0;
function show(name: string, make: () => unknown) {
  let out: string;
  try { out = JSON.stringify(make()); } catch (e) { out = "THROWN " + (e as Error).name + ": " + (e as Error).message; }
  console.log(String(++count).padStart(2, "0"), name + ":", out);
}
const list = (h: Headers) => [...h];
const three = (): Three => ({ accept: "*/*", "content-type": "text/plain", "x-id": "1" });
show("new Headers(typed)", () => list(new Headers(three())));
show("new Headers(a named constant)", () => { const headers = { "x-b": "2", "x-a": "1" }; return list(new Headers(headers)); });
show("new Response(body, { headers })", () => { const headers = { "content-type": "application/json", "cache-control": "no-store" }; return list(new Response("b", { headers }).headers); });
show("new Request(url, { headers })", () => { const headers = { authorization: "t", "x-n": "1" }; return list(new Request("http://localhost/", { headers }).headers); });
show("new URLSearchParams(typed)", () => { const params = { q: "a b", page: "1", "ключ": "значение" }; return new URLSearchParams(params).toString(); });
show("values that are no strings", () => { const m: Mixed = { a: "s", b: 1.5, c: true, d: null, e: undefined }; return [list(new Headers(hide(m))), new URLSearchParams(hide(m)).toString()]; });
show("an optional field absent, then set", () => { const m: Mixed = { a: "s", b: 1, c: false, d: null, e: undefined }; const first = new URLSearchParams(hide(m)).toString(); m.f = "set"; return [first, new URLSearchParams(hide(m)).toString()]; });
show("a value with toString, which changes a later field", () => { const o: { a: unknown; b: string } = { a: null, b: "before" }; o.a = { toString() { o.b = "after"; return "ran"; } }; return [new URLSearchParams(hide(o)).toString(), list(new Headers(hide({ ...o, a: "x" })))]; });
show("a value with toString, which deletes a later field", () => { const o: { a: unknown; b?: string } = { a: null, b: "before" }; o.a = { toString() { delete o.b; return "ran"; } }; return new URLSearchParams(hide(o)).toString(); });
show("a symbol value", () => { const o: { a: unknown } = { a: Symbol("s") }; return new URLSearchParams(hide(o)).toString(); });
show("an invalid header name, value", () => { const bad = { "a b": "1" }, worse = { a: "x\ny" }; const out: string[] = []; for (const o of [bad, worse]) { try { out.push(JSON.stringify(list(new Headers(o)))); } catch (e) { out.push((e as Error).name + ": " + (e as Error).message); } } return out; });
show("names that differ in case", () => { const o = { "X-A": "1", "x-a": "2", "x-B": "3" }; return list(new Headers(o)); });
show("lone surrogates in a key", () => { const o = { "\ud800": "1", "�": "2", plain: "3" }; return new URLSearchParams(o).toString(); });
show("extras", () => { const o = three(); hide(o)["x-extra"] = "e"; hide(o)[Symbol.for("s")] = "sym"; const out: unknown[] = []; try { out.push(list(new Headers(o))); } catch (e) { out.push((e as Error).name); } return out; });
show("a non-enumerable extra", () => { const o = three(); Object.defineProperty(hide(o), "x-hidden", { value: "h", enumerable: false }); return list(new Headers(o)); });
show("a class instance", () => { class H { accept = "*/*"; #secret = "s"; get computed() { return this.#secret; } } return list(new Headers(hide(new H()))); });
show("frozen", () => list(new Headers(Object.freeze(three()))));
show("an iterable typed object", () => { const o: { a: string; [Symbol.iterator]?: () => Iterator<[string, string]> } = { a: "1" }; const first = list(new Headers(hide(o))); hide(o)[Symbol.iterator] = function* () { yield ["x-it", "yes"]; }; return [first, list(new Headers(hide(o)))]; });
show("empty", () => [list(new Headers({} as { o?: string })), new URLSearchParams({} as { o?: string }).toString()]);
show("many", () => { const o = { a01: "1", a02: "2", a03: "3", a04: "4", a05: "5", a06: "6", a07: "7", a08: "8", a09: "9", a10: "10", a11: "11", a12: "12" }; return new URLSearchParams(o).toString(); });
