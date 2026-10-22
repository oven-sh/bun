// Object literals with getters and setters, made again and again: what they have, in which order, with which attributes; a getter and a setter of one name, side by side and apart; an accessor over a value and a
// value over an accessor; names that are indices, computed names, symbols, __proto__; many accessors (storage out of line); literals with a spread, with a prototype; accessors that close over what differs each time;
// classes, whose accessors are not enumerable. Once warm, a literal's accessors ask the engine next to nothing. Only the jsc shell can count; elsewhere the count is zero.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const lines = [];
const show = o => Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ":" + ("value" in d ? (typeof d.value === "function" || typeof d.value === "object" && d.value ? typeof d.value : String(d.value)) + (d.writable ? "w" : "-") : (d.get ? "g" : "-") + (d.set ? "s" : "-")) + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-"); }).join(" ");
function context(state) {
    return { get locals() { return state.locals; }, get cookies() { return state.cookies; }, url: state.url, get both() { return state.b; }, set both(v) { state.b = v; }, last: 2, set only(v) { state.only = v; } };
}
const state = { locals: "l", cookies: "c", url: "u", b: 1 };
const made = context(state);
made.both = 5; made.only = 6;
lines.push(show(made), [made.locals, made.cookies, made.url, made.both, made.only, state.only].join(), JSON.stringify(made), Object.keys(made).join());
lines.push(Object.getOwnPropertyDescriptor(made, "locals").get.name, Object.getOwnPropertyDescriptor(made, "only").set.name, Object.getOwnPropertyDescriptor(made, "locals").set === undefined, Object.getOwnPropertyDescriptor(made, "only").get === undefined);
lines.push(context(state).locals === made.locals, Object.getOwnPropertyDescriptor(context(state), "locals").get !== Object.getOwnPropertyDescriptor(made, "locals").get);
function apart(x) { return { get a() { return x; }, b: 1, set a(v) { x = v; }, get c() { return 3; }, set b(v) {}, c: "value over an accessor", get b() { return "b"; } }; }
const parted = apart(1);
parted.a = 9;
lines.push(show(parted), parted.a, parted.b, parted.c);
function twice() { return { get a() { return 1; }, get a() { return 2; }, set z(v) {}, set z(v) { this.seen = v; } }; }
const doubled = twice(); doubled.z = 4;
lines.push(show(doubled), doubled.a);
const symbol = Symbol("s"), computed = "named";
function keys() { return { get 0() { return "zero"; }, get 1.5() { return "one and a half"; }, get [computed]() { return "computed"; }, get [symbol]() { return "symbol"; }, set 0(v) {}, get "quoted name"() { return "quoted"; }, get __proto__() { return "own accessor"; } }; }
lines.push(show(keys()), keys()[0], keys()[symbol], keys().__proto__, Object.getPrototypeOf(keys()) === Object.prototype);
function many(n) {
    return { get a() { return n; }, get b() { return n + 1; }, get c() { return n + 2; }, get d() { return n + 3; }, get e() { return n + 4; }, get f() { return n + 5; }, get g() { return n + 6; }, get h() { return n + 7; }, get i() { return n + 8; },
        get j() { return n + 9; }, get k() { return n + 10; }, get l() { return n + 11; }, get m() { return n + 12; }, get o() { return n + 13; }, get p() { return n + 14; }, get q() { return n + 15; }, get r() { return n + 16; }, get s() { return n + 17; }, tail: n };
}
lines.push(show(many(1)), Object.values(many(10)).join());
function others(base, more) { return [{ ...more, get x() { return 1; } }, { __proto__: base, get x() { return 2; } }, { get x() { return 3; }, ...more }, Object.freeze({ get x() { return 4; } }), { x: 0, get x() { return 5; } }, { get x() { return 6; }, x: 7 }]; }
lines.push(others({ inherited: 1 }, { x: "spread", y: 2 }).map(o => show(o) + "=" + o.x).join(" | "), others(null, null).map(o => o.x).join());
class Kept { get a() { return 1; } set a(v) {} static get b() { return 2; } }
lines.push(show(Kept.prototype), show(Kept), new Kept().a, Kept.b);
function thisIn() { return { n: 5, get double() { return this.n * 2; }, set double(v) { this.n = v / 2; } }; }
const self = thisIn(); self.double = 20;
lines.push(self.n, self.double, Object.create(self).double);
const kept = [];
for (let i = 0; i < 300; i++) { context(state); many(i); apart(i); thisIn(); }
const asked = () => count("operationAOTDefineAccessor");
const before = asked();
let check = 0;
for (let i = 0; i < 3000; i++) {
    const c = context({ locals: i, cookies: i + 1, url: "u", b: 2 }), m = many(i);
    if (i % 500 === 0) kept.push(c, m);
    check = (check + c.locals + c.cookies + c.both + m.a + m.s + m.tail) % 100003;
}
lines.push("the engine is asked at most 300 times for 69000 accessors: " + (asked() - before <= 300), check + " " + kept.map(o => Object.values(o).join()).join(" / "));
console.log(lines.join("\n"));
