// A static field is stored, defined, deleted and frozen through other values that hold the class, and a method of the class reads it by name.
const out = [];
{ class A { static x = 1; static read() { return A.x; } } Object.assign(A, { x: 2 }); out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } Reflect.set(A, "x", 3); out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } Object.defineProperty(A, "x", { value: 4 }); out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } class B extends A {} Reflect.set(B, "x", 5, A); out.push(A.read(), Object.hasOwn(B, "x")); }
{ class A { static x = 1; static read() { return A.x; } } class B extends A { static m() { super.x = 6; } } B.m.call(A); out.push(A.read(), Object.hasOwn(B, "x")); }
{ class A { static x = 1; static read() { return A.x; } } new Proxy(A, {}).x = 7; out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } Reflect.set(new Proxy(A, {}), "x", 8); out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } const k = ["x"][0]; A[k] = 9; out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } for (const k in A) A[k] = 10; out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } delete A.x; out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } Reflect.deleteProperty(A, "x"); out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } A.__defineGetter__("x", () => 11); out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } Object.defineProperties(A, { x: { get() { return 12; } } }); out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } Object.freeze(A); try { A.x = 13; } catch (e) { out.push(e.name); } out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } static { A.x = 14; } } out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } static { this.x = 15; } } out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } static set(v) { this.x = v; } } A.set(16); out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } static set(v) { this.x = v; } } class B extends A {} B.set(17); out.push(A.read(), B.x); }
{ class A { static x = 1; static read() { return A.x; } } Object.assign(A, JSON.parse('{"x":18}')); out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } Object.entries({ x: 19 }).forEach(([k, v]) => { A[k] = v; }); out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } const o = { c: A }; o.c.x = 20; out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } [A.x] = [21]; out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } ({ v: A.x } = { v: 22 }); out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } for (A.x of [23]); out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } for (A.x in { twentyfour: 1 }); out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } A.x++; A.x += 2; A.x ??= 9; A.x &&= 25; out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } new A().constructor.x = 26; out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } A.prototype.constructor.x = 27; out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } m() { new.target; this.constructor.x = 28; } } new A().m(); out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } constructor() { new.target.x = 29; } } new A(); out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } Object.setPrototypeOf(A, { set x(v) { out.push("setter"); } }); A.x = 30; out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } structuredClone; globalThis.HOLD = A; globalThis.HOLD.x = 31; out.push(A.read()); }
console.log(JSON.stringify(out));
