// Built-ins that work on any object store into static fields named length, lastIndex and 0, and callbacks of built-ins store through the class they are handed.
const out = [];
{ class A { static length = 1; static read() { return A.length; } } Array.prototype.push.call(A, "v"); out.push(A.read(), A[1]); }
{ class A { static length = 2; static 0 = "a"; static 1 = "b"; static read() { return [A[0], A[1]]; } } Array.prototype.reverse.call(A); out.push(A.read()); }
{ class A { static length = 2; static 0 = "a"; static 1 = "b"; static read() { return [A[0], A[1]]; } } Array.prototype.fill.call(A, 7); out.push(A.read()); }
{ class A { static length = 2; static 0 = "b"; static 1 = "a"; static read() { return [A[0], A[1]]; } } Array.prototype.sort.call(A); out.push(A.read()); }
{ class A { static length = 2; static 0 = "a"; static 1 = "b"; static read() { return [A[0], A[1], A.length]; } } Array.prototype.shift.call(A); out.push(A.read()); }
{ class A { static length = 2; static 0 = "a"; static 1 = "b"; static read() { return [A[0], A[1], A.length]; } } Array.prototype.pop.call(A); out.push(A.read()); }
{ class A { static length = 2; static 0 = "a"; static 1 = "b"; static read() { return [A[0], A[1], A.length]; } } Array.prototype.unshift.call(A, "z"); out.push(A.read()); }
{ class A { static length = 2; static 0 = "a"; static 1 = "b"; static read() { return [A[0], A[1], A.length]; } } Array.prototype.splice.call(A, 0, 1); out.push(A.read()); }
{ class A { static length = 2; static 0 = "a"; static 1 = "b"; static read() { return [A[0], A[1]]; } } Array.prototype.copyWithin.call(A, 0, 1); out.push(A.read()); }
{ class A { static flags = "g"; static lastIndex = 5; static exec() { return null; } static read() { return A.lastIndex; } } RegExp.prototype[Symbol.replace].call(A, "abc", "x"); out.push(A.read()); }
{ class A { static flags = "g"; static lastIndex = 5; static exec() { return null; } static read() { return A.lastIndex; } } RegExp.prototype[Symbol.match].call(A, "abc"); out.push(A.read()); }
{ class A { static lastIndex = 5; static exec() { A.seen = A.lastIndex; return null; } static read() { return [A.lastIndex, A.seen]; } } RegExp.prototype[Symbol.search].call(A, "abc"); out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } Object.fromEntries; Object.defineProperty(A, "x", Object.getOwnPropertyDescriptor({ x: 2 }, "x")); out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } [3].forEach(function (v) { this.x = v; }, A); out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } [4].map(function (v) { this.x = v; }, A); out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } (function (v) { this.x = v; }).call(A, 5); out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } (function (v) { this.x = v; }).apply(A, [6]); out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } (function (v) { this.x = v; }).bind(A)(7); out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } Reflect.apply(function (v) { this.x = v; }, A, [8]); out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } JSON.parse('{"a":9}', function (k, v) { if (k === "a") A.x = v; return v; }); out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } "z".replace(/z/, () => { A.x = 10; return ""; }); out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } new Map([[A, 11]]).forEach((v, k) => { k.x = v; }); out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } for (const c of new Set([A])) c.x = 12; out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } const [c] = [A]; c.x = 13; out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } Promise.resolve(A).then(c => { c.x = 14; }); await null; await null; out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } const wr = new WeakRef(A); wr.deref().x = 15; out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } Object.values({ A })[0].x = 16; out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } Array.from([A])[0].x = 17; out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } Object.getPrototypeOf(class extends A {}).x = 18; out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } } Object.getPrototypeOf(new A()).constructor.x = 19; out.push(A.read()); }
{ class A { static x = 1; static read() { return A.x; } static [Symbol.species] = 0; } Reflect.construct(Object, [], A).constructor.x = 20; out.push(A.read()); }
console.log(JSON.stringify(out));
