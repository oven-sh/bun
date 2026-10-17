// Functions made at run time ask `"name" in value` of plain objects and of objects of the program's own types, over and over, while names come and go.
interface Address { city: string; zip?: string }
interface User { id: number; name: string; ok: boolean; score: number; count: number; nick?: string; age?: number; flag?: boolean; address?: Address; anything?: unknown; nothing: null; missing: undefined }
class Point { x = 1; y = 2.5; label?: string; constructor(label?: string) { if (label !== undefined) this.label = label; } get length() { return 2; } method() {} }
const lines: string[] = [];
const collect: () => void = typeof (globalThis as any).gc === "function" ? (globalThis as any).gc : () => Bun.gc(true);
const askers: Record<string, (value: unknown) => boolean> = Object.create(null);
const has = (name: string) => (askers[name] ??= new Function("value", "return " + JSON.stringify(name) + " in value;") as (value: unknown) => boolean);
const say = (label: string, run: () => unknown) => {
  const seen: string[] = [];
  for (let turn = 0; turn < 5; turn++) {
    try {
      seen.push(String(run()));
    } catch (error) {
      seen.push("throws " + (error as Error).constructor.name);
    }
  }
  lines.push(label + ": " + seen.join(" "));
};
const names = ["id", "name", "ok", "score", "count", "nick", "age", "flag", "address", "anything", "nothing", "missing", "absent", "toString", "__proto__", "constructor"];
const full: User = { id: 1, name: "n", ok: false, score: 0.5, count: 0, nick: "k", age: 3, flag: false, address: { city: "c", zip: "z" }, anything: undefined, nothing: null, missing: undefined };
const bare: User = { id: NaN, name: "", ok: true, score: NaN, count: -1, nothing: null, missing: undefined };
const asked = (value: unknown) => names.map(name => (has(name)(value) ? "1" : "0")).join("");
say("every field", () => asked(full));
say("the optional ones absent", () => asked(bare));
say("in turn", () => asked(full) + " " + asked(bare));
say("the same data as a plain object", () => asked(JSON.parse(JSON.stringify(full))) + " " + asked({ ...bare }));
bare.nick = "later";
bare.age = 0;
bare.flag = true;
say("optional fields are stored", () => asked(bare));
bare.nick = undefined;
say("undefined is stored", () => asked(bare));
delete bare.nick;
delete bare.age;
say("two are deleted", () => asked(bare));
(bare as any).absent = 1;
say("a name that is no field is added", () => asked(bare));
delete (bare as any).absent;
say("and deleted", () => asked(bare));
say("an address", () => has("city")(full.address) + " " + has("zip")(full.address) + " " + has("zip")({ city: "c" } as Address));
say("an instance", () => ["x", "y", "label", "length", "method", "absent"].map(name => has(name)(new Point())).join(" "));
say("an instance with its label", () => ["x", "y", "label"].map(name => has(name)(new Point("l"))).join(" "));

const plain: Record<string, unknown> = { a: 1 };
say("before", () => has("later")(plain));
plain.later = undefined;
say("added", () => has("later")(plain));
delete plain.later;
say("deleted", () => has("later")(plain));
const base: Record<string, unknown> = {}, child = Object.create(base);
say("the parent lacks it", () => has("inherited")(child));
base.inherited = 1;
say("the parent has it", () => has("inherited")(child));
delete base.inherited;
say("the parent lost it", () => has("inherited")(child));
say("a proxy", () => has("anything")(new Proxy({}, { has: () => true })) + " " + has("anything")(new Proxy({}, {})));
say("a proxy in the chain", () => has("anything")(Object.create(new Proxy({}, { has: () => true }))));
say("an array", () => has("length")([]) + " " + has("absent")([]));
say("a function", () => has("name")(() => 1) + " " + has("prototype")(function () {}) + " " + has("prototype")(() => 1));
say("a string object", () => has("length")(new String("s")));
say("a typed array", () => has("length")(new Uint8Array(1)) + " " + has("byteLength")(new Uint8Array(1)));
say("no prototype", () => has("toString")(Object.create(null)));
say("a getter", () => has("got")({ get got() { throw new Error("not run"); } }));
for (const value of ["text", 5, true, undefined, null, Symbol.iterator, 5n]) say(typeof value, () => has("length")(value));
const dictionary: Record<string, number> = {};
for (let i = 0; i < 200; i++) dictionary["key" + i] = i;
for (let i = 0; i < 200; i += 2) delete dictionary["key" + i];
say("a dictionary", () => has("key2")(dictionary) + " " + has("key3")(dictionary));
delete dictionary.key3;
say("a dictionary loses a name", () => has("key3")(dictionary));

let count = 0;
for (let turn = 0; turn < 40000; turn++) {
  const value: User = turn % 3 ? full : turn % 2 ? bare : { id: turn, name: "t", ok: true, score: 1, count: 1, nothing: null, missing: undefined, nick: "n" };
  if (has("id")(value)) count += 1;
  if (has("nick")(value)) count += 10;
  if (has("absent")(value)) count += 100000000;
  if (turn % 10000 === 9999) collect();
}
lines.push("count " + count);
console.log(lines.join("\n"));
export {};
