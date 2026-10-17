// Functions that serve as prototypes of other objects and then get, lose or change properties.
const T = v => typeof v === "function" ? "function" : typeof v === "object" && v !== null ? "object" : String(v);
const out = [];
{ const F = () => 1, H = Object.create(F), HH = Object.create(H);
  const r1 = x => x.bar, i1 = x => "bar" in x, c1 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o1 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r1(x)), i1(x), T(c1(x)), o1(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('arrow, deleted' + ": " + [a, b, d].join(" | ")); }
{ const F = () => 1, H = Object.create(F), HH = Object.create(H);
  const r2 = x => x.bar, i2 = x => "bar" in x, c2 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o2 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r2(x)), i2(x), T(c2(x)), o2(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; F.baz = "other"; } catch (e) { out.push(e.name); } const b = all(); try { delete F.baz; F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('arrow, deleted, another name takes the slot' + ": " + [a, b, d].join(" | ")); }
{ const F = () => 1, H = Object.create(F), HH = Object.create(H);
  const r3 = x => x.bar, i3 = x => "bar" in x, c3 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o3 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r3(x)), i3(x), T(c3(x)), o3(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; F.b1 = "o1"; F.b2 = "o2"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('arrow, deleted, two names added' + ": " + [a, b, d].join(" | ")); }
{ const F = () => 1, H = Object.create(F), HH = Object.create(H);
  const r4 = x => x.bar, i4 = x => "bar" in x, c4 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o4 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r4(x)), i4(x), T(c4(x)), o4(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.defineProperty(F, "bar", { get() { return "got"; }, configurable: true }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true, configurable: true }); } catch (e) { out.push(e.name); } const d = all();
  console.log('arrow, made an accessor' + ": " + [a, b, d].join(" | ")); }
{ const F = () => 1, H = Object.create(F), HH = Object.create(H);
  const r5 = x => x.bar, i5 = x => "bar" in x, c5 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o5 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r5(x)), i5(x), T(c5(x)), o5(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { F.bar = "second"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('arrow, made another value' + ": " + [a, b, d].join(" | ")); }
{ const F = () => 1, H = Object.create(F), HH = Object.create(H);
  const r6 = x => x.bar, i6 = x => "bar" in x, c6 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o6 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r6(x)), i6(x), T(c6(x)), o6(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { F.bar = () => "called"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('arrow, made a function' + ": " + [a, b, d].join(" | ")); }
{ const F = () => 1, H = Object.create(F), HH = Object.create(H);
  const r7 = x => x.bar, i7 = x => "bar" in x, c7 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o7 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r7(x)), i7(x), T(c7(x)), o7(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.defineProperty(F, "bar", { value: 8, writable: false }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true }); } catch (e) { out.push(e.name); } const d = all();
  console.log('arrow, made read-only' + ": " + [a, b, d].join(" | ")); }
{ const F = () => 1, H = Object.create(F), HH = Object.create(H);
  const r8 = x => x.bar, i8 = x => "bar" in x, c8 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o8 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r8(x)), i8(x), T(c8(x)), o8(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; Object.setPrototypeOf(F, { bar: "from the new parent" }); } catch (e) { out.push(e.name); } const b = all(); try { Object.setPrototypeOf(F, Function.prototype); F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('arrow, its own parent changed' + ": " + [a, b, d].join(" | ")); }
{ const F = () => 1, H = Object.create(F), HH = Object.create(H);
  const r9 = x => x.bar, i9 = x => "bar" in x, c9 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o9 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r9(x)), i9(x), T(c9(x)), o9(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { for (let i = 0; i < 70; i++) F["k" + i] = i; delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('arrow, many names added' + ": " + [a, b, d].join(" | ")); }
{ const F = () => 1, H = Object.create(F), HH = Object.create(H);
  const r10 = x => x.bar, i10 = x => "bar" in x, c10 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o10 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r10(x)), i10(x), T(c10(x)), o10(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.freeze(F); } catch (e) { out.push(e.name); } const b = all(); try {  } catch (e) { out.push(e.name); } const d = all();
  console.log('arrow, frozen' + ": " + [a, b, d].join(" | ")); }
{ const F = () => 1, H = Object.create(F), HH = Object.create(H);
  const r11 = x => x.bar, i11 = x => "bar" in x, c11 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o11 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r11(x)), i11(x), T(c11(x)), o11(x)].join("/")).join(" ");
  let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; F.bar = 7; const b = all(); delete F.bar; const d = all(); H.bar = "on the heir"; const e = all();
  console.log('arrow, absent first, then stored' + ": " + [a, b, d, e].join(" | ")); }
{ const F = (c => () => c)(12), H = Object.create(F), HH = Object.create(H);
  const r12 = x => x.bar, i12 = x => "bar" in x, c12 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o12 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r12(x)), i12(x), T(c12(x)), o12(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('capturing arrow, deleted' + ": " + [a, b, d].join(" | ")); }
{ const F = (c => () => c)(13), H = Object.create(F), HH = Object.create(H);
  const r13 = x => x.bar, i13 = x => "bar" in x, c13 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o13 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r13(x)), i13(x), T(c13(x)), o13(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; F.baz = "other"; } catch (e) { out.push(e.name); } const b = all(); try { delete F.baz; F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('capturing arrow, deleted, another name takes the slot' + ": " + [a, b, d].join(" | ")); }
{ const F = (c => () => c)(14), H = Object.create(F), HH = Object.create(H);
  const r14 = x => x.bar, i14 = x => "bar" in x, c14 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o14 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r14(x)), i14(x), T(c14(x)), o14(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; F.b1 = "o1"; F.b2 = "o2"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('capturing arrow, deleted, two names added' + ": " + [a, b, d].join(" | ")); }
{ const F = (c => () => c)(15), H = Object.create(F), HH = Object.create(H);
  const r15 = x => x.bar, i15 = x => "bar" in x, c15 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o15 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r15(x)), i15(x), T(c15(x)), o15(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.defineProperty(F, "bar", { get() { return "got"; }, configurable: true }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true, configurable: true }); } catch (e) { out.push(e.name); } const d = all();
  console.log('capturing arrow, made an accessor' + ": " + [a, b, d].join(" | ")); }
{ const F = (c => () => c)(16), H = Object.create(F), HH = Object.create(H);
  const r16 = x => x.bar, i16 = x => "bar" in x, c16 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o16 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r16(x)), i16(x), T(c16(x)), o16(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { F.bar = "second"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('capturing arrow, made another value' + ": " + [a, b, d].join(" | ")); }
{ const F = (c => () => c)(17), H = Object.create(F), HH = Object.create(H);
  const r17 = x => x.bar, i17 = x => "bar" in x, c17 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o17 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r17(x)), i17(x), T(c17(x)), o17(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { F.bar = () => "called"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('capturing arrow, made a function' + ": " + [a, b, d].join(" | ")); }
{ const F = (c => () => c)(18), H = Object.create(F), HH = Object.create(H);
  const r18 = x => x.bar, i18 = x => "bar" in x, c18 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o18 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r18(x)), i18(x), T(c18(x)), o18(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.defineProperty(F, "bar", { value: 8, writable: false }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true }); } catch (e) { out.push(e.name); } const d = all();
  console.log('capturing arrow, made read-only' + ": " + [a, b, d].join(" | ")); }
{ const F = (c => () => c)(19), H = Object.create(F), HH = Object.create(H);
  const r19 = x => x.bar, i19 = x => "bar" in x, c19 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o19 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r19(x)), i19(x), T(c19(x)), o19(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; Object.setPrototypeOf(F, { bar: "from the new parent" }); } catch (e) { out.push(e.name); } const b = all(); try { Object.setPrototypeOf(F, Function.prototype); F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('capturing arrow, its own parent changed' + ": " + [a, b, d].join(" | ")); }
{ const F = (c => () => c)(20), H = Object.create(F), HH = Object.create(H);
  const r20 = x => x.bar, i20 = x => "bar" in x, c20 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o20 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r20(x)), i20(x), T(c20(x)), o20(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { for (let i = 0; i < 70; i++) F["k" + i] = i; delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('capturing arrow, many names added' + ": " + [a, b, d].join(" | ")); }
{ const F = (c => () => c)(21), H = Object.create(F), HH = Object.create(H);
  const r21 = x => x.bar, i21 = x => "bar" in x, c21 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o21 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r21(x)), i21(x), T(c21(x)), o21(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.freeze(F); } catch (e) { out.push(e.name); } const b = all(); try {  } catch (e) { out.push(e.name); } const d = all();
  console.log('capturing arrow, frozen' + ": " + [a, b, d].join(" | ")); }
{ const F = (c => () => c)(22), H = Object.create(F), HH = Object.create(H);
  const r22 = x => x.bar, i22 = x => "bar" in x, c22 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o22 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r22(x)), i22(x), T(c22(x)), o22(x)].join("/")).join(" ");
  let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; F.bar = 7; const b = all(); delete F.bar; const d = all(); H.bar = "on the heir"; const e = all();
  console.log('capturing arrow, absent first, then stored' + ": " + [a, b, d, e].join(" | ")); }
{ const F = function () { return 1; }, H = Object.create(F), HH = Object.create(H);
  const r23 = x => x.bar, i23 = x => "bar" in x, c23 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o23 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r23(x)), i23(x), T(c23(x)), o23(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('function expression, deleted' + ": " + [a, b, d].join(" | ")); }
{ const F = function () { return 1; }, H = Object.create(F), HH = Object.create(H);
  const r24 = x => x.bar, i24 = x => "bar" in x, c24 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o24 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r24(x)), i24(x), T(c24(x)), o24(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; F.baz = "other"; } catch (e) { out.push(e.name); } const b = all(); try { delete F.baz; F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('function expression, deleted, another name takes the slot' + ": " + [a, b, d].join(" | ")); }
{ const F = function () { return 1; }, H = Object.create(F), HH = Object.create(H);
  const r25 = x => x.bar, i25 = x => "bar" in x, c25 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o25 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r25(x)), i25(x), T(c25(x)), o25(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; F.b1 = "o1"; F.b2 = "o2"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('function expression, deleted, two names added' + ": " + [a, b, d].join(" | ")); }
{ const F = function () { return 1; }, H = Object.create(F), HH = Object.create(H);
  const r26 = x => x.bar, i26 = x => "bar" in x, c26 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o26 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r26(x)), i26(x), T(c26(x)), o26(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.defineProperty(F, "bar", { get() { return "got"; }, configurable: true }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true, configurable: true }); } catch (e) { out.push(e.name); } const d = all();
  console.log('function expression, made an accessor' + ": " + [a, b, d].join(" | ")); }
{ const F = function () { return 1; }, H = Object.create(F), HH = Object.create(H);
  const r27 = x => x.bar, i27 = x => "bar" in x, c27 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o27 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r27(x)), i27(x), T(c27(x)), o27(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { F.bar = "second"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('function expression, made another value' + ": " + [a, b, d].join(" | ")); }
{ const F = function () { return 1; }, H = Object.create(F), HH = Object.create(H);
  const r28 = x => x.bar, i28 = x => "bar" in x, c28 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o28 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r28(x)), i28(x), T(c28(x)), o28(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { F.bar = () => "called"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('function expression, made a function' + ": " + [a, b, d].join(" | ")); }
{ const F = function () { return 1; }, H = Object.create(F), HH = Object.create(H);
  const r29 = x => x.bar, i29 = x => "bar" in x, c29 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o29 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r29(x)), i29(x), T(c29(x)), o29(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.defineProperty(F, "bar", { value: 8, writable: false }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true }); } catch (e) { out.push(e.name); } const d = all();
  console.log('function expression, made read-only' + ": " + [a, b, d].join(" | ")); }
{ const F = function () { return 1; }, H = Object.create(F), HH = Object.create(H);
  const r30 = x => x.bar, i30 = x => "bar" in x, c30 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o30 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r30(x)), i30(x), T(c30(x)), o30(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; Object.setPrototypeOf(F, { bar: "from the new parent" }); } catch (e) { out.push(e.name); } const b = all(); try { Object.setPrototypeOf(F, Function.prototype); F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('function expression, its own parent changed' + ": " + [a, b, d].join(" | ")); }
{ const F = function () { return 1; }, H = Object.create(F), HH = Object.create(H);
  const r31 = x => x.bar, i31 = x => "bar" in x, c31 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o31 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r31(x)), i31(x), T(c31(x)), o31(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { for (let i = 0; i < 70; i++) F["k" + i] = i; delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('function expression, many names added' + ": " + [a, b, d].join(" | ")); }
{ const F = function () { return 1; }, H = Object.create(F), HH = Object.create(H);
  const r32 = x => x.bar, i32 = x => "bar" in x, c32 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o32 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r32(x)), i32(x), T(c32(x)), o32(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.freeze(F); } catch (e) { out.push(e.name); } const b = all(); try {  } catch (e) { out.push(e.name); } const d = all();
  console.log('function expression, frozen' + ": " + [a, b, d].join(" | ")); }
{ const F = function () { return 1; }, H = Object.create(F), HH = Object.create(H);
  const r33 = x => x.bar, i33 = x => "bar" in x, c33 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o33 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r33(x)), i33(x), T(c33(x)), o33(x)].join("/")).join(" ");
  let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; F.bar = 7; const b = all(); delete F.bar; const d = all(); H.bar = "on the heir"; const e = all();
  console.log('function expression, absent first, then stored' + ": " + [a, b, d, e].join(" | ")); }
{ const F = function named() { return 1; }, H = Object.create(F), HH = Object.create(H);
  const r34 = x => x.bar, i34 = x => "bar" in x, c34 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o34 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r34(x)), i34(x), T(c34(x)), o34(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('named expression, deleted' + ": " + [a, b, d].join(" | ")); }
{ const F = function named() { return 1; }, H = Object.create(F), HH = Object.create(H);
  const r35 = x => x.bar, i35 = x => "bar" in x, c35 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o35 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r35(x)), i35(x), T(c35(x)), o35(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; F.baz = "other"; } catch (e) { out.push(e.name); } const b = all(); try { delete F.baz; F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('named expression, deleted, another name takes the slot' + ": " + [a, b, d].join(" | ")); }
{ const F = function named() { return 1; }, H = Object.create(F), HH = Object.create(H);
  const r36 = x => x.bar, i36 = x => "bar" in x, c36 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o36 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r36(x)), i36(x), T(c36(x)), o36(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; F.b1 = "o1"; F.b2 = "o2"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('named expression, deleted, two names added' + ": " + [a, b, d].join(" | ")); }
{ const F = function named() { return 1; }, H = Object.create(F), HH = Object.create(H);
  const r37 = x => x.bar, i37 = x => "bar" in x, c37 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o37 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r37(x)), i37(x), T(c37(x)), o37(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.defineProperty(F, "bar", { get() { return "got"; }, configurable: true }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true, configurable: true }); } catch (e) { out.push(e.name); } const d = all();
  console.log('named expression, made an accessor' + ": " + [a, b, d].join(" | ")); }
{ const F = function named() { return 1; }, H = Object.create(F), HH = Object.create(H);
  const r38 = x => x.bar, i38 = x => "bar" in x, c38 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o38 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r38(x)), i38(x), T(c38(x)), o38(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { F.bar = "second"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('named expression, made another value' + ": " + [a, b, d].join(" | ")); }
{ const F = function named() { return 1; }, H = Object.create(F), HH = Object.create(H);
  const r39 = x => x.bar, i39 = x => "bar" in x, c39 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o39 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r39(x)), i39(x), T(c39(x)), o39(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { F.bar = () => "called"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('named expression, made a function' + ": " + [a, b, d].join(" | ")); }
{ const F = function named() { return 1; }, H = Object.create(F), HH = Object.create(H);
  const r40 = x => x.bar, i40 = x => "bar" in x, c40 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o40 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r40(x)), i40(x), T(c40(x)), o40(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.defineProperty(F, "bar", { value: 8, writable: false }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true }); } catch (e) { out.push(e.name); } const d = all();
  console.log('named expression, made read-only' + ": " + [a, b, d].join(" | ")); }
{ const F = function named() { return 1; }, H = Object.create(F), HH = Object.create(H);
  const r41 = x => x.bar, i41 = x => "bar" in x, c41 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o41 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r41(x)), i41(x), T(c41(x)), o41(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; Object.setPrototypeOf(F, { bar: "from the new parent" }); } catch (e) { out.push(e.name); } const b = all(); try { Object.setPrototypeOf(F, Function.prototype); F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('named expression, its own parent changed' + ": " + [a, b, d].join(" | ")); }
{ const F = function named() { return 1; }, H = Object.create(F), HH = Object.create(H);
  const r42 = x => x.bar, i42 = x => "bar" in x, c42 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o42 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r42(x)), i42(x), T(c42(x)), o42(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { for (let i = 0; i < 70; i++) F["k" + i] = i; delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('named expression, many names added' + ": " + [a, b, d].join(" | ")); }
{ const F = function named() { return 1; }, H = Object.create(F), HH = Object.create(H);
  const r43 = x => x.bar, i43 = x => "bar" in x, c43 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o43 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r43(x)), i43(x), T(c43(x)), o43(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.freeze(F); } catch (e) { out.push(e.name); } const b = all(); try {  } catch (e) { out.push(e.name); } const d = all();
  console.log('named expression, frozen' + ": " + [a, b, d].join(" | ")); }
{ const F = function named() { return 1; }, H = Object.create(F), HH = Object.create(H);
  const r44 = x => x.bar, i44 = x => "bar" in x, c44 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o44 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r44(x)), i44(x), T(c44(x)), o44(x)].join("/")).join(" ");
  let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; F.bar = 7; const b = all(); delete F.bar; const d = all(); H.bar = "on the heir"; const e = all();
  console.log('named expression, absent first, then stored' + ": " + [a, b, d, e].join(" | ")); }
{ const F = ({ m() { return 1; } }).m, H = Object.create(F), HH = Object.create(H);
  const r45 = x => x.bar, i45 = x => "bar" in x, c45 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o45 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r45(x)), i45(x), T(c45(x)), o45(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('method, deleted' + ": " + [a, b, d].join(" | ")); }
{ const F = ({ m() { return 1; } }).m, H = Object.create(F), HH = Object.create(H);
  const r46 = x => x.bar, i46 = x => "bar" in x, c46 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o46 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r46(x)), i46(x), T(c46(x)), o46(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; F.baz = "other"; } catch (e) { out.push(e.name); } const b = all(); try { delete F.baz; F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('method, deleted, another name takes the slot' + ": " + [a, b, d].join(" | ")); }
{ const F = ({ m() { return 1; } }).m, H = Object.create(F), HH = Object.create(H);
  const r47 = x => x.bar, i47 = x => "bar" in x, c47 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o47 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r47(x)), i47(x), T(c47(x)), o47(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; F.b1 = "o1"; F.b2 = "o2"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('method, deleted, two names added' + ": " + [a, b, d].join(" | ")); }
{ const F = ({ m() { return 1; } }).m, H = Object.create(F), HH = Object.create(H);
  const r48 = x => x.bar, i48 = x => "bar" in x, c48 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o48 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r48(x)), i48(x), T(c48(x)), o48(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.defineProperty(F, "bar", { get() { return "got"; }, configurable: true }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true, configurable: true }); } catch (e) { out.push(e.name); } const d = all();
  console.log('method, made an accessor' + ": " + [a, b, d].join(" | ")); }
{ const F = ({ m() { return 1; } }).m, H = Object.create(F), HH = Object.create(H);
  const r49 = x => x.bar, i49 = x => "bar" in x, c49 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o49 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r49(x)), i49(x), T(c49(x)), o49(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { F.bar = "second"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('method, made another value' + ": " + [a, b, d].join(" | ")); }
{ const F = ({ m() { return 1; } }).m, H = Object.create(F), HH = Object.create(H);
  const r50 = x => x.bar, i50 = x => "bar" in x, c50 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o50 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r50(x)), i50(x), T(c50(x)), o50(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { F.bar = () => "called"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('method, made a function' + ": " + [a, b, d].join(" | ")); }
{ const F = ({ m() { return 1; } }).m, H = Object.create(F), HH = Object.create(H);
  const r51 = x => x.bar, i51 = x => "bar" in x, c51 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o51 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r51(x)), i51(x), T(c51(x)), o51(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.defineProperty(F, "bar", { value: 8, writable: false }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true }); } catch (e) { out.push(e.name); } const d = all();
  console.log('method, made read-only' + ": " + [a, b, d].join(" | ")); }
{ const F = ({ m() { return 1; } }).m, H = Object.create(F), HH = Object.create(H);
  const r52 = x => x.bar, i52 = x => "bar" in x, c52 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o52 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r52(x)), i52(x), T(c52(x)), o52(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; Object.setPrototypeOf(F, { bar: "from the new parent" }); } catch (e) { out.push(e.name); } const b = all(); try { Object.setPrototypeOf(F, Function.prototype); F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('method, its own parent changed' + ": " + [a, b, d].join(" | ")); }
{ const F = ({ m() { return 1; } }).m, H = Object.create(F), HH = Object.create(H);
  const r53 = x => x.bar, i53 = x => "bar" in x, c53 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o53 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r53(x)), i53(x), T(c53(x)), o53(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { for (let i = 0; i < 70; i++) F["k" + i] = i; delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('method, many names added' + ": " + [a, b, d].join(" | ")); }
{ const F = ({ m() { return 1; } }).m, H = Object.create(F), HH = Object.create(H);
  const r54 = x => x.bar, i54 = x => "bar" in x, c54 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o54 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r54(x)), i54(x), T(c54(x)), o54(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.freeze(F); } catch (e) { out.push(e.name); } const b = all(); try {  } catch (e) { out.push(e.name); } const d = all();
  console.log('method, frozen' + ": " + [a, b, d].join(" | ")); }
{ const F = ({ m() { return 1; } }).m, H = Object.create(F), HH = Object.create(H);
  const r55 = x => x.bar, i55 = x => "bar" in x, c55 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o55 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r55(x)), i55(x), T(c55(x)), o55(x)].join("/")).join(" ");
  let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; F.bar = 7; const b = all(); delete F.bar; const d = all(); H.bar = "on the heir"; const e = all();
  console.log('method, absent first, then stored' + ": " + [a, b, d, e].join(" | ")); }
{ const F = Object.getOwnPropertyDescriptor({ get g() { return 1; } }, "g").get, H = Object.create(F), HH = Object.create(H);
  const r56 = x => x.bar, i56 = x => "bar" in x, c56 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o56 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r56(x)), i56(x), T(c56(x)), o56(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log("getter's function, deleted" + ": " + [a, b, d].join(" | ")); }
{ const F = Object.getOwnPropertyDescriptor({ get g() { return 1; } }, "g").get, H = Object.create(F), HH = Object.create(H);
  const r57 = x => x.bar, i57 = x => "bar" in x, c57 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o57 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r57(x)), i57(x), T(c57(x)), o57(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; F.baz = "other"; } catch (e) { out.push(e.name); } const b = all(); try { delete F.baz; F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log("getter's function, deleted, another name takes the slot" + ": " + [a, b, d].join(" | ")); }
{ const F = Object.getOwnPropertyDescriptor({ get g() { return 1; } }, "g").get, H = Object.create(F), HH = Object.create(H);
  const r58 = x => x.bar, i58 = x => "bar" in x, c58 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o58 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r58(x)), i58(x), T(c58(x)), o58(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; F.b1 = "o1"; F.b2 = "o2"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log("getter's function, deleted, two names added" + ": " + [a, b, d].join(" | ")); }
{ const F = Object.getOwnPropertyDescriptor({ get g() { return 1; } }, "g").get, H = Object.create(F), HH = Object.create(H);
  const r59 = x => x.bar, i59 = x => "bar" in x, c59 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o59 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r59(x)), i59(x), T(c59(x)), o59(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.defineProperty(F, "bar", { get() { return "got"; }, configurable: true }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true, configurable: true }); } catch (e) { out.push(e.name); } const d = all();
  console.log("getter's function, made an accessor" + ": " + [a, b, d].join(" | ")); }
{ const F = Object.getOwnPropertyDescriptor({ get g() { return 1; } }, "g").get, H = Object.create(F), HH = Object.create(H);
  const r60 = x => x.bar, i60 = x => "bar" in x, c60 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o60 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r60(x)), i60(x), T(c60(x)), o60(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { F.bar = "second"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log("getter's function, made another value" + ": " + [a, b, d].join(" | ")); }
{ const F = Object.getOwnPropertyDescriptor({ get g() { return 1; } }, "g").get, H = Object.create(F), HH = Object.create(H);
  const r61 = x => x.bar, i61 = x => "bar" in x, c61 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o61 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r61(x)), i61(x), T(c61(x)), o61(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { F.bar = () => "called"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log("getter's function, made a function" + ": " + [a, b, d].join(" | ")); }
{ const F = Object.getOwnPropertyDescriptor({ get g() { return 1; } }, "g").get, H = Object.create(F), HH = Object.create(H);
  const r62 = x => x.bar, i62 = x => "bar" in x, c62 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o62 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r62(x)), i62(x), T(c62(x)), o62(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.defineProperty(F, "bar", { value: 8, writable: false }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true }); } catch (e) { out.push(e.name); } const d = all();
  console.log("getter's function, made read-only" + ": " + [a, b, d].join(" | ")); }
{ const F = Object.getOwnPropertyDescriptor({ get g() { return 1; } }, "g").get, H = Object.create(F), HH = Object.create(H);
  const r63 = x => x.bar, i63 = x => "bar" in x, c63 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o63 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r63(x)), i63(x), T(c63(x)), o63(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; Object.setPrototypeOf(F, { bar: "from the new parent" }); } catch (e) { out.push(e.name); } const b = all(); try { Object.setPrototypeOf(F, Function.prototype); F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log("getter's function, its own parent changed" + ": " + [a, b, d].join(" | ")); }
{ const F = Object.getOwnPropertyDescriptor({ get g() { return 1; } }, "g").get, H = Object.create(F), HH = Object.create(H);
  const r64 = x => x.bar, i64 = x => "bar" in x, c64 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o64 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r64(x)), i64(x), T(c64(x)), o64(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { for (let i = 0; i < 70; i++) F["k" + i] = i; delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log("getter's function, many names added" + ": " + [a, b, d].join(" | ")); }
{ const F = Object.getOwnPropertyDescriptor({ get g() { return 1; } }, "g").get, H = Object.create(F), HH = Object.create(H);
  const r65 = x => x.bar, i65 = x => "bar" in x, c65 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o65 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r65(x)), i65(x), T(c65(x)), o65(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.freeze(F); } catch (e) { out.push(e.name); } const b = all(); try {  } catch (e) { out.push(e.name); } const d = all();
  console.log("getter's function, frozen" + ": " + [a, b, d].join(" | ")); }
{ const F = Object.getOwnPropertyDescriptor({ get g() { return 1; } }, "g").get, H = Object.create(F), HH = Object.create(H);
  const r66 = x => x.bar, i66 = x => "bar" in x, c66 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o66 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r66(x)), i66(x), T(c66(x)), o66(x)].join("/")).join(" ");
  let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; F.bar = 7; const b = all(); delete F.bar; const d = all(); H.bar = "on the heir"; const e = all();
  console.log("getter's function, absent first, then stored" + ": " + [a, b, d, e].join(" | ")); }
{ const F = async () => 1, H = Object.create(F), HH = Object.create(H);
  const r67 = x => x.bar, i67 = x => "bar" in x, c67 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o67 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r67(x)), i67(x), T(c67(x)), o67(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('async arrow, deleted' + ": " + [a, b, d].join(" | ")); }
{ const F = async () => 1, H = Object.create(F), HH = Object.create(H);
  const r68 = x => x.bar, i68 = x => "bar" in x, c68 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o68 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r68(x)), i68(x), T(c68(x)), o68(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; F.baz = "other"; } catch (e) { out.push(e.name); } const b = all(); try { delete F.baz; F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('async arrow, deleted, another name takes the slot' + ": " + [a, b, d].join(" | ")); }
{ const F = async () => 1, H = Object.create(F), HH = Object.create(H);
  const r69 = x => x.bar, i69 = x => "bar" in x, c69 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o69 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r69(x)), i69(x), T(c69(x)), o69(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; F.b1 = "o1"; F.b2 = "o2"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('async arrow, deleted, two names added' + ": " + [a, b, d].join(" | ")); }
{ const F = async () => 1, H = Object.create(F), HH = Object.create(H);
  const r70 = x => x.bar, i70 = x => "bar" in x, c70 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o70 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r70(x)), i70(x), T(c70(x)), o70(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.defineProperty(F, "bar", { get() { return "got"; }, configurable: true }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true, configurable: true }); } catch (e) { out.push(e.name); } const d = all();
  console.log('async arrow, made an accessor' + ": " + [a, b, d].join(" | ")); }
{ const F = async () => 1, H = Object.create(F), HH = Object.create(H);
  const r71 = x => x.bar, i71 = x => "bar" in x, c71 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o71 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r71(x)), i71(x), T(c71(x)), o71(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { F.bar = "second"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('async arrow, made another value' + ": " + [a, b, d].join(" | ")); }
{ const F = async () => 1, H = Object.create(F), HH = Object.create(H);
  const r72 = x => x.bar, i72 = x => "bar" in x, c72 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o72 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r72(x)), i72(x), T(c72(x)), o72(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { F.bar = () => "called"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('async arrow, made a function' + ": " + [a, b, d].join(" | ")); }
{ const F = async () => 1, H = Object.create(F), HH = Object.create(H);
  const r73 = x => x.bar, i73 = x => "bar" in x, c73 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o73 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r73(x)), i73(x), T(c73(x)), o73(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.defineProperty(F, "bar", { value: 8, writable: false }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true }); } catch (e) { out.push(e.name); } const d = all();
  console.log('async arrow, made read-only' + ": " + [a, b, d].join(" | ")); }
{ const F = async () => 1, H = Object.create(F), HH = Object.create(H);
  const r74 = x => x.bar, i74 = x => "bar" in x, c74 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o74 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r74(x)), i74(x), T(c74(x)), o74(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; Object.setPrototypeOf(F, { bar: "from the new parent" }); } catch (e) { out.push(e.name); } const b = all(); try { Object.setPrototypeOf(F, Function.prototype); F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('async arrow, its own parent changed' + ": " + [a, b, d].join(" | ")); }
{ const F = async () => 1, H = Object.create(F), HH = Object.create(H);
  const r75 = x => x.bar, i75 = x => "bar" in x, c75 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o75 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r75(x)), i75(x), T(c75(x)), o75(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { for (let i = 0; i < 70; i++) F["k" + i] = i; delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('async arrow, many names added' + ": " + [a, b, d].join(" | ")); }
{ const F = async () => 1, H = Object.create(F), HH = Object.create(H);
  const r76 = x => x.bar, i76 = x => "bar" in x, c76 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o76 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r76(x)), i76(x), T(c76(x)), o76(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.freeze(F); } catch (e) { out.push(e.name); } const b = all(); try {  } catch (e) { out.push(e.name); } const d = all();
  console.log('async arrow, frozen' + ": " + [a, b, d].join(" | ")); }
{ const F = async () => 1, H = Object.create(F), HH = Object.create(H);
  const r77 = x => x.bar, i77 = x => "bar" in x, c77 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o77 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r77(x)), i77(x), T(c77(x)), o77(x)].join("/")).join(" ");
  let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; F.bar = 7; const b = all(); delete F.bar; const d = all(); H.bar = "on the heir"; const e = all();
  console.log('async arrow, absent first, then stored' + ": " + [a, b, d, e].join(" | ")); }
{ const F = async function () {}, H = Object.create(F), HH = Object.create(H);
  const r78 = x => x.bar, i78 = x => "bar" in x, c78 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o78 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r78(x)), i78(x), T(c78(x)), o78(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('async function, deleted' + ": " + [a, b, d].join(" | ")); }
{ const F = async function () {}, H = Object.create(F), HH = Object.create(H);
  const r79 = x => x.bar, i79 = x => "bar" in x, c79 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o79 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r79(x)), i79(x), T(c79(x)), o79(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; F.baz = "other"; } catch (e) { out.push(e.name); } const b = all(); try { delete F.baz; F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('async function, deleted, another name takes the slot' + ": " + [a, b, d].join(" | ")); }
{ const F = async function () {}, H = Object.create(F), HH = Object.create(H);
  const r80 = x => x.bar, i80 = x => "bar" in x, c80 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o80 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r80(x)), i80(x), T(c80(x)), o80(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; F.b1 = "o1"; F.b2 = "o2"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('async function, deleted, two names added' + ": " + [a, b, d].join(" | ")); }
{ const F = async function () {}, H = Object.create(F), HH = Object.create(H);
  const r81 = x => x.bar, i81 = x => "bar" in x, c81 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o81 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r81(x)), i81(x), T(c81(x)), o81(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.defineProperty(F, "bar", { get() { return "got"; }, configurable: true }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true, configurable: true }); } catch (e) { out.push(e.name); } const d = all();
  console.log('async function, made an accessor' + ": " + [a, b, d].join(" | ")); }
{ const F = async function () {}, H = Object.create(F), HH = Object.create(H);
  const r82 = x => x.bar, i82 = x => "bar" in x, c82 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o82 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r82(x)), i82(x), T(c82(x)), o82(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { F.bar = "second"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('async function, made another value' + ": " + [a, b, d].join(" | ")); }
{ const F = async function () {}, H = Object.create(F), HH = Object.create(H);
  const r83 = x => x.bar, i83 = x => "bar" in x, c83 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o83 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r83(x)), i83(x), T(c83(x)), o83(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { F.bar = () => "called"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('async function, made a function' + ": " + [a, b, d].join(" | ")); }
{ const F = async function () {}, H = Object.create(F), HH = Object.create(H);
  const r84 = x => x.bar, i84 = x => "bar" in x, c84 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o84 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r84(x)), i84(x), T(c84(x)), o84(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.defineProperty(F, "bar", { value: 8, writable: false }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true }); } catch (e) { out.push(e.name); } const d = all();
  console.log('async function, made read-only' + ": " + [a, b, d].join(" | ")); }
{ const F = async function () {}, H = Object.create(F), HH = Object.create(H);
  const r85 = x => x.bar, i85 = x => "bar" in x, c85 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o85 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r85(x)), i85(x), T(c85(x)), o85(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; Object.setPrototypeOf(F, { bar: "from the new parent" }); } catch (e) { out.push(e.name); } const b = all(); try { Object.setPrototypeOf(F, Function.prototype); F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('async function, its own parent changed' + ": " + [a, b, d].join(" | ")); }
{ const F = async function () {}, H = Object.create(F), HH = Object.create(H);
  const r86 = x => x.bar, i86 = x => "bar" in x, c86 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o86 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r86(x)), i86(x), T(c86(x)), o86(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { for (let i = 0; i < 70; i++) F["k" + i] = i; delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('async function, many names added' + ": " + [a, b, d].join(" | ")); }
{ const F = async function () {}, H = Object.create(F), HH = Object.create(H);
  const r87 = x => x.bar, i87 = x => "bar" in x, c87 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o87 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r87(x)), i87(x), T(c87(x)), o87(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.freeze(F); } catch (e) { out.push(e.name); } const b = all(); try {  } catch (e) { out.push(e.name); } const d = all();
  console.log('async function, frozen' + ": " + [a, b, d].join(" | ")); }
{ const F = async function () {}, H = Object.create(F), HH = Object.create(H);
  const r88 = x => x.bar, i88 = x => "bar" in x, c88 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o88 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r88(x)), i88(x), T(c88(x)), o88(x)].join("/")).join(" ");
  let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; F.bar = 7; const b = all(); delete F.bar; const d = all(); H.bar = "on the heir"; const e = all();
  console.log('async function, absent first, then stored' + ": " + [a, b, d, e].join(" | ")); }
{ const F = function* () {}, H = Object.create(F), HH = Object.create(H);
  const r89 = x => x.bar, i89 = x => "bar" in x, c89 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o89 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r89(x)), i89(x), T(c89(x)), o89(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('generator function, deleted' + ": " + [a, b, d].join(" | ")); }
{ const F = function* () {}, H = Object.create(F), HH = Object.create(H);
  const r90 = x => x.bar, i90 = x => "bar" in x, c90 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o90 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r90(x)), i90(x), T(c90(x)), o90(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; F.baz = "other"; } catch (e) { out.push(e.name); } const b = all(); try { delete F.baz; F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('generator function, deleted, another name takes the slot' + ": " + [a, b, d].join(" | ")); }
{ const F = function* () {}, H = Object.create(F), HH = Object.create(H);
  const r91 = x => x.bar, i91 = x => "bar" in x, c91 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o91 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r91(x)), i91(x), T(c91(x)), o91(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; F.b1 = "o1"; F.b2 = "o2"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('generator function, deleted, two names added' + ": " + [a, b, d].join(" | ")); }
{ const F = function* () {}, H = Object.create(F), HH = Object.create(H);
  const r92 = x => x.bar, i92 = x => "bar" in x, c92 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o92 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r92(x)), i92(x), T(c92(x)), o92(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.defineProperty(F, "bar", { get() { return "got"; }, configurable: true }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true, configurable: true }); } catch (e) { out.push(e.name); } const d = all();
  console.log('generator function, made an accessor' + ": " + [a, b, d].join(" | ")); }
{ const F = function* () {}, H = Object.create(F), HH = Object.create(H);
  const r93 = x => x.bar, i93 = x => "bar" in x, c93 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o93 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r93(x)), i93(x), T(c93(x)), o93(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { F.bar = "second"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('generator function, made another value' + ": " + [a, b, d].join(" | ")); }
{ const F = function* () {}, H = Object.create(F), HH = Object.create(H);
  const r94 = x => x.bar, i94 = x => "bar" in x, c94 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o94 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r94(x)), i94(x), T(c94(x)), o94(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { F.bar = () => "called"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('generator function, made a function' + ": " + [a, b, d].join(" | ")); }
{ const F = function* () {}, H = Object.create(F), HH = Object.create(H);
  const r95 = x => x.bar, i95 = x => "bar" in x, c95 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o95 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r95(x)), i95(x), T(c95(x)), o95(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.defineProperty(F, "bar", { value: 8, writable: false }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true }); } catch (e) { out.push(e.name); } const d = all();
  console.log('generator function, made read-only' + ": " + [a, b, d].join(" | ")); }
{ const F = function* () {}, H = Object.create(F), HH = Object.create(H);
  const r96 = x => x.bar, i96 = x => "bar" in x, c96 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o96 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r96(x)), i96(x), T(c96(x)), o96(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; Object.setPrototypeOf(F, { bar: "from the new parent" }); } catch (e) { out.push(e.name); } const b = all(); try { Object.setPrototypeOf(F, Function.prototype); F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('generator function, its own parent changed' + ": " + [a, b, d].join(" | ")); }
{ const F = function* () {}, H = Object.create(F), HH = Object.create(H);
  const r97 = x => x.bar, i97 = x => "bar" in x, c97 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o97 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r97(x)), i97(x), T(c97(x)), o97(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { for (let i = 0; i < 70; i++) F["k" + i] = i; delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('generator function, many names added' + ": " + [a, b, d].join(" | ")); }
{ const F = function* () {}, H = Object.create(F), HH = Object.create(H);
  const r98 = x => x.bar, i98 = x => "bar" in x, c98 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o98 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r98(x)), i98(x), T(c98(x)), o98(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.freeze(F); } catch (e) { out.push(e.name); } const b = all(); try {  } catch (e) { out.push(e.name); } const d = all();
  console.log('generator function, frozen' + ": " + [a, b, d].join(" | ")); }
{ const F = function* () {}, H = Object.create(F), HH = Object.create(H);
  const r99 = x => x.bar, i99 = x => "bar" in x, c99 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o99 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r99(x)), i99(x), T(c99(x)), o99(x)].join("/")).join(" ");
  let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; F.bar = 7; const b = all(); delete F.bar; const d = all(); H.bar = "on the heir"; const e = all();
  console.log('generator function, absent first, then stored' + ": " + [a, b, d, e].join(" | ")); }
{ const F = class { static s() {} }, H = Object.create(F), HH = Object.create(H);
  const r100 = x => x.bar, i100 = x => "bar" in x, c100 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o100 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r100(x)), i100(x), T(c100(x)), o100(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('class, deleted' + ": " + [a, b, d].join(" | ")); }
{ const F = class { static s() {} }, H = Object.create(F), HH = Object.create(H);
  const r101 = x => x.bar, i101 = x => "bar" in x, c101 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o101 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r101(x)), i101(x), T(c101(x)), o101(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; F.baz = "other"; } catch (e) { out.push(e.name); } const b = all(); try { delete F.baz; F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('class, deleted, another name takes the slot' + ": " + [a, b, d].join(" | ")); }
{ const F = class { static s() {} }, H = Object.create(F), HH = Object.create(H);
  const r102 = x => x.bar, i102 = x => "bar" in x, c102 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o102 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r102(x)), i102(x), T(c102(x)), o102(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; F.b1 = "o1"; F.b2 = "o2"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('class, deleted, two names added' + ": " + [a, b, d].join(" | ")); }
{ const F = class { static s() {} }, H = Object.create(F), HH = Object.create(H);
  const r103 = x => x.bar, i103 = x => "bar" in x, c103 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o103 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r103(x)), i103(x), T(c103(x)), o103(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.defineProperty(F, "bar", { get() { return "got"; }, configurable: true }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true, configurable: true }); } catch (e) { out.push(e.name); } const d = all();
  console.log('class, made an accessor' + ": " + [a, b, d].join(" | ")); }
{ const F = class { static s() {} }, H = Object.create(F), HH = Object.create(H);
  const r104 = x => x.bar, i104 = x => "bar" in x, c104 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o104 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r104(x)), i104(x), T(c104(x)), o104(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { F.bar = "second"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('class, made another value' + ": " + [a, b, d].join(" | ")); }
{ const F = class { static s() {} }, H = Object.create(F), HH = Object.create(H);
  const r105 = x => x.bar, i105 = x => "bar" in x, c105 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o105 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r105(x)), i105(x), T(c105(x)), o105(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { F.bar = () => "called"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('class, made a function' + ": " + [a, b, d].join(" | ")); }
{ const F = class { static s() {} }, H = Object.create(F), HH = Object.create(H);
  const r106 = x => x.bar, i106 = x => "bar" in x, c106 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o106 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r106(x)), i106(x), T(c106(x)), o106(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.defineProperty(F, "bar", { value: 8, writable: false }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true }); } catch (e) { out.push(e.name); } const d = all();
  console.log('class, made read-only' + ": " + [a, b, d].join(" | ")); }
{ const F = class { static s() {} }, H = Object.create(F), HH = Object.create(H);
  const r107 = x => x.bar, i107 = x => "bar" in x, c107 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o107 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r107(x)), i107(x), T(c107(x)), o107(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; Object.setPrototypeOf(F, { bar: "from the new parent" }); } catch (e) { out.push(e.name); } const b = all(); try { Object.setPrototypeOf(F, Function.prototype); F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('class, its own parent changed' + ": " + [a, b, d].join(" | ")); }
{ const F = class { static s() {} }, H = Object.create(F), HH = Object.create(H);
  const r108 = x => x.bar, i108 = x => "bar" in x, c108 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o108 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r108(x)), i108(x), T(c108(x)), o108(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { for (let i = 0; i < 70; i++) F["k" + i] = i; delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('class, many names added' + ": " + [a, b, d].join(" | ")); }
{ const F = class { static s() {} }, H = Object.create(F), HH = Object.create(H);
  const r109 = x => x.bar, i109 = x => "bar" in x, c109 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o109 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r109(x)), i109(x), T(c109(x)), o109(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.freeze(F); } catch (e) { out.push(e.name); } const b = all(); try {  } catch (e) { out.push(e.name); } const d = all();
  console.log('class, frozen' + ": " + [a, b, d].join(" | ")); }
{ const F = class { static s() {} }, H = Object.create(F), HH = Object.create(H);
  const r110 = x => x.bar, i110 = x => "bar" in x, c110 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o110 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r110(x)), i110(x), T(c110(x)), o110(x)].join("/")).join(" ");
  let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; F.bar = 7; const b = all(); delete F.bar; const d = all(); H.bar = "on the heir"; const e = all();
  console.log('class, absent first, then stored' + ": " + [a, b, d, e].join(" | ")); }
{ const F = class extends Object {}, H = Object.create(F), HH = Object.create(H);
  const r111 = x => x.bar, i111 = x => "bar" in x, c111 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o111 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r111(x)), i111(x), T(c111(x)), o111(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('class with a parent, deleted' + ": " + [a, b, d].join(" | ")); }
{ const F = class extends Object {}, H = Object.create(F), HH = Object.create(H);
  const r112 = x => x.bar, i112 = x => "bar" in x, c112 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o112 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r112(x)), i112(x), T(c112(x)), o112(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; F.baz = "other"; } catch (e) { out.push(e.name); } const b = all(); try { delete F.baz; F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('class with a parent, deleted, another name takes the slot' + ": " + [a, b, d].join(" | ")); }
{ const F = class extends Object {}, H = Object.create(F), HH = Object.create(H);
  const r113 = x => x.bar, i113 = x => "bar" in x, c113 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o113 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r113(x)), i113(x), T(c113(x)), o113(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; F.b1 = "o1"; F.b2 = "o2"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('class with a parent, deleted, two names added' + ": " + [a, b, d].join(" | ")); }
{ const F = class extends Object {}, H = Object.create(F), HH = Object.create(H);
  const r114 = x => x.bar, i114 = x => "bar" in x, c114 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o114 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r114(x)), i114(x), T(c114(x)), o114(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.defineProperty(F, "bar", { get() { return "got"; }, configurable: true }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true, configurable: true }); } catch (e) { out.push(e.name); } const d = all();
  console.log('class with a parent, made an accessor' + ": " + [a, b, d].join(" | ")); }
{ const F = class extends Object {}, H = Object.create(F), HH = Object.create(H);
  const r115 = x => x.bar, i115 = x => "bar" in x, c115 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o115 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r115(x)), i115(x), T(c115(x)), o115(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { F.bar = "second"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('class with a parent, made another value' + ": " + [a, b, d].join(" | ")); }
{ const F = class extends Object {}, H = Object.create(F), HH = Object.create(H);
  const r116 = x => x.bar, i116 = x => "bar" in x, c116 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o116 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r116(x)), i116(x), T(c116(x)), o116(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { F.bar = () => "called"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('class with a parent, made a function' + ": " + [a, b, d].join(" | ")); }
{ const F = class extends Object {}, H = Object.create(F), HH = Object.create(H);
  const r117 = x => x.bar, i117 = x => "bar" in x, c117 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o117 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r117(x)), i117(x), T(c117(x)), o117(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.defineProperty(F, "bar", { value: 8, writable: false }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true }); } catch (e) { out.push(e.name); } const d = all();
  console.log('class with a parent, made read-only' + ": " + [a, b, d].join(" | ")); }
{ const F = class extends Object {}, H = Object.create(F), HH = Object.create(H);
  const r118 = x => x.bar, i118 = x => "bar" in x, c118 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o118 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r118(x)), i118(x), T(c118(x)), o118(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; Object.setPrototypeOf(F, { bar: "from the new parent" }); } catch (e) { out.push(e.name); } const b = all(); try { Object.setPrototypeOf(F, Function.prototype); F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('class with a parent, its own parent changed' + ": " + [a, b, d].join(" | ")); }
{ const F = class extends Object {}, H = Object.create(F), HH = Object.create(H);
  const r119 = x => x.bar, i119 = x => "bar" in x, c119 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o119 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r119(x)), i119(x), T(c119(x)), o119(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { for (let i = 0; i < 70; i++) F["k" + i] = i; delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('class with a parent, many names added' + ": " + [a, b, d].join(" | ")); }
{ const F = class extends Object {}, H = Object.create(F), HH = Object.create(H);
  const r120 = x => x.bar, i120 = x => "bar" in x, c120 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o120 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r120(x)), i120(x), T(c120(x)), o120(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.freeze(F); } catch (e) { out.push(e.name); } const b = all(); try {  } catch (e) { out.push(e.name); } const d = all();
  console.log('class with a parent, frozen' + ": " + [a, b, d].join(" | ")); }
{ const F = class extends Object {}, H = Object.create(F), HH = Object.create(H);
  const r121 = x => x.bar, i121 = x => "bar" in x, c121 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o121 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r121(x)), i121(x), T(c121(x)), o121(x)].join("/")).join(" ");
  let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; F.bar = 7; const b = all(); delete F.bar; const d = all(); H.bar = "on the heir"; const e = all();
  console.log('class with a parent, absent first, then stored' + ": " + [a, b, d, e].join(" | ")); }
{ const F = (() => 1).bind(null), H = Object.create(F), HH = Object.create(H);
  const r122 = x => x.bar, i122 = x => "bar" in x, c122 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o122 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r122(x)), i122(x), T(c122(x)), o122(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('bound, deleted' + ": " + [a, b, d].join(" | ")); }
{ const F = (() => 1).bind(null), H = Object.create(F), HH = Object.create(H);
  const r123 = x => x.bar, i123 = x => "bar" in x, c123 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o123 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r123(x)), i123(x), T(c123(x)), o123(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; F.baz = "other"; } catch (e) { out.push(e.name); } const b = all(); try { delete F.baz; F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('bound, deleted, another name takes the slot' + ": " + [a, b, d].join(" | ")); }
{ const F = (() => 1).bind(null), H = Object.create(F), HH = Object.create(H);
  const r124 = x => x.bar, i124 = x => "bar" in x, c124 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o124 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r124(x)), i124(x), T(c124(x)), o124(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; F.b1 = "o1"; F.b2 = "o2"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('bound, deleted, two names added' + ": " + [a, b, d].join(" | ")); }
{ const F = (() => 1).bind(null), H = Object.create(F), HH = Object.create(H);
  const r125 = x => x.bar, i125 = x => "bar" in x, c125 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o125 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r125(x)), i125(x), T(c125(x)), o125(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.defineProperty(F, "bar", { get() { return "got"; }, configurable: true }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true, configurable: true }); } catch (e) { out.push(e.name); } const d = all();
  console.log('bound, made an accessor' + ": " + [a, b, d].join(" | ")); }
{ const F = (() => 1).bind(null), H = Object.create(F), HH = Object.create(H);
  const r126 = x => x.bar, i126 = x => "bar" in x, c126 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o126 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r126(x)), i126(x), T(c126(x)), o126(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { F.bar = "second"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('bound, made another value' + ": " + [a, b, d].join(" | ")); }
{ const F = (() => 1).bind(null), H = Object.create(F), HH = Object.create(H);
  const r127 = x => x.bar, i127 = x => "bar" in x, c127 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o127 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r127(x)), i127(x), T(c127(x)), o127(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { F.bar = () => "called"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('bound, made a function' + ": " + [a, b, d].join(" | ")); }
{ const F = (() => 1).bind(null), H = Object.create(F), HH = Object.create(H);
  const r128 = x => x.bar, i128 = x => "bar" in x, c128 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o128 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r128(x)), i128(x), T(c128(x)), o128(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.defineProperty(F, "bar", { value: 8, writable: false }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true }); } catch (e) { out.push(e.name); } const d = all();
  console.log('bound, made read-only' + ": " + [a, b, d].join(" | ")); }
{ const F = (() => 1).bind(null), H = Object.create(F), HH = Object.create(H);
  const r129 = x => x.bar, i129 = x => "bar" in x, c129 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o129 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r129(x)), i129(x), T(c129(x)), o129(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { delete F.bar; Object.setPrototypeOf(F, { bar: "from the new parent" }); } catch (e) { out.push(e.name); } const b = all(); try { Object.setPrototypeOf(F, Function.prototype); F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('bound, its own parent changed' + ": " + [a, b, d].join(" | ")); }
{ const F = (() => 1).bind(null), H = Object.create(F), HH = Object.create(H);
  const r130 = x => x.bar, i130 = x => "bar" in x, c130 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o130 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r130(x)), i130(x), T(c130(x)), o130(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { for (let i = 0; i < 70; i++) F["k" + i] = i; delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7; } catch (e) { out.push(e.name); } const d = all();
  console.log('bound, many names added' + ": " + [a, b, d].join(" | ")); }
{ const F = (() => 1).bind(null), H = Object.create(F), HH = Object.create(H);
  const r131 = x => x.bar, i131 = x => "bar" in x, c131 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o131 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r131(x)), i131(x), T(c131(x)), o131(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { Object.freeze(F); } catch (e) { out.push(e.name); } const b = all(); try {  } catch (e) { out.push(e.name); } const d = all();
  console.log('bound, frozen' + ": " + [a, b, d].join(" | ")); }
{ const F = (() => 1).bind(null), H = Object.create(F), HH = Object.create(H);
  const r132 = x => x.bar, i132 = x => "bar" in x, c132 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o132 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r132(x)), i132(x), T(c132(x)), o132(x)].join("/")).join(" ");
  let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; F.bar = 7; const b = all(); delete F.bar; const d = all(); H.bar = "on the heir"; const e = all();
  console.log('bound, absent first, then stored' + ": " + [a, b, d, e].join(" | ")); }
const shown = x => [T(x.name), T(x.length), T(x.prototype), "prototype" in x, Object.hasOwn(x, "prototype")].join("/");
for (const F of [() => 1, (c => () => c)(0), function () { return 1; }, function named() { return 1; }, ({ m() { return 1; } }).m, Object.getOwnPropertyDescriptor({ get g() { return 1; } }, "g").get, async () => 1, async function () {}, function* () {}, class { static s() {} }, class extends Object {}, (() => 1).bind(null)]) console.log("shown: " + [F, Object.create(F)].map(shown).join(" "));
console.log("errors " + out.join());
