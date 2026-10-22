// Members and elements of which the declared type says nothing, or the wrong thing: each such value is written by the general code, in its place in the text, and the members around it are not.
interface Envelope { id: number; data: unknown; name: string; more: unknown; ok: boolean }
interface First { data: unknown; id: number }
interface Last { id: number; data: unknown }
interface Only { data: unknown }
interface List { id: number; items: unknown[]; end: string }
interface Wrong { id: number; name: string; tags: string[]; at: Date }

const word: string = process.argv[2] ?? "w";
const launder = new Function("v", "return v" + word.slice(word.length)) as <V>(v: V) => V;

let count = 0;
function show(name: string, make: () => unknown) {
  let out: string;
  try { out = String(make()); } catch (e) { out = "THROWN " + (e as Error).name + ": " + (e as Error).message; }
  console.log(String(++count).padStart(2, "0"), name + ":", out);
}

function writeEnvelope(e: Envelope): string { return JSON.stringify(e); }
function writeFirst(e: First): string { return JSON.stringify(e); }
function writeLast(e: Last): string { return JSON.stringify(e); }
function writeOnly(e: Only): string { return JSON.stringify(e); }
function writeList(e: List): string { return JSON.stringify(e); }
function writeWrong(e: Wrong): string { return JSON.stringify(e); }
const envelope = (data: unknown, more: unknown = 1): Envelope => ({ id: 7, data, name: word, more, ok: true });

const values: [string, () => unknown][] = [
  ["undefined", () => undefined],
  ["null", () => null],
  ["a number", () => 1.5],
  ["a string", () => 'q"' + word],
  ["a wide string", () => "значение"],
  ["a boolean", () => false],
  ["a symbol", () => Symbol("s")],
  ["a function", () => () => 1],
  ["an empty object", () => ({})],
  ["an empty array", () => []],
  ["a plain object", () => JSON.parse('{"b":[1,{"c":null}],"a":"x","":0}')],
  ["an object with members that have no text", () => ({ a: undefined, b: () => 1, c: Symbol("s"), d: 1 })],
  ["an array with elements that have no text", () => [undefined, () => 1, Symbol("s"), 1]],
  ["an object with wide text", () => ({ ключ: "значение", plain: "p" })],
  ["a typed object", () => envelope(1)],
  ["a typed object that unseen code has held", () => launder(envelope(launder([word]), launder({ deep: [envelope(null)] })))],
  ["a date", () => new Date(86400000)],
  ["an invalid date", () => new Date(NaN)],
  ["a map, a set, a regular expression", () => [new Map([[1, 2]]), new Set([1]), /x/g]],
  ["boxed primitives", () => [new String("s"), new Number(2), new Boolean(false), Object(Symbol("s"))]],
  ["a typed array", () => new Uint8Array([1, 2, 3])],
  ["an error", () => new Error("message")],
  ["a class instance with an accessor and a private field", () => new (class P { #h = 1; x = 2; get y() { return this.#h; } })()],
  ["an object without a prototype", () => Object.assign(Object.create(null), { a: 1 })],
  ["a getter", () => ({ get a() { return "got"; }, b: 2 })],
  ["a proxy of an object", () => new Proxy({ a: 1, b: 2 }, { ownKeys: () => ["b", "a"] })],
  ["a proxy of an array", () => new Proxy([1, 2], {})],
  ["toJSON, which is told the key", () => ({ toJSON(key: string) { return typeof key + " " + key; } })],
  ["toJSON that answers undefined", () => ({ toJSON() { return undefined; } })],
  ["toJSON that answers a function", () => ({ toJSON() { return () => 1; } })],
  ["toJSON that answers an object with toJSON", () => ({ toJSON() { return { toJSON() { return "not called"; }, kept: 1 }; } })],
  ["toJSON below the value, which is told its own key", () => ({ inner: { toJSON(key: string) { return key; } }, list: [0, { toJSON(key: string) { return key; } }] })],
  ["toJSON that is not callable", () => ({ toJSON: 5, a: 1 })],
  ["a function with toJSON", () => Object.assign(() => 1, { toJSON() { return "from a function"; } })],
  ["more text than the first buffer holds", () => Array.from({ length: 2500 }, (_, i) => ({ i }))],
  ["one long string", () => word.repeat(20000)],
  ["long text that turns wide at the end", () => [word.repeat(9000), "конец"]],
  ["an own toJSON behind a long member, which is told the key", () => ({ long: word.repeat(9000), toJSON(key: string) { return key; } })],
  ["an own toJSON behind a wide member, which is told the key", () => ({ wide: "значение", toJSON(key: string) { return key; } })],
  ["an own toJSON behind a wide and a long member", () => ({ wide: "значение", long: word.repeat(9000), toJSON(key: string) { return key; } })],
  ["long text under toJSON", () => Object.assign([word.repeat(9000)], { toJSON(key: string) { return [key, word.repeat(9000)]; } })],
];

const brief = (text: string) => (text.length <= 220 ? text : text.length + " " + text.slice(0, 60) + " .. " + text.slice(-60));
for (const [name, make] of values) {
  show(name, () => [
    writeEnvelope(envelope(make())),
    writeEnvelope(envelope(make(), make())),
    writeFirst({ data: make(), id: 1 }),
    writeLast({ id: 1, data: make() }),
    writeOnly({ data: make() }),
    writeList({ id: 1, items: [make()], end: "e" }),
    writeList({ id: 1, items: [0, make(), "s", make()], end: "e" }),
  ].map(brief).join(" | "));
}

show("a bigint", () => writeEnvelope(envelope(1n)));
show("a bigint with toJSON", () => {
  (BigInt.prototype as any).toJSON = function (key: string) { return key + "=" + this; };
  try { return writeEnvelope(envelope(1n, [2n])); } finally { delete (BigInt.prototype as any).toJSON; }
});
show("a cycle through the value", () => { const e = envelope(null); e.data = { back: e }; return writeEnvelope(e); });
show("a cycle inside the value", () => { const o: any = {}; o.self = [o]; return writeEnvelope(envelope(o)); });
show("the same object twice", () => { const o = { a: 1 }; return writeEnvelope(envelope(o, o)); });

show("toJSON throws, and the next write starts clean", () => {
  const thrower = { toJSON() { throw new RangeError("from toJSON"); } };
  const out: string[] = [];
  for (const e of [envelope(thrower), envelope(1, thrower), envelope([0, thrower])]) {
    try { out.push(writeEnvelope(e)); } catch (error) { out.push((error as Error).message); }
    out.push(writeEnvelope(envelope(2)));
  }
  return out.join(" | ");
});
show("a getter throws below the value", () => writeEnvelope(envelope({ a: 1, get b(): number { throw new TypeError("from a getter"); } })));
show("toJSON writes the same kind of record", () => writeEnvelope(envelope({ toJSON() { return writeEnvelope(envelope(1)); } }, { toJSON() { return [writeLast({ id: 2, data: { toJSON() { return writeOnly({ data: 3 }); } } })]; } })));
show("toJSON changes the record it is in", () => {
  const e = envelope(null);
  e.data = { toJSON() { e.name = "changed"; (e as any).added = 1; delete (e as any).ok; return "x"; } };
  return writeEnvelope(e) + " " + writeEnvelope(e);
});
show("toJSON replaces a later member by a value of another kind", () => {
  const e = envelope(null);
  e.data = { toJSON() { (e as any).name = { now: "an object" }; (e as any).ok = "yes"; return 0; } };
  return writeEnvelope(e);
});
show("toJSON redefines a later member as a getter", () => {
  const e = envelope(null);
  e.data = { toJSON() { Object.defineProperty(e, "name", { get() { return "by getter"; }, enumerable: true }); return 0; } };
  return writeEnvelope(e);
});
show("toJSON hides a later member", () => {
  const e = envelope(null);
  e.data = { toJSON() { Object.defineProperty(e, "name", { enumerable: false }); return 0; } };
  return writeEnvelope(e);
});
show("toJSON gives the record a toJSON", () => {
  const e = envelope(null);
  e.data = { toJSON() { (e as any).toJSON = () => "too late for this write"; return 0; } };
  return writeEnvelope(e) + " " + writeEnvelope(e);
});
show("an element changes the list it is in", () => {
  const items: unknown[] = [1, null, 3, 4];
  items[1] = { toJSON() { items[2] = { swapped: true }; items.length = 3; return "x"; } };
  return writeList({ id: 1, items, end: "e" });
});
show("an element changes the record around the list", () => {
  const l: List = { id: 1, items: [], end: "e" };
  l.items.push({ toJSON() { l.end = "changed"; (l as any).added = true; return 0; } });
  return writeList(l) + " " + writeList(l);
});

show("values of other kinds than declared", () => [
  writeWrong(launder({ id: "one", name: 2, tags: { not: "an array" }, at: "a string" } as unknown as Wrong)),
  writeWrong(launder({ id: null, name: undefined, tags: null, at: undefined } as unknown as Wrong)),
  writeWrong(launder({ id: [1], name: ["n"], tags: [["deep"]], at: [new Date(0)] } as unknown as Wrong)),
  writeWrong(launder({ id: 1, name: "n", tags: ["t"], at: new Date(0) })),
  writeWrong(launder({ id: 1, name: "n", tags: ["t"], at: Object.assign(new Date(0), { toJSON() { return "own toJSON"; } }) })),
].join(" | "));

show("beside other text", () => "<" + writeEnvelope(envelope({ a: 1 })) + ">" + `[${JSON.stringify(envelope([{ b: 2 }]))}]` + JSON.stringify({ data: undefined } as Only) + String(JSON.stringify(launder(undefined))));

show("many times over", () => {
  const plain = JSON.parse('{"x":1,"y":[true,"s"]}');
  const e = launder(envelope(plain, [plain, 2]));
  let total = 0;
  for (let i = 0; i < 20000; i++) total += writeEnvelope(e).length;
  return total + " " + writeEnvelope(e);
});
