// In object literals made again and again: a setter behind the getter of the same name and a getter behind the setter (one property with both), with other members between the two; an accessor under a name that a
// spread or an earlier member has given a value; a value over an accessor; a getter over a getter. What each object has, in which order and with which attributes; that no two objects share an accessor's pair; that
// the half defined first is still what it was. Once warm, none of it asks the engine. Only the jsc shell can count; elsewhere the count is zero.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const lines = [];
const show = o => Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ":" + ("value" in d ? String(d.value) + (d.writable ? "w" : "-") : (d.get ? "g" : "-") + (d.set ? "s" : "-")) + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-"); }).join(" ");
function pair(state) { return { get locals() { return state.n; }, set locals(v) { state.n = v; }, tail: 1 }; }
function reversed(state) { return { set locals(v) { state.n = v; }, get locals() { return state.n; }, tail: 1 }; }
function apart(state) { return { get a() { return state.n; }, b: 1, get c() { return 3; }, set a(v) { state.n = v; }, d: 4, set c(v) { state.c = v; } }; }
function overSpread(options, self) { return { ...options, get locals() { return self.n; } }; }
function overMember(self) { return { locals: 0, other: 1, get locals() { return self.n; }, set other(v) { self.o = v; } }; }
function valueOver(self) { return { get locals() { return self.n; }, locals: "value" }; }
function getterOver(self) { return { get locals() { return 1; }, get locals() { return self.n; } }; }
const state = { n: 1 };
for (const make of [pair, reversed, apart]) { const o = make(state); lines.push(show(o)); }
const p = pair(state), q = pair({ n: 10 }); p.locals = 5; lines.push(p.locals, q.locals, state.n);
lines.push(Object.getOwnPropertyDescriptor(p, "locals").get !== Object.getOwnPropertyDescriptor(q, "locals").get, Object.getOwnPropertyDescriptor(p, "locals").get.name, Object.getOwnPropertyDescriptor(p, "locals").set.name);
const r = reversed(state); r.locals = 6; lines.push(r.locals, state.n); const a = apart(state); a.a = 7; a.c = 8; lines.push(a.a, a.c, state.c, JSON.stringify(a));
lines.push(show(overSpread({ addCookieHeader: false, locals: "given", last: 1 }, state)), overSpread({ locals: "given" }, state).locals, show(overSpread({ other: 1 }, state)), show(overSpread(undefined, state)), show(overSpread({ get locals() { return "read once"; } }, state)));
lines.push(show(overMember(state)), overMember(state).locals, show(valueOver(state)), show(getterOver(state)), getterOver(state).locals);
const frozenSource = Object.freeze({ locals: 1 }); lines.push(show(overSpread(frozenSource, state)));
const options = { addCookieHeader: false, clientAddress: undefined, locals: "given", routeData: undefined };
const kept = [];
for (let i = 0; i < 300; i++) { pair(state); reversed(state); apart(state); overSpread(options, state); overMember(state); }
const asked = () => count("operationAOTDefineAccessor");
const before = asked();
let check = 0;
for (let i = 0; i < 3000; i++) {
    const own = { n: i }, one = pair(own), two = reversed(own), three = apart(own), four = overSpread(options, own), five = overMember(own);
    one.locals = i + 1; three.c = i;
    if (i % 500 === 0) kept.push(one, two, three, four, five);
    check = (check + one.locals + two.locals + three.a + three.c + own.c + four.locals + five.locals) % 100003;
}
lines.push("the engine is asked at most 300 times for 33000 accessors: " + (asked() - before <= 300), check + " " + kept.map(show).join(" / ").length);
console.log(lines.join("\n"));
