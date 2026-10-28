// A captured variable is stored by closures, patterns, loops, handlers and resumed generators, once or many times.
const out = [];
function* g1() { let x = 1; const set = v => { x = v; }; yield set; yield x; yield x; }
{ const it = g1(); const set = it.next().value; set(2); out.push(it.next().value); set(3); out.push(it.next().value); }
function* g2() { let x = 1; x = yield () => x; yield x; }
{ const it = g2(); const read = it.next().value; out.push(read()); it.next(5); out.push(read()); }
function* g3() { let x = 1; try { yield () => x; } finally { x = 9; } }
{ const it = g3(); const read = it.next().value; it.return(); out.push(read()); }
function* g4() { let x = 1; try { yield () => x; } catch (e) { x = e; yield 0; } }
{ const it = g4(); const read = it.next().value; it.throw(7); out.push(read()); }
function* g5() { let x = 0; for (;;) { const r = () => x; x = (yield r) + x; } }
{ const it = g5(); const r = it.next().value; it.next(1); it.next(2); out.push(r()); }
async function a1() { let x = 1; const set = v => { x = v; }; setters.push(set); await null; return x; }
const setters = []; { const p = a1(); setters[0](4); out.push(await p); }
async function* ag() { let x = 1; yield v => { x = v; }; yield x; }
{ const it = ag(); (await it.next()).value(6); out.push((await it.next()).value); }
function counter() { let n = 0; return { inc() { n++; }, get() { return n; } }; }
{ const c = counter(), d = counter(); c.inc(); c.inc(); d.inc(); out.push(c.get(), d.get()); }
{ const fns = []; for (let i = 0; i < 3; i++) { fns.push(() => i); } out.push(fns.map(f => f())); }
{ const fns = []; for (let i = 0; i < 3; i++) { fns.push(() => i++); } out.push(fns.map(f => f()), fns.map(f => f())); }
{ const fns = []; for (let i = 0; i < 6; i++) { fns.push(() => i); i++; } out.push(fns.map(f => f())); }
{ const fns = []; for (let i = 0, inc = () => i++; i < 3; inc()) { fns.push(() => i); if (fns.length > 5) break; } out.push(fns.length); }
function once() { let v; const set = x => { v = x; }; [1, 2, 3].forEach(set); return v; } out.push(once());
function onceGetter() { let v = 0; const o = { get a() { return ++v; } }; o.a; o.a; return v; } out.push(onceGetter());
function onceToString() { let v = 0; const o = { toString() { v++; return ""; } }; `${o}${o}`; return v; } out.push(onceToString());
function onceIter() { let v = 0; const o = { *[Symbol.iterator]() { v++; yield 1; } }; [...o, ...o]; return v; } out.push(onceIter());
function onceProxy() { let v = 0; const p = new Proxy({}, { get() { return ++v; } }); p.a; p.b; return v; } out.push(onceProxy());
function onceTag() { let v = 0; const t = () => { v++; }; t``; t``; return v; } out.push(onceTag());
function onceSort() { let v = 0; [3, 1, 2].sort((a, b) => { v = a; return a - b; }); return typeof v; } out.push(onceSort());
function onceBound() { let v = 0; const f = function () { v += 1; }.bind(null); f(); f(); return v; } out.push(onceBound());
function onceRecursion(n) { let v = 0; (function r(k) { v = k; if (k) r(k - 1); })(n); return v; } out.push(onceRecursion(3));
function onceTimer() { return new Promise(res => { let v = 0; const t = setInterval(() => { v++; if (v === 3) { clearInterval(t); res(v); } }, 1); }); } out.push(await onceTimer());
function paramDefault(a, g = () => a) { var a = 2; return [g(), a]; } out.push(paramDefault(1));
function paramDefault2(a = 1, b = () => a) { a = 5; return b(); } out.push(paramDefault2());
function paramDefault3(a, b = () => { a = 8; }) { b(); return a; } out.push(paramDefault3(1));
function destructure() { let x = 1, y = 2; const g = () => [x, y]; [x, y] = [y, x]; return g(); } out.push(destructure());
function destructure2() { let x; const g = () => x; ({ a: x } = { a: 3 }); return g(); } out.push(destructure2());
function destructure3() { let x; const g = () => x; for (x of [1, 2]); return g(); } out.push(destructure3());
function destructure4() { let x; const g = () => x; for (x in { k: 1 }); return g(); } out.push(destructure4());
function destructure5() { let x; const g = () => x; for ([x] of [[4]]); return g(); } out.push(destructure5());
function destructure6() { let x; const g = () => x; [x = 5] = []; return g(); } out.push(destructure6());
function destructure7() { let x; const g = () => x; [...x] = [6]; return g(); } out.push(destructure7());
function destructure8() { let x; const g = () => x; ({ ...x } = { q: 7 }); return g(); } out.push(destructure8());
function catchParam() { let g; try { throw 1; } catch (e) { g = () => e; e = 2; } return g(); } out.push(catchParam());
function classScope() { let g; class C { static m() { return C; } static { g = () => C; } } const D = C; return g() === D; } out.push(classScope());
function fnName() { const f = function me() { try { me = 1; } catch (e) { return e.name; } return typeof me; }; return f(); } out.push(fnName());
function update() { let x = 1; const g = () => x; x++; ++x; x += 1; x **= 2; x ||= 0; x &&= x + 1; x ??= 0; return g(); } out.push(update());
function tdz() { const g = () => x; try { g(); } catch (e) { out.push(e.name); } let x = 1; return g(); } out.push(tdz());
function sw(v) { let g; switch (v) { case 1: let x = 1; g = () => x; case 2: x = 2; } return g(); } out.push(sw(1));
function lbl() { let x = 0; const g = () => x; a: for (;;) { for (;;) { x++; if (x > 2) break a; continue a; } } return g(); } out.push(lbl());
function fin() { let x = 0; const g = () => x; for (let i = 0; i < 3; i++) { try { continue; } finally { x = i; } } return g(); } out.push(fin());
function catchLoop() { let x = 0; const g = () => x; for (let i = 0; i < 3; i++) { try { throw i; } catch (e) { x = e; } } return g(); } out.push(catchLoop());
console.log(JSON.stringify(out));
