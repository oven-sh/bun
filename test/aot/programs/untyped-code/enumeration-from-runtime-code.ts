// Evaluated text enumerates and copies compiled objects: for-in, spread, rest and Object.assign, many times at one site, while the objects change.
class Base { inherited: number = 1; method() {} }
class Item extends Base { whole: number = 1; text: string = "t"; flag: boolean = true; link: Item | null = null; maybe?: number; anything: unknown = undefined; }
function hide(value: unknown): any { return value; }
const make = (parameters: string, body: string) => new Function(...parameters.split(","), body) as (...a: any[]) => any;
const say = (v: unknown): string => typeof v === "symbol" ? String(v) : typeof v === "function" ? "function" : typeof v === "object" && v !== null ? "object" : v === undefined ? "undefined" : JSON.stringify(v);
const describe = (o: object) => Reflect.ownKeys(o).map(key => { const d = Object.getOwnPropertyDescriptor(o, key)!; return String(key) + "=" + ("value" in d ? say(d.value) : "accessor") + (d.enumerable ? "" : "(hidden)") + (d.writable === false ? "(fixed)" : ""); }).join();
let line = 0;
function show(title: string, ...values: unknown[]) { console.log(String(++line).padStart(2, "0"), title + ":", values.map(v => typeof v === "string" ? v : JSON.stringify(v)).join(" | ")); }
const attempt = (f: () => unknown) => { try { return f(); } catch (e) { return "THROWN " + (e as Error).name + ": " + (e as Error).message; } };

const keysIn = make("o", "let last; for (let round = 0; round < 4; round++) { last = []; for (const key in o) last.push(key); } return last.join();");
const entriesIn = make("o", "let last; for (let round = 0; round < 4; round++) { last = []; for (const key in o) last.push(key + '=' + typeof o[key]); } return last.join();");
const ownIn = make("o", "const out = []; for (const key in o) if (Object.prototype.hasOwnProperty.call(o, key) && key in o) out.push(key); return out.join();");
const spread = make("o", "let last; for (let round = 0; round < 4; round++) last = { ...o }; return last;");
const spreadBetween = make("o", "let last; for (let round = 0; round < 4; round++) last = { whole: 'first', before: 0, ...o, text: 'last', after: 1 }; return last;");
const rest = make("o", "let last; for (let round = 0; round < 4; round++) { const { whole, missing, ...others } = o; last = others; } return last;");
const restByKey = make("o,key", "const { [key]: taken, ...others } = o; return [taken, others];");
const assign = make("o", "let last; for (let round = 0; round < 4; round++) last = Object.assign({ before: 0 }, o); return last;");
const every = (o: object) => [keysIn(o), describe(spread(o)), describe(spreadBetween(o)), describe(rest(o)), describe(assign(o))];

{
  const item = new Item();
  show("as created", ...every(item), entriesIn(item), ownIn(item));
  item.maybe = 2; item.link = item;
  show("an optional field is stored", ...every(item));
  delete hide(item).whole; delete hide(item).flag;
  show("fields are deleted", ...every(item));
  hide(item).flag = "again"; hide(item).whole = 3;
  show("and stored again", ...every(item));
}
{
  const item = new Item(), sym = Symbol("sym");
  hide(item).extra = 1; hide(item)[sym] = 2; Object.defineProperty(item, "unseen", { value: 3 }); Object.defineProperty(item, Symbol.for("unseen"), { value: 4 });
  show("extra properties", ...every(item));
  let runs = 0;
  Object.defineProperty(item, "computed", { get() { runs++; return "computed " + this.whole; }, enumerable: true, configurable: true });
  show("an accessor is run by a copy, not by for-in", ...every(item), runs);
  Object.defineProperty(item, "text", { get() { runs++; return "text getter"; }, enumerable: true, configurable: true });
  Object.defineProperty(item, "flag", { value: false, enumerable: false, writable: true, configurable: true });
  show("fields are redefined", ...every(item), runs);
  hide(item)[1] = "one"; hide(item)[0] = "zero";
  show("indexes come first", ...every(item));
  Object.defineProperty(item, "__proto__", { value: "own", enumerable: true, writable: true, configurable: true });
  show("an own __proto__", describe(spread(item)), Object.getPrototypeOf(spread(item)) === Object.prototype, describe(rest(item)));
}
{
  const item = new Item();
  hide(Base.prototype).above = 1; Object.defineProperty(Item.prototype, "hiddenAbove", { value: 1, configurable: true }); hide(Item.prototype).whole = "shadowed";
  show("enumerable properties of the prototypes", ...every(item), ownIn(item));
  delete hide(item).whole;
  show("an own field no longer shadows", keysIn(item), entriesIn(item), describe(spread(item)));
  delete hide(Base.prototype).above; delete hide(Item.prototype).hiddenAbove; delete hide(Item.prototype).whole;
  show("the prototypes as before", keysIn(item), keysIn(new Item()));
  Object.setPrototypeOf(item, { other: 1 });
  show("another prototype", keysIn(item), describe(spread(item)));
  Object.setPrototypeOf(item, null);
  show("no prototype", keysIn(item), describe(spread(item)), describe(rest(item)));
}
{
  const removing = make("o", "const out = []; for (const key in o) { out.push(key); if (key === 'whole') { delete o.flag; o.added = 1; } } return out.join();");
  show("keys go and come during for-in", removing(new Item()), removing(new Item()), removing(Object.assign(new Item(), { extra: 1 })));
  const storing = make("o", "for (const key in o) o[key] = key; return o;");
  show("stores during for-in", describe(storing(new Item())));
}
{
  show("frozen, sealed", ...every(Object.freeze(new Item())).slice(0, 2), ...every(Object.seal(new Item())).slice(0, 2), Object.isFrozen(spread(Object.freeze(new Item()))));
  const log: string[] = [];
  const proxy = new Proxy(new Item(), { ownKeys(t) { log.push("ownKeys"); return Reflect.ownKeys(t); }, getOwnPropertyDescriptor(t, k) { log.push("describe " + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); }, get(t, k, r) { log.push("get " + String(k)); return Reflect.get(t, k, r); } });
  show("a proxy", describe(make("o", "return { ...o };")(proxy)), log.splice(0).join());
  show("rest by a key", ...["whole", "missing", "text"].map(key => { const [taken, others] = restByKey(new Item(), key); return say(taken) + " " + describe(others); }));
  show("what is no object", describe(spread(undefined as any)), describe(spread(null as any)), describe(spread(5 as any)), describe(spread("ab" as any)), keysIn(undefined as any), keysIn("ab" as any), attempt(() => rest(undefined as any)));
}
{
  const shapes: object[] = [new Item(), new Base(), { whole: 1, z: 2 }, JSON.parse('{"p":1}'), Object.create(new Item()), [7, 8], Object.assign(new Item(), { extra: 1 })];
  const out: string[] = [];
  for (let round = 0; round < 3; round++) for (const shape of shapes) out.push(keysIn(shape) + ";" + Object.keys(spread(shape)).join());
  show("many receivers at one site", ...out.slice(0, 7), out.slice(7).join() === [...out.slice(0, 7), ...out.slice(0, 7)].join());
}
{
  let total = 0;
  for (let i = 0; i < 2000; i++) { const item = new Item(); item.whole = i; item.link = new Item(); const copy = spread(item); total += copy.whole + copy.link.whole + keysIn(copy).length; if (i % 500 === 0) Bun.gc(true); }
  show("many objects, with collections in between", total);
}
