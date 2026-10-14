const H = globalThis;
const one = v => Object.is(v, -0) ? "-0" : v === undefined ? "undefined" : typeof v === "string" ? JSON.stringify(v) : typeof v === "object" && v !== null ? "object" : typeof v === "function" ? "fn" : String(v);
const S = a => a.length + "[" + Array.from(a, one).join() + "]";
const ends = a => a.length + ":" + one(a[0]) + "," + one(a[1]) + ".." + one(a[a.length - 2]) + "," + one(a[a.length - 1]);
function say(name, f) { let r; try { r = f(); } catch (e) { r = "threw " + e.name; } console.log(name + ": " + r); }
const hide = v => { H.hidden = v; return H.hidden; };
H.id = function (...a) { return a; };
const doubles = n => { let l = [0.5, 1.5, 2.5, 3.5]; while (l.length < n) l = l.concat(l); l = l.slice(0, n); for (let i = 0; i < n; i += 4099) l[i] = i + 0.25; return hide(l); };
const total = a => { let t = 0; for (let i = 0; i < a.length; i++) if (typeof a[i] === "number") t += a[i]; return t; };

for (const n of [0, 1, 15, 16, 17, 18, 1000, 49999, 50000, 50001, 99997, 99998, 99999, 100000, 100001, 150000]) {
  const l = doubles(n);
  say("length " + n + " behind a string", () => { const r = ["s", ...l]; return ends(r) + " " + total(r); });
  say("length " + n + " copy", () => { const r = [...l]; return ends(r) + " " + total(r); });
  say("length " + n + " twice", () => { const r = ["s", ...l, ...l]; return ends(r) + " " + total(r); });
  say("length " + n + " with something between", () => { const r = [{}, ...l, "t", ...l, null]; return ends(r) + " " + total(r) + " " + one(r[n + 1]); });
  say("length " + n + " the source is as it was", () => ends(l) + " " + total(l));
}

say("an iterator of its own", () => { const l = hide([1.5, 2.5]); l[Symbol.iterator] = function* () { yield "mine"; }; return S(["s", ...l]) + S([...l]) + S(H.id("s", ...l)); });
say("an iterator of its own that is the usual one", () => { const l = hide([1.5, 2.5]); l[Symbol.iterator] = Array.prototype.values; return S(["s", ...l]); });
say("an iterator that is undefined", () => { const l = hide([1.5, 2.5]); l[Symbol.iterator] = undefined; return S(["s", ...l]); });
say("another prototype", () => { const l = hide([1.5, 2.5]); Object.setPrototypeOf(l, { __proto__: Array.prototype, *[Symbol.iterator]() { yield "proto"; } }); return S(["s", ...l]); });
say("another prototype without an iterator of its own", () => { const l = hide([1.5, 2.5]); Object.setPrototypeOf(l, { __proto__: Array.prototype }); return S(["s", ...l]); });
say("no prototype", () => { const l = hide([1.5, 2.5]); Object.setPrototypeOf(l, null); return S(["s", ...l]); });
say("an heir with an iterator", () => { class N extends Array { *[Symbol.iterator]() { yield "heir"; } } return S(["s", ...hide(N.of(1.5, 2.5))]); });
say("an heir without", () => { class N extends Array {} return S(["s", ...hide(N.of(1.5, 2.5))]); });
say("a name added", () => { const l = hide([1.5, 2.5]); l.extra = 1; return S(["s", ...l]); });
say("not extensible, sealed, frozen", () => S(["s", ...hide(Object.preventExtensions([1.5, 2.5]))]) + S(["s", ...hide(Object.seal([1.5, 2.5]))]) + S(["s", ...hide(Object.freeze([1.5, 2.5]))]));
say("a length that cannot be written", () => { const l = hide([1.5, 2.5]); Object.defineProperty(l, "length", { writable: false }); return S(["s", ...l]); });
say("an accessor under an index", () => { const l = hide([1.5, 2.5]); let n = 0; Object.defineProperty(l, 0, { get() { return "got" + n++; } }); return S(["s", ...l, ...l]); });
say("an accessor that changes the array", () => { const l = hide([1.5, 2.5, 3.5]); Object.defineProperty(l, 0, { get() { l.length = 2; return "got"; } }); return S(["s", ...l]); });
say("a proxy", () => { const seen = []; const p = new Proxy(hide([1.5, 2.5]), { get(t, k, r) { seen.push(typeof k === "symbol" ? "symbol" : k); return Reflect.get(t, k, r); } }); return S(["s", ...p]) + seen.join(); });
say("sparse", () => { const l = hide([1.5]); l[200000] = 2.5; const r = ["s", ...l]; return ends(r) + " " + total(r); });

const changes = { pushesText: l => l.push("t"), pushesNaN: l => l.push(NaN), makesHole: l => delete l[0], growsByLength: l => l.length = 4, empties: l => l.length = 0, storesPast: l => l[5] = 9.5, storesObject: l => l[0] = {}, storesWhole: l => l[0] = 7, reverses: l => l.reverse(), shifts: l => l.shift(), freezes: l => Object.freeze(l), ownIterator: l => l[Symbol.iterator] = function* () { yield "mine"; } };
for (const [name, change] of Object.entries(changes)) {
  say("between two spreads: " + name, () => { const l = hide([1.5, 2.5, 3.5]); return S(["s", ...l, typeof change(l), ...l]); });
  say("between two spreads in a call: " + name, () => { const l = hide([1.5, 2.5, 3.5]); return S(H.id("s", ...l, typeof change(l), ...l)); });
  say("ahead of the spread: " + name, () => { const l = hide([1.5, 2.5, 3.5]); change(l); return S(["s", ...l]) + S([...l]); });
}

{ const l = hide([1.5, 2, -0, 4e300]);
  say("targets", () => S([, ...l]) + S(["s", , ...l]) + S([...l, , ...l]) + S([, , ]) + S([1.5, ...l]) + S([1, ...l]) + S([{}, ...l]) + S([null, ...l]) + S([undefined, ...l]) + S([-0, ...l]) + S([NaN, ...l]) + S([true, ...l]) + S([1n, ...l].map(String)) + S([Symbol.iterator, ...l].slice(1)));
  say("holes of the target stay holes", () => { const r = ["s", , ...l]; return (1 in r) + "," + (2 in r) + "," + Object.keys(r).join(); });
  say("targets with a spread ahead", () => S([..."ab", ...l]) + S([...new Set([1, "x"]), ...l]) + S([...[], ...l]) + S([...[{}], ...l]) + S([...l, ...[]]) + S([...l, ..."ab"]));
  say("the copy is its own", () => { const r = ["s", ...l], q = ["s", ...l]; r[1] = "stored"; r.push({}); r.length = 3; return S(r) + S(q) + S(l); });
}

{ const r = ["s", ...hide([1, 2, 3, 0, -1, 2147483647, 4294967295, 4294967296])];
  say("whole numbers: compared", () => [r[1] === 1, r[1] == 1, Object.is(r[1], 1), r[1] !== 1, r[4] === 0, Object.is(r[4], 0), Object.is(r[4], -0), r[1] < r[2], r[1] === r[2] - 1, r[6] === 2147483647, r[7] === 4294967295].join());
  say("whole numbers: as keys", () => [new Map([[1, "m"]]).get(r[1]), new Set([r[1], 1, r[2], 2]).size, ({ 1: "k" })[r[1]], ["a", "b", "c"][r[1]], "abc"[r[1]], "abc".charAt(r[2]), Object.keys({ [r[1]]: 1, [r[6]]: 1, [r[8]]: 1 }).join("/"), new Map([[r[4], "zero"]]).get(-0), new WeakMap().has(r[1]), (r[1] in ["a", "b"]), [10, 20, 30].at(r[5])].join());
  say("whole numbers: computed with", () => [r[1] | 0, r[1] << 1, r[7] | 0, r[8] | 0, r[7] >>> 0, ~r[1], r[1] + r[2], r[6] + r[1], r[1] / r[2], r[3] % r[2], r[2] ** r[3], -r[4], Object.is(-r[4], -0), r[1]++ + r[1], Math.max(...r.slice(1)), Math.imul(r[6], r[2]), Math.clz32(r[2])].join());
  say("whole numbers: as text", () => [String(r[2]), `${r[2]}`, r[2] + "", r[2].toString(2), r[2].toFixed(1), JSON.stringify(r), r.join("|"), r.slice(1).sort().join(), typeof r[2], Number.isInteger(r[2]), Number.isSafeInteger(r[8]), BigInt(r[2]) + ""].join());
  say("whole numbers: as lengths and counts", () => [new Array(r[2]).length, "x".repeat(r[3]), r.slice(r[2]).length, Array.from({ length: r[2] }).length, new Uint8Array(r[3]).length, "abcdef".slice(r[2], r[3]), [1, 2, 3, 4].splice(r[2]).length, "abc".padEnd(r[3] + r[2], "-")].join());
  say("whole numbers: searched for", () => [r.indexOf(2), r.includes(3), r.lastIndexOf(0), r.indexOf(-0), r.findIndex(v => v === 3), r.filter(v => v === 2).length, r.indexOf(4294967296)].join());
  say("whole numbers: in a switch", () => r.slice(1, 6).map(v => { switch (v) { case 0: return "zero"; case 1: return "one"; case 2: return "two"; case 3: return "three"; case -1: return "minus"; default: return "other"; } }).join());
}

const f64 = new Float64Array(2), w = new Uint32Array(f64.buffer), f32 = new Float32Array(1), w32 = new Uint32Array(f32.buffer), view = new DataView(new ArrayBuffer(8));
const payloads = [[0xFFFE0000, 7], [0xFFFE0000, 0], [0xFFFE0000, 2], [0xFFFE0000, 6], [0xFFFE0000, 10], [0xFFFE0001, 0x23456780], [0xFFFF0000, 0x12345678], [0xFFFFFFFF, 0xFFFFFFFF], [0xFFF80000, 0], [0xFFF80000, 1], [0xFFF00000, 1], [0x7FF80000, 0], [0x7FF80000, 1], [0x7FF00000, 1], [0x7FFFFFFF, 0xFFFFFFFF], [0xFFFC0000, 0], [0xFFFDFFFF, 0xFFFFFFFF]];
for (const [high, low] of payloads) {
  w[0] = low; w[1] = high; f64[1] = 1.5; view.setUint32(0, high); view.setUint32(4, low);
  const name = "NaN " + high.toString(16) + ":" + low.toString(16);
  const tell = x => [typeof x, Object.is(x, NaN), x === x, String(x), one([x][0]), one(hide([x])[0]), one(hide({ x }).x), one(H.id(x)[0]), one((() => x)()), JSON.stringify([x]), new Map([[x, "m"]]).get(NaN), [x].includes(NaN), [x].indexOf(x), Math.max(x, 1), x | 0, one(x + 1), typeof hide(x), one(Reflect.apply(v => v, null, [x]))].join();
  say(name + " read", () => tell(f64[0])); say(name + " by a view", () => tell(view.getFloat64(0))); say(name + " at", () => tell(f64.at(0)));
  say(name + " pushed to doubles", () => { const l = [1.5]; l.push(f64[0]); const m = hide([2.5, 3.5]); m[0] = f64[0]; m.push(f64[0]); return S(l) + S(m) + S(["s", ...l]) + S(["s", ...m]) + S([...m]) + S(H.id("s", ...m)); });
  say(name + " the typed array spread", () => S([...f64]) + S(["s", ...f64]) + S(H.id(...f64)) + S(H.id("s", ...f64)) + S(Array.from(f64)) + S(Array.prototype.slice.call(f64)) + S(Array.prototype.map.call(f64, v => v)) + S([].concat(Array.from(f64))) + S(Object.values(f64)) + S([...f64.values()]) + S([...f64.entries()].map(e => e[1])));
  say(name + " handed on by the typed array", () => { const seen = []; f64.forEach(v => seen.push(v)); f64.map(v => (seen.push(v), v)); seen.push(f64.find(v => v !== v), f64.reduce((a, v) => v !== v ? v : a, 0), f64.slice()[0], f64.subarray(0)[0], new Float64Array(f64)[0], Float64Array.from(f64)[0], f64.with(1, 2)[0], f64.toSorted()[1], f64.toReversed()[1]); return S(seen) + f64.join() + f64.includes(NaN) + f64.indexOf(NaN); });
  say(name + " kept over a collection", () => { const kept = []; for (let i = 0; i < 300; i++) kept.push(["s", f64[0], { i }], [f64[0], 1.5]); if (typeof gc === "function") gc(); return S(kept[598]) + S(kept[599]) + kept.length; });
}
for (const bits of [0xFFFFFFFF, 0xFFC00000, 0xFFC00001, 0xFF800001, 0x7FC00000, 0x7FFFFFFF, 0xFFFF0007]) {
  w32[0] = bits; view.setUint32(0, bits);
  say("NaN of 32 bits " + bits.toString(16), () => { const x = f32[0], y = view.getFloat32(0); const l = [1.5]; l.push(x); l.push(y); return [typeof x, Object.is(x, NaN), one(hide([x])[0]), one(H.id(y)[0]), typeof hide(y), S(["s", ...l]), S([...f32]), S(["s", ...f32]), S(H.id("s", ...f32)), JSON.stringify([x, y])].join(); });
}

say("A BAD TIME", () => { const p = {}; Object.create(p); Object.defineProperty(p, 0, { value: 7, writable: false }); return "from here on"; });
{ const before = doubles(20);
  say("in a bad time", () => { const l = hide([1.5, 2.5, 3]); return S(["s", ...l]) + S([...l]) + S([, ...l]) + S(H.id("s", ...l)) + ends(["s", ...before]) + ends(["s", ...doubles(100001)]); });
}
console.log("done");
