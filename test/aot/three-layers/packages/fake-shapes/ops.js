export function sumForIn(o) { let s = ""; for (const k in o) s += k + "=" + String(o[k]).slice(0, 12) + ";"; return s; }
export function copyForIn(o) { const c = {}; for (const k in o) c[k] = o[k]; return c; }
export function countOwn(o) { let n = 0; for (const k in o) if (Object.prototype.hasOwnProperty.call(o, k)) n++; return n; }
export const withSuper = { __proto__: null, name: "withSuper", hi() { return "pkg hi > " + super.hi(); }, get prop() { return "pkg prop > " + super.prop; }, set prop(v) { super.prop = v + "!"; }, at(k) { return super[k]; } };
export function setParent(child, parent) { Object.setPrototypeOf(child, parent); return child; }
export function slotAccessors(seed) { let hidden = seed; return { plain: seed, get got() { return hidden; }, set got(v) { hidden = v * 2; }, get only() { return "only " + this.plain; } }; }
export function addAccessors(o, name) { Object.defineProperty(o, name, { get() { return "added " + name + " " + (this.n ?? this.name ?? "?"); }, set(v) { this["_" + name] = v; }, enumerable: true, configurable: true }); return o; }
export function addMethods(o) { return Object.assign(o, { added() { return "added on " + (this.name ?? this.n); }, ["comp" + "uted"]() { return 1; } }); }
export function jsonOf(o) { return JSON.stringify(o); }
export function jsonOfAll(list) { let s = ""; for (let i = 0; i < list.length; i++) s += JSON.stringify(list[i]).length + ","; return s; }
export function templateOf(o) { return `${o.name}:${o.n}:${o.level}`; }
const table = new Map();
export function putPair(a, b, v) { table.set(a + ":" + b, v); return table.size; }
export function getPair(a, b) { return table.get(a + ":" + b); }
export function hasPair(key) { return table.has(key); }
export function passArguments() { return arguments; }
export function readArguments(a) { return [a.length, a[0], a[1], Array.prototype.join.call(a, "+"), typeof a.callee]; }
export function sloppyArguments(a, b) { arguments[0] = "changed"; return [a, b, arguments.length]; }
export function applyTo(f, self, list) { return f.apply(self, list); }
export function constructFrom(C, list) { return new C(...list); }
export function nameIt(key, f) { return { [key]: f }[key]; }
export function anonymous() { return [function () {}, () => {}, class {}, async () => {}, function* () {}]; }
export function startsWithPkg(s) { return [s.startsWith("pkg"), s.endsWith("end"), s.indexOf("mid"), s.includes("x"), s === "pkg-mid-end", s < "pkh", s.localeCompare("pkg-mid-end"), s + "", s.split("-").length, s.replace("mid", "MID"), s.toUpperCase(), s.trim().length, s.padStart(14, "*"), s.at(-1), s.charCodeAt(0), s.slice(4, 7), s.repeat(2).length]; }
export const constant = "pkg-mid-end";
export function evalIn(text) { const local = "local of the package"; return eval(text); }
export function add(a, b) { return a + b; }
export function less(a, b) { return [a < b, a <= b, a == b, a === b]; }
export function negate(a) { return [-a, +a, ~a, !a, typeof a, a >>> 0]; }
export function libraryOfPackage(name) { return { fs: require("node:fs"), events: require("node:events"), path: require("node:path"), util: require("node:util"), stream: require("node:stream"), perf: require("node:perf_hooks"), timers: require("node:timers"), http: require("node:http"), als: require("node:async_hooks") }[name]; }
export function libraryByName(name) { return require(name); }
