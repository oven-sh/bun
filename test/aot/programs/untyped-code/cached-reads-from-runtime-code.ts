// One read site in evaluated text sees an object many times, and then the object, its prototype or its Structure changes.
class Base { inherited = 1; method() { return "base method"; } get computed() { return "getter of " + this.inherited; } shadowed() { return "base"; } }
class Item extends Base {
  whole: number = 1; fraction: number = 1.5; flag: boolean = true; text: string = "text"; literal: "a" | "b" = "a"; link: Item | null = null; maybe?: number; maybeText?: string; maybeFlag?: boolean;
  anything: unknown = 1; either: number | string = 1; nothing: undefined | number = undefined; list: number[] = [1, 2]; guessed = 1; guessedText = "guessed";
  shadowed() { return "item"; }
}
function hide(value: unknown): any { return value; }
const say = (v: unknown): string => v === undefined ? "undefined" : typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : typeof v === "function" ? "function" : typeof v === "object" && v !== null ? "object" : typeof v === "symbol" ? "symbol" : typeof v === "bigint" ? v + "n" : JSON.stringify(v);
const readers = new Map<string, (o: unknown, times: number) => unknown[]>();
function read(name: string, o: unknown, times = 6): string {
  let reader = readers.get(name);
  if (!reader) readers.set(name, reader = new Function("o", "times", `const seen = []; for (let i = 0; i < times; i++) { const v = o.${name}; if (!i || !Object.is(v, seen[seen.length - 1])) seen.push(v); } return seen;`) as (o: unknown, times: number) => unknown[]);
  try { return reader(o, times).map(say).join(" then "); } catch (e) { return "THROWN " + (e as Error).name; }
}
let line = 0;
function show(title: string, ...values: string[]) { console.log(String(++line).padStart(2, "0"), title + ":", values.join(" | ")); }
const fields = ["whole", "fraction", "flag", "text", "literal", "link", "maybe", "maybeText", "maybeFlag", "anything", "either", "nothing", "list", "guessed", "guessedText", "inherited"];

{
  const item = new Item();
  show("every field", ...fields.map(name => read(name, item)));
  item.whole = 2147483647; item.fraction = NaN; item.flag = false; item.text = ""; item.literal = "b"; item.link = item; item.maybe = -0; item.maybeText = "m"; item.maybeFlag = false; item.anything = null; item.either = "s"; item.nothing = 0.5;
  show("other values", ...fields.map(name => read(name, item)));
  item.whole = 2147483648; item.fraction = -0; item.maybe = -2147483648; item.anything = 1n; item.either = 1e300; item.nothing = -2147483647;
  show("numbers at the edges", ...["whole", "fraction", "maybe", "anything", "either", "nothing"].map(name => read(name, item)));
  for (const v of [-2147483648, -2147483647, -2147483646, -2147483645, -2147483644, -2147483643, 4294967295, Infinity, 5e-324]) { item.whole = v; item.maybe = v; item.either = v; show("number " + v, read("whole", item), read("maybe", item), read("either", item)); }
  for (const v of [undefined, null, true, false, 0, "", "x", Symbol.iterator, item, () => 1]) { item.anything = v; show("anything", read("anything", item)); }
}
{
  const item = new Item();
  show("absent, then stored, then deleted, then stored", read("maybe", item), (item.maybe = 3, read("maybe", item)), (delete item.maybe, read("maybe", item)), (item.maybe = 4.5, read("maybe", item)));
  delete hide(item).whole; delete hide(item).text; delete hide(item).flag; delete hide(item).link;
  show("required fields deleted", ...["whole", "text", "flag", "link"].map(name => read(name, item)));
  hide(item).whole = "a string"; hide(item).text = 5; hide(item).flag = null; hide(item).link = 7;
  show("and stored with other types", ...["whole", "text", "flag", "link"].map(name => read(name, item)));
}
{
  const item = new Item();
  show("before a redefinition", read("whole", item), read("text", item));
  Object.defineProperty(item, "whole", { get() { return "own getter"; }, configurable: true });
  Object.defineProperty(item, "text", { value: "fixed", writable: false, enumerable: false, configurable: true });
  show("after it", read("whole", item), read("text", item));
  Object.defineProperty(item, "whole", { value: 9, writable: true, enumerable: true, configurable: true });
  show("a data property again", read("whole", item));
}
{
  const item = new Item();
  show("members of the prototypes", read("method", item), read("computed", item), read("shadowed", item), read("missing", item), read("toString", item), read("constructor", item));
  show("what they return", ...["method", "shadowed"].map(name => String(hide(item)[name]())));
  hide(Base.prototype).missing = "found on Base.prototype";
  show("a name appears above", read("missing", item), read("maybe", item));
  hide(Item.prototype).missing = "found on Item.prototype";
  hide(Item.prototype).maybe = "inherited while absent";
  show("and nearer", read("missing", item), read("maybe", item));
  item.maybe = 1;
  show("own again", read("maybe", item));
  delete item.maybe; delete hide(Item.prototype).maybe; delete hide(Item.prototype).missing; delete hide(Base.prototype).missing;
  show("all gone", read("missing", item), read("maybe", item));
  const original = Base.prototype.method;
  Base.prototype.method = function () { return "replaced"; };
  show("a method is replaced", String(hide(item).method()), read("method", item) === read("method", new Item()) ? "same" : "differs");
  hide(item).method = () => "own";
  show("and shadowed by an own property", String(hide(item).method()), String(hide(new Item()).method()));
  Base.prototype.method = original;
  Object.defineProperty(Item.prototype, "inheritedGetter", { get() { return "from " + this.text; }, configurable: true });
  show("a getter above", read("inheritedGetter", item));
  delete hide(Item.prototype).inheritedGetter;
}
{
  const item = new Item();
  show("before another prototype", read("method", item), read("whole", item), read("maybe", item));
  Object.setPrototypeOf(item, { method: "not a function", maybe: "above" });
  show("after it", read("method", item), read("whole", item), read("maybe", item), read("computed", item));
  Object.setPrototypeOf(item, null);
  show("no prototype", read("method", item), read("whole", item), read("maybe", item), read("toString", item));
  Object.setPrototypeOf(item, Item.prototype);
  show("the first one again", read("method", item), read("whole", item), read("maybe", item));
}
{
  const item = new Item();
  hide(item).extra = "extra"; Object.defineProperty(item, "unseen", { value: { deep: 1 }, enumerable: false });
  show("extra properties", read("extra", item), read("unseen", item), read("unseen.deep", item), read("whole", item));
  hide(item).extra = 2; show("stored again", read("extra", item));
  Object.defineProperty(item, "extra", { get() { return "extra getter"; }, configurable: true }); show("an accessor", read("extra", item));
  delete hide(item).extra; show("deleted", read("extra", item), read("unseen", item));
  for (let i = 0; i < 80; i++) hide(item)["name" + i] = i;
  show("many extra properties", read("name0", item), read("name79", item), read("name80", item), read("unseen", item));
  for (let i = 0; i < 80; i += 2) delete hide(item)["name" + i];
  show("half of them deleted", read("name0", item), read("name1", item), read("name78", item), read("name79", item));
  hide(item).name0 = "back"; show("one comes back", read("name0", item));
}
{
  const frozen = Object.freeze(new Item()), sealed = Object.seal(new Item()), closed = Object.preventExtensions(new Item());
  show("frozen, sealed, not extensible", ...[frozen, sealed, closed].map(o => read("whole", o) + " " + read("maybe", o) + " " + read("method", o)));
}
{
  const shapes: unknown[] = [new Item(), new Base(), { whole: "literal" }, JSON.parse('{"whole":"parsed"}'), Object.create(new Item()), [], "string", 5, new Proxy(new Item(), {}), Object.assign(new Item(), { whole: 7 })];
  const out: string[] = [];
  for (let round = 0; round < 3; round++) for (const shape of shapes) out.push(read("whole", shape, 2));
  show("many receivers at one site", ...out);
  show("no receiver", read("whole", undefined), read("whole", null));
}
{
  let total = 0;
  for (let i = 0; i < 3000; i++) { const item = new Item(); item.whole = i; item.text = "t" + i; item.link = new Item(); item.link.whole = i; total += Number(read("whole", item, 1)) + read("text", item, 1).length + Number(read("link.whole", item, 1)); }
  show("many objects, with collections in between", String(total));
}
