// Each function is named once, where it is put into an object. From there it is copied by something that works on any object: Object.assign, entries and fromEntries, descriptors, a spread, a for-in loop, Reflect. The call is made on the copy, under a name that is put together.
function a() { return "Object.assign"; } function b() { return "fromEntries"; } function c() { return "defineProperties"; } function d() { return "descriptors"; }
function e() { return "a spread"; } function f() { return "a for-in loop"; } function g() { return "Reflect.set"; } function h() { return "Reflect.defineProperty"; }
function i() { return "Object.values"; } function j() { return "JSON-like walk"; } function k() { return "Object.groupBy"; } function l() { return "Array.from of entries"; }

const key = letter => ["k", "e", "y", letter].join("");
const viaAssign = Object.assign({}, { keyA: a });
const viaFromEntries = Object.fromEntries(Object.entries({ keyB: b }).map(([name, value]) => [name, value]));
const viaDefineProperties = Object.defineProperties({}, { keyC: { value: c } });
const viaDescriptors = Object.create(null, Object.getOwnPropertyDescriptors({ keyD: d }));
const viaSpread = { ...{ keyE: e } };
const viaLoop = {};
const source = { keyF: f };
for (const name in source) viaLoop[name] = source[name];
const viaReflectSet = {};
Reflect.set(viaReflectSet, "keyG", g);
const viaReflectDefine = {};
Reflect.defineProperty(viaReflectDefine, "keyH", { value: h });
console.log(viaAssign[key("A")](), viaFromEntries[key("B")](), viaDefineProperties[key("C")](), viaDescriptors[key("D")]());
console.log(viaSpread[key("E")](), viaLoop[key("F")](), Reflect.get(viaReflectSet, key("G"))(), Reflect.apply(viaReflectDefine[key("H")], null, []));
console.log(Object.values({ only: i })[0]());
function walk(value) { return typeof value === "function" ? value() : Object.keys(value).map(name => walk(value[name])).join(); }
console.log(walk({ deep: { deeper: [{ deepest: j }] } }));
console.log(Object.groupBy([k], () => "group").group[0](), new Map(Array.from(Object.entries({ x: l }))).get("x")());
