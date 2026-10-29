// A variable has one store in the text, and the function around the store is entered again by calls, getters, conversions, proxies, timers and built-ins.
const out = [];
let a; async function ra() { await null; return a; } { const p = ra(); a = 5; out.push(await p); }
let b; function rb() { return b; } out.push(rb()); b = 1; out.push(rb());
let c = 1; function rc() { return c; } function wc() { c = 2; } out.push(rc()); wc(); out.push(rc());
let d; function wd(v) { d = v; } function rd() { return d; } wd(1); out.push(rd()); wd(2); out.push(rd());
let e; const we = v => { e = v; }; setTimeout(we, 0, 1); setTimeout(we, 1, 2); await new Promise(r => setTimeout(r, 10)); out.push(e);
let f; function wf() { f = (f ?? 0) + 1; } wf.call(); wf.apply(); Reflect.apply(wf, null, []); wf.bind()(); out.push(f);
let g; class G { constructor() { g = this; } } const g1 = new G(); const g2 = new G(); out.push(g === g2, g === g1);
let h; class H { static { h = 1; } } out.push(h); 
let i; function* wi() { i = 1; yield; i = 2; } { const it = wi(); it.next(); out.push(i); it.next(); out.push(i); const it2 = wi(); it2.next(); out.push(i); }
let j; const oj = { set v(x) { j = x; } }; oj.v = 1; oj.v = 2; out.push(j);
let k; const ok = { get v() { k = (k ?? 0) + 1; return k; } }; ok.v; ok.v; out.push(k);
let l; function wl() { try { throw 1; } catch { l = (l ?? 0) + 1; } } wl(); wl(); out.push(l);
let m; function wm(n) { m = n; if (n) wm(n - 1); } wm(2); out.push(m);
let n; const wn = () => { n = (n ?? 0) + 1; }; new Promise(wn); new Promise(wn); out.push(n);
let o; const wo = () => { o = (o ?? 0) + 1; }; Promise.resolve().then(wo).then(wo); await null; await null; await null; out.push(o);
let p; function wp() { p = (p ?? 0) + 1; return {}; } new wp(); new wp(); Reflect.construct(wp, []); out.push(p);
let q; const wq = { [Symbol.toPrimitive]() { q = (q ?? 0) + 1; return 1; } }; +wq; `${wq}`; wq + 1; out.push(q);
let r; const wr = new Proxy(function () {}, { apply() { r = (r ?? 0) + 1; } }); wr(); wr(); out.push(r);
let s; const ws = { handleEvent() { s = (s ?? 0) + 1; } }; { const t = new EventTarget(); t.addEventListener("x", ws); t.dispatchEvent(new Event("x")); t.dispatchEvent(new Event("x")); } out.push(s);
let t; const wt = () => { t = (t ?? 0) + 1; }; [1, 2].forEach(wt); out.push(t);
let u; label: { u = 1; break label; } out.push(u);
let v; for (const x of [1, 2]) v = x; out.push(v);
let w; do { w = (w ?? 0) + 1; } while (w < 3); out.push(w);
let x = 0; const wx = () => ++x; const arr = [wx(), wx()]; out.push(x, arr);
let y; (function () { y = 1; })(); (function () { y = 2; })(); out.push(y);
let z; const wz = function () { z = (z ?? 0) + 1; }; const holder = { wz }; holder.wz(); holder["wz"](); (0, holder.wz)(); out.push(z);
console.log(JSON.stringify(out));
