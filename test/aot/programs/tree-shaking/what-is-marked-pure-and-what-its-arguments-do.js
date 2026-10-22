// A mark before a call or a `new` lets it go when its result is not used. What the arguments do stays or goes with the whole call, as the bundler has it. The calls stand in constants, in exports, in statements, in arguments of other marked calls, in class fields and after extends.
const log = [];
const effect = name => { log.push(name); return name; };
const make = name => { log.push("make " + name); return { name }; };
class Made { constructor(name) { log.push("new Made " + name); } }

const a = /* @__PURE__ */ make("a constant nothing reads");
const b = /* @__PURE__ */ new Made("a constant nothing reads");
const c = /* @__PURE__ */ make(effect("an argument with an effect"));
const d = /* @__PURE__ */ make(/* @__PURE__ */ make("marked inside marked"));
const e = /* @__PURE__ */ make(make("not marked inside marked"));
const f = [/* @__PURE__ */ make("in an array nothing reads")];
const g = { key: /* @__PURE__ */ make("in an object nothing reads") };
const h = () => /* @__PURE__ */ make("in a function nobody calls");
export const i = /* @__PURE__ */ make("an export of the entry point");
class J { static field = /* @__PURE__ */ make("a static field of a class nothing names"); }
class K extends (/* @__PURE__ */ make("after extends"), Object) {}
const l = /* @__PURE__ */ make("used");
const m = /* @__PURE__ */ (() => effect("a marked function called on the spot"))();
const o = /* @__PURE__ */ make?.("an optional call");
const p = /* @__PURE__ */ make("spread argument", ...[effect("in a spread")]);
const q = true ? /* @__PURE__ */ make("an arm") : 0;
/* @__PURE__ */ make("a statement");
/* @__PURE__ */ new Made("a statement");
void /* @__PURE__ */ make("under void");

console.log(l.name);
console.log(log.join("\n"));
