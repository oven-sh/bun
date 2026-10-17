// An object that untyped code makes is expected to keep the shape it was made with. Whatever JavaScript lets a program do to such an object only makes the access slower: every answer is plain Bun's.
import { literal, Thing, Kind, Heir, Guarded, Sometimes, Listening, Fields, Derived, Quiet, Keyed } from "./make.js";
import { read, store, strictStore } from "./use.js";
const makers = { literal: () => literal(null, 1, "n"), Thing: () => new Thing(null, 1, "n"), Kind: () => new Kind(null, 1, "n"), Heir: () => new Heir(null, 1, "n", 2), Guarded: () => Guarded(null, 1, "n"), SometimesEarly: () => new Sometimes(null, 1, "n", 9), SometimesNot: () => new Sometimes(null, 1, "n", 0), Listening: () => new Listening(null, 1, "n"), Fields: () => new Fields(null, 1, "n"), Derived: () => new Derived(null, 1, "n"), Quiet: () => new Quiet(null, 1, "n"), KeyedApart: () => new Keyed(null, 1, "n", "apart"), KeyedOver: () => new Keyed(null, 1, "n", "id") };
const log = [];
const alterations = {
  nothing(o) { return o; },
  added(o) { o.extra = 1; return o; },
  addedMany(o) { for (let i = 0; i < 40; i++) o["k" + i] = i; return o; },
  deletedFirst(o) { delete o.raw; return o; },
  deletedRead(o) { delete o.id; return o; },
  deletedAndAddedAgain(o) { delete o.id; o.id = "again"; return o; },
  deletedLastAndAnotherAdded(o) { delete o.name; o.other = "other"; return o; },
  deletedAllAndFilledInAnotherOrder(o) { for (const key of Object.keys(o)) delete o[key]; o.name = "N"; o.id = "I"; o.sent = "S"; o.raw = "R"; return o; },
  getter(o) { Object.defineProperty(o, "id", { get() { log.push("get id"); return "got"; }, set(v) { log.push("set id " + v); }, configurable: true, enumerable: true }); return o; },
  getterOnly(o) { Object.defineProperty(o, "id", { get() { return "only"; }, configurable: true }); return o; },
  readOnly(o) { Object.defineProperty(o, "id", { writable: false }); return o; },
  hidden(o) { Object.defineProperty(o, "id", { enumerable: false }); return o; },
  fixed(o) { Object.defineProperty(o, "id", { configurable: false }); return o; },
  redefinedAsItWas(o) { Object.defineProperty(o, "id", { value: "same", writable: true, enumerable: true, configurable: true }); return o; },
  frozen(o) { return Object.freeze(o); },
  sealed(o) { return Object.seal(o); },
  notExtensible(o) { return Object.preventExtensions(o); },
  otherPrototype(o) { return Object.setPrototypeOf(o, { inherited: 1 }); },
  noPrototype(o) { return Object.setPrototypeOf(o, null); },
  prototypeWithSetter(o) { return Object.setPrototypeOf(o, { set id(v) { log.push("inherited setter " + v); }, get id() { return "inherited"; } }); },
  deletedUnderPrototypeWithSetter(o) { delete o.id; return Object.setPrototypeOf(o, { set id(v) { log.push("inherited setter " + v); }, get id() { return "inherited"; } }); },
  becamePrototype(o) { Object.create(o); return o; },
  heir(o) { return Object.create(o); },
  heirWithOwn(o) { const heir = Object.create(o); heir.id = "own"; return heir; },
  proxy(o) { return new Proxy(o, { get(target, key) { log.push("trap get " + String(key)); return Reflect.get(target, key); }, set(target, key, value) { log.push("trap set " + String(key)); return Reflect.set(target, key, value); } }); },
  revoked(o) { const { proxy, revoke } = Proxy.revocable(o, {}); revoke(); return proxy; },
  copy(o) { return { ...o }; },
  assigned(o) { return Object.assign({}, o); },
  parsed(o) { return JSON.parse(JSON.stringify(o)); },
  parsedInAnotherOrder() { return JSON.parse('{"name":"pn","id":"pi","sent":"ps","raw":"pr"}'); },
  sameNamesAnotherOrder() { return { name: "on", id: "oi", sent: "os", raw: "or" }; },
  fewerNames() { return { raw: 1, sent: 2 }; },
  indexed(o) { o[0] = "zero"; o[1] = "one"; return o; },
  symbolKeyed(o) { o[Symbol.iterator] = 1; return o; },
  array() { const a = [1, 2]; a.id = "array id"; return a; },
  func() { const f = function () {}; f.id = "function id"; return f; },
  string() { return "text"; },
  number() { return 7; },
  symbol() { return Symbol("s"); },
  undefinedValue() { return undefined; },
  nullValue() { return null; },
  holdsItself(o) { o.raw = o; return o; },
  underscoreProto(o) { o.__proto__ = { inherited: 2 }; return o; },
};
for (const [made, make] of Object.entries(makers)) {
  const usual = [make(), make(), make(), make()];
  for (let turn = 0; turn < 200; turn++) { read(usual); store(usual, turn, "t"); strictStore(usual, turn); }
  for (const [name, alter] of Object.entries(alterations)) {
    const list = [make(), alter(make()), make()];
    const before = read(list);
    const thrown = store(list, 5, "five");
    const strict = strictStore(list, 6);
    const after = read(list);
    let keys;
    try { keys = Object.keys(list[1]).slice(0, 8).join(); } catch (error) { keys = error.constructor.name; }
    console.log(made, name, before, thrown, strict, after, keys, log.splice(0).join("|"));
  }
}
