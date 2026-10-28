// Each evaluation of a class expression has static fields of its own, whatever their keys are and whatever is done to the class object.
const out = [];
function make(v) { return class { static x = v; static read() { return this.x; } static own() { return make.last.x; } }; }
const A = make(1), B = make(2); make.last = A; out.push(A.read(), B.read(), A.own()); A.x = 10; out.push(A.read(), B.read()); B.x = 20; out.push(A.read(), B.read());
function make2(v) { class C { static x = v; static read() { return C.x; } } return C; }
const C1 = make2(1), C2 = make2(2); out.push(C1.read(), C2.read()); C1.x = 5; out.push(C1.read(), C2.read());
const list = []; for (let i = 0; i < 3; i++) list.push(class { static n = i; static get() { return list[i].n; } }); list[1].n = 9; out.push(list.map(c => c.get()));
const mix = Base => class extends Base { static tag = Base.name; static t() { return this.tag; } };
class X {} class Y {} const MX = mix(X), MY = mix(Y); out.push(MX.t(), MY.t()); MX.tag = "z"; out.push(MX.t(), MY.t());
class S { static count = 0; constructor() { S.count++; } } new S(); new S(); out.push(S.count); class S2 extends S {} new S2(); out.push(S.count, S2.count, Object.hasOwn(S2, "count")); S2.count++; out.push(S.count, S2.count);
class Lazy { static #i; static get i() { return Lazy.#i ??= new Lazy(); } } out.push(Lazy.i === Lazy.i);
class Init { static a = 1; static b = Init.a + 1; static c = this.b + 1; static d = (() => this.c + 1)(); } out.push(Init.a, Init.b, Init.c, Init.d);
class Order { static log = []; static a = Order.log.push("a"); static { Order.log.push("blk"); } static b = Order.log.push("b"); } out.push(Order.log.join());
class Comp { static ["a" + "b"] = 1; static [Symbol.for("s")] = 2; static 1 = 3; static "q r" = 4; } out.push(Comp.ab, Comp[Symbol.for("s")], Comp[1], Comp["1"], Comp["q r"]); Comp["a" + "b"] = 5; Comp[1] = 6; out.push(Comp.ab, Comp["1"]);
class Nm { static name = "custom"; static length = 9; } out.push(Nm.name, Nm.length); 
class Acc { static accessorBacking = 1; static get v() { return Acc.accessorBacking; } static set v(x) { Acc.accessorBacking = x; } } Acc.v = 7; out.push(Acc.v, Acc.accessorBacking); Reflect.set(Acc, "v", 8); out.push(Acc.accessorBacking); Object.assign(Acc, { v: 9 }); out.push(Acc.accessorBacking);
class Fz { static x = 1; } Object.freeze(Fz); out.push(Reflect.set(Fz, "x", 2), Fz.x, Object.isFrozen(Fz));
class Sl { static x = 1; } Object.seal(Sl); Sl.x = 2; out.push(Sl.x, Reflect.deleteProperty(Sl, "x"), Sl.x);
class Ro { static x = 1; } Object.defineProperty(Ro, "x", { writable: false }); out.push(Reflect.set(Ro, "x", 2), Ro.x);
class Re { static x = 1; } delete Re.x; Re.x = 2; out.push(Re.x, Object.keys(Re).join()); 
class Pr { static x = 1; } class Pr2 extends Pr {} delete Pr.x; out.push(Pr2.x);
console.log(JSON.stringify(out));
