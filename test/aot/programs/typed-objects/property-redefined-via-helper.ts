// A helper function redefines or deletes a property of a typed object that was created by a literal elsewhere.
function defineLazy<T extends object>(target: T, key: keyof T, make: () => T[keyof T]): void {
  let made = false, value: T[keyof T];
  Object.defineProperty(target, key, { get() { if (!made) { value = make(); made = true; } return value; }, configurable: true, enumerable: true });
}
function defineLazyAndStorable<T extends object>(target: T, key: keyof T, make: () => T[keyof T]): void {
  Object.defineProperty(target, key, {
    get() { const value = make(); Object.defineProperty(target, key, { value, writable: true, configurable: true, enumerable: true }); return value; },
    set(value) { Object.defineProperty(target, key, { value, writable: true, configurable: true, enumerable: true }); },
    configurable: true, enumerable: true,
  });
}
function drop<T extends object>(target: T, key: keyof T): boolean { return delete target[key]; }
function hideIt<T extends object>(target: T, key: keyof T): void { Object.defineProperty(target, key, { enumerable: false }); }
function lockIt<T extends object>(target: T, key: keyof T): void { Object.defineProperty(target, key, { writable: false }); }

interface Settings { name: string; limit: number; schema: string; tags: string[]; note?: string; extra?: { deep: number } }
function makeSettings(name: string): Settings { return { name, limit: 10, schema: "eager", tags: ["a"] }; }
function typedReads(s: Settings): string { return [s.name, s.limit, s.schema, s.tags.join("+"), s.note, s.extra?.deep].map(String).join("|"); }
function peek(o: any, key: string): unknown { return o[key]; }
function byName(o: any): string { return [o.name, o.limit, o.schema, o.tags, o.note, o.extra && o.extra.deep].map(String).join("|"); }
function everyWay(label: string, s: Settings): void {
  console.log(label, "typed:", typedReads(s));
  console.log(label, "by name:", byName(s));
  console.log(label, "spread:", JSON.stringify({ ...s }));
  console.log(label, "JSON:", JSON.stringify(s));
  console.log(label, "keys:", Object.keys(s).join(), "| names:", Object.getOwnPropertyNames(s).join());
  console.log(label, "in:", "name" in s, "limit" in s, "schema" in s, "tags" in s, "note" in s, "extra" in s);
  const parts: string[] = []; for (const k in s) parts.push(k); console.log(label, "for in:", parts.join());
}
let calls = 0;

// A getter over a REQUIRED field, the key handed on as a parameter.
const a = makeSettings("a");
for (const key of ["schema"] as (keyof Settings)[]) defineLazy(a, key, () => { calls++; return "lazy " + calls; });
console.log("not made yet:", calls);
everyWay("a", a);
console.log("made once:", calls, typeof Object.getOwnPropertyDescriptor(a, "schema")!.get);

// Several times on one record: a required string, a required number, a required reference, an optional one that is absent, an optional reference.
const b = makeSettings("b");
defineLazy(b, "schema", () => "lazy schema");
defineLazy(b, "limit", () => 42);
defineLazy(b, "tags", () => ["x", "y"]);
defineLazy(b, "note", () => "lazy note");
defineLazy(b, "extra", () => ({ deep: 7 }));
everyWay("b", b);

// The accessor replaces itself by data at the first read, or at the first store.
const c = makeSettings("c");
defineLazyAndStorable(c, "schema", () => "resolved");
defineLazyAndStorable(c, "limit", () => 5);
console.log("c first:", c.schema, typeof Object.getOwnPropertyDescriptor(c, "schema")!.get, Object.getOwnPropertyDescriptor(c, "schema")!.value);
c.limit = 99;
console.log("c stored:", c.limit, typeof Object.getOwnPropertyDescriptor(c, "limit")!.get);
everyWay("c", c);

// A store to a property that has only a getter: strict code throws the language's own TypeError.
const d = makeSettings("d");
defineLazy(d, "schema", () => "only a getter");
try { d.schema = "stored"; console.log("d: no error", d.schema); } catch (e) { console.log("d:", e instanceof TypeError ? "TypeError" : "other", d.schema); }

const e = makeSettings("e");
console.log("deleted:", drop(e, "schema"), drop(e, "limit"), drop(e, "note"));
console.log("e typed:", String(e.schema), e.name, "schema" in e, "limit" in e, "| by name:", String(peek(e, "schema")), String(peek(e, "limit")));
console.log("e keys:", Object.keys(e).join(), JSON.stringify(e), JSON.stringify({ ...e }));
e.schema = "again"; e.limit = 3;
console.log("e again:", e.schema, e.limit, Object.keys(e).join(), JSON.stringify(e));
const f = makeSettings("f");
console.log("deleted:", drop(f, "tags"), String(peek(f, "tags")), "tags" in f, Object.keys(f).join());

// Attributes alone.
const g = makeSettings("g");
hideIt(g, "schema"); lockIt(g, "limit");
everyWay("g", g);
try { g.limit = 1; console.log("g: no error", g.limit); } catch (x) { console.log("g:", x instanceof TypeError ? "TypeError" : "other", g.limit); }
g.name = "still stored"; console.log("g other field:", g.name);

// A record that no helper has touched is as it was.
everyWay("h", makeSettings("h"));
