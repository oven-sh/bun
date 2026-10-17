import * as typed from "./shapes.ts";

const mark = Symbol("mark");

function show(value) {
  return JSON.stringify(value, (key, inner) => (typeof inner === "symbol" ? String(inner) : inner));
}
function withSymbols(o) {
  return Reflect.ownKeys(o).map(key => String(key) + "=" + show(o[key])).join();
}

function listings(o, isRecord) {
  const said = [
    "keys " + Object.keys(o),
    "names " + Object.getOwnPropertyNames(o),
    "own " + Reflect.ownKeys(o).map(String),
    "symbols " + Object.getOwnPropertySymbols(o).map(String),
    "entries " + show(Object.entries(o)),
    "values " + show(Object.values(o)),
    "assign " + withSymbols(Object.assign({}, o)),
    "assign onto " + withSymbols(Object.assign({ tag: "there", z: 1 }, o)),
    "spread " + withSymbols({ ...o }),
    "spread between " + withSymbols({ a: 0, ...o, tag: "later" }),
    "json " + JSON.stringify(o),
  ];
  let loop = "";
  for (const key in o) loop += key + ";";
  said.push("loop " + loop);
  const { tag, ...others } = o;
  said.push("rest " + withSymbols(others));
  if (isRecord)
    said.push("typed " + typed.typedKeys(o) + " | " + show(typed.typedEntries(o)) + " | " + show(typed.typedValues(o)) + " | " + withSymbols(typed.typedAssign(o)) + " | " + withSymbols(typed.typedSpreadWithMore(o)) + " | " + withSymbols(typed.typedRest(o)) + " | " + typed.typedLoop(o));
  else
    said.push("typed " + typed.typedMessageKeys(o) + " | " + withSymbols(typed.typedMessageSpread(o)));
  return said.join("\n  ");
}

const note = (o, text) => (o instanceof typed.Message ? o.setNote(text) : typed.setNote(o, text));
const code = (o, number) => (o instanceof typed.Message ? o.setCode(number) : typed.setCode(o, number));

const givers = {
  nothing(o) {},
  one(o) { o.tag = 1; },
  three(o) { o.a = 1; o.tag = { deep: true }; o.c = "c"; },
  ten(o) { for (let i = 0; i < 10; i++) o["n" + i] = i; },
  betweenFields(o) { o.before = 1; note(o, "n"); o.tag = 3; code(o, 4); o.after = 5; },
  symbol(o) { o.tag = 1; o[mark] = 2; o.last = 3; },
  index(o) { o[3] = "three"; o.tag = 1; o[1] = "one"; },
  hidden(o) { o.tag = 1; Object.defineProperty(o, "unseen", { value: 2, enumerable: false, configurable: true, writable: true }); o.last = 3; },
  hiddenSymbol(o) { o.tag = 1; Object.defineProperty(o, mark, { value: 2, enumerable: false, configurable: true, writable: true }); },
  getter(o) { o.tag = 1; Object.defineProperty(o, "computed", { get() { return this.tag + 100; }, enumerable: true, configurable: true }); },
  readOnly(o) { Object.defineProperty(o, "fixed", { value: 1, enumerable: true, configurable: true, writable: false }); o.tag = 2; },
  deleted(o) { o.a = 1; o.tag = 2; o.c = 3; delete o.a; },
  deletedThenField(o) { o.a = 1; o.tag = 2; delete o.a; note(o, "n"); o.c = 3; },
  frozen(o) { o.tag = 1; Object.freeze(o); },
  toJSON(o) { o.tag = 1; o.toJSON = function () { return { replaced: this.tag }; }; },
  proto(o) { o.tag = 1; Object.defineProperty(o, "__proto__", { value: 5, enumerable: true, configurable: true, writable: true }); },
};

export function run() {
  for (const [kind, make] of [["record", () => typed.makeProps(7)], ["instance", () => new typed.Message()]]) {
    for (const giver in givers) {
      const said = new Set();
      for (let i = 0; i < 4; i++) {
        const o = make();
        givers[giver](o);
        said.add(listings(o, kind === "record"));
      }
      console.log(kind, giver, said.size + "\n  " + [...said][0]);
    }
  }

  const o = typed.makeProps(1);
  const steps = [
    () => { o.tag = 1; },
    () => { o.more = 2; },
    () => { typed.setNote(o, "n"); },
    () => { delete o.tag; },
    () => { o.tag = 3; },
    () => { Object.defineProperty(o, "more", { enumerable: false }); },
    () => { Object.defineProperty(o, "more", { enumerable: true }); },
    () => { o[mark] = 4; },
    () => { delete o[mark]; },
    () => { typed.setCode(o, 5); },
    () => { o[0] = "zero"; },
    () => { delete o[0]; },
  ];
  for (const step of steps) {
    step();
    for (let i = 0; i < 3; i++) console.log("step", String(Object.keys(o)), "|", Reflect.ownKeys(o).map(String).join(), "|", show(Object.entries(o)), "|", withSymbols({ ...o }));
  }

  function loopDeleting(target, victim) {
    let seen = "";
    for (const key in target) {
      seen += key + ";";
      delete target[victim];
    }
    return seen;
  }
  function loopAdding(target) {
    let seen = "";
    for (const key in target) {
      seen += key + ";";
      target["added" + seen.length] = 1;
    }
    return seen + Object.keys(target).length;
  }
  function keysAsking(target, victim) {
    let seen = "";
    for (const key of Object.keys(target)) {
      seen += key + Object.hasOwn(target, key) + (key in target) + String(target[key] === undefined) + ";";
      delete target[victim];
    }
    return seen;
  }
  const kinds = {
    record: () => { const made = typed.makeProps(1); made.tag = 1; made.more = 2; typed.setNote(made, "n"); made.last = 3; return made; },
    recordTaggedByTypedCode: () => { const made = typed.makeProps(1); typed.tagProps(made, 1); typed.setNote(made, "n"); return made; },
    instance: () => { const made = new typed.Message(); made.tag = 1; made.more = 2; made.setNote("n"); made.last = 3; return made; },
    instanceTaggedByTypedCode: () => { const made = new typed.Message(); typed.tagMessage(made, 1); made.setNote("n"); return made; },
    packed: () => { const made = new typed.Packed(); made.tag = 1; made.more = 2; made.setNote("n"); made.last = 3; return made; },
    recordOnlyTagged: () => { const made = typed.makeProps(1); typed.tagProps(made, 1); return made; },
    instanceOnlyTagged: () => { const made = new typed.Message(); typed.tagMessage(made, 1); return made; },
    packedOnlyTagged: () => { const made = new typed.Packed(); typed.tagPacked(made, 1); return made; },
    packedWithField: () => { const made = new typed.Packed(); made.setNote("n"); typed.tagPacked(made, 1); return made; },
    underKeysOnly: () => { const made = new typed.Message(); for (const key of ["tag", "more"]) made[key] = 1; return made; },
    underKeys: () => { const made = new typed.Message(); for (const key of ["tag", "more"]) made[key] = 1; made.setNote("n"); return made; },
  };
  for (const kind in kinds) {
    for (const victim of ["more", "note", "last", "tag", "nothing"]) {
      const said = new Set();
      for (let i = 0; i < 6; i++) {
        said.add(loopDeleting(kinds[kind](), victim) + " | " + keysAsking(kinds[kind](), victim) + " | " + loopAdding(kinds[kind]())
          + (kind.startsWith("record") ? " | " + typed.typedLoopDeleting(kinds[kind](), victim) + " | " + typed.typedKeysAsking(kinds[kind](), victim) : ""));
      }
      console.log("loops", kind, victim, said.size, [...said][0]);
    }
  }

  let sum = 0;
  for (let i = 0; i < 30000; i++) {
    const made = i & 1 ? typed.makeProps(i) : new typed.Message();
    made["k" + (i % 5)] = i;
    if (i % 3 === 0) note(made, "n");
    made.tag = i;
    const keys = Object.keys(made);
    sum += keys.length + keys[keys.length - 1].length + Object.values(made).length + Object.keys({ ...made }).length;
    if (typeof Bun !== "undefined" && i % 10000 === 9999) Bun.gc(true);
  }
  console.log("many", sum);
}
