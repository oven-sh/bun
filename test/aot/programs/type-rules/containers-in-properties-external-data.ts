// An array, Map or Set kept in a class field or an object-literal property with an inferred type may hold external data of another type. Reading its elements must behave as in plain JavaScript; the container keeps its class.
// IR+ CallBuiltin v\d+ \(.*\) overload=ArrayPrototypeIndexOf/
const data = JSON.parse('{"t":"abc"}') as { t: number };
const say = (label: string, f: () => unknown): void => { let r: string; try { const v = f(); r = typeof v + " " + (typeof v === "object" ? JSON.stringify(v) : String(v)); } catch (e) { r = "throws " + (e as Error).constructor.name; } console.log(label + " ==> " + r); };
class Initialized { list = [data.t]; }
class Pushed { list = [1]; add() { this.list.push(data.t); return this; } }
class PushedFromOutside { list = [1]; }
class Assigned { list = [1]; load() { this.list = [data.t]; return this; } }
class Stored { list = [1]; put() { this.list[0] = data.t; return this; } }
class Mapped { byKey = new Map([[1, 2]]); add() { this.byKey.set(2, data.t); return this; } }
class Unique { all = new Set([1]); add() { this.all.add(data.t); return this; } }
class Trusted { list = [1]; add() { this.list.push(2); return this; } }
say("field initializer", () => new Initialized().list[0] + 1);
say("field, pushed in a method", () => new Pushed().add().list[1] + 1);
say("field, pushed from outside", () => { const o = new PushedFromOutside(); o.list.push(data.t); return o.list[1] + 1; });
say("field, assigned", () => new Assigned().load().list[0] + 1);
say("field, element assigned", () => new Stored().put().list[0] + 1);
say("field, taken into a const", () => { const c = new Initialized().list; return c[0] + 1; });
say("field, iterated", () => { let r = ""; for (const v of new Pushed().add().list) r += v + 1; return r; });
say("field, mapped", () => new Pushed().add().list.map(v => v + 1));
say("field holding a Map", () => new Mapped().add().byKey.get(2)! + 1);
say("field holding a Set", () => { let r = ""; for (const v of new Unique().add().all) r += v + 1; return r; });
say("literal property", () => { const o = { list: [data.t] }; return o.list[0] + 1; });
say("literal property, pushed", () => { const o = { list: [1] }; o.list.push(data.t); return o.list[1] + 1; });
say("literal property, assigned", () => { const o = { list: [1] }; o.list = [data.t]; return o.list[0] + 1; });
say("literal property, taken into a const", () => { const o = { list: [data.t] }; const c = o.list; return c.pop()! + 1; });
say("nested literal", () => { const o = { inner: { list: [1] } }; o.inner.list.push(data.t); return o.inner.list[1] + 1; });
say("length and indexOf stay exact", () => { const o = new Pushed().add(); return [o.list.length, o.list.indexOf(1)].join(); });
say("trusted stays exact", () => new Trusted().add().list[1] + 1);
