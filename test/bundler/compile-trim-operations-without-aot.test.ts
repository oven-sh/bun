import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { spawned } from "../aot/harness/commands";
import { readRemovedFeatures } from "../aot/trimmed-against-whole/removed-features";
import { canTrim, model } from "./compile-trim-features";

const families = model.features.filter(each => each.enteredFrom === "compiled-code").map(each => each.name as string);

const programs: Record<string, string> = {
  "SelfCheckOperations.cjs": String.raw`
    const { hot } = require("./hot.cjs");
    {
      hot("a function that is only counted", 100000, function (i) { return i & 7; });
    }
  `,
  "ProxyOperations.cjs": String.raw`
    const { hot } = require("./hot.cjs");
    {
      const target = { a: 1, b: 2 }; Object.defineProperty(target, 'fixed', { value: 3 });
      const p = new Proxy(target, { get(t, k, r) { return k in t ? t[k] * 2 : 5; } });
      hot("get with a trap", 100000, function (i) { return p.a + p[i & 1 ? 'b' : 'c']; });
    }
    {
      const target = { a: 1, b: 2 }; Object.defineProperty(target, 'fixed', { value: 3 });
      const p = new Proxy(target, { has(t, k) { return k !== 'b' && k in t; } });
      hot("has with a trap", 100000, function (i) { return ('a' in p) + ((i & 1 ? 'b' : 'zz') in p); });
    }
    {
      const target = { a: 1, b: 2 }; Object.defineProperty(target, 'fixed', { value: 3 });
      const p = new Proxy(target, { set(t, k, v, r) { t[k] = v & 3; return true; } });
      hot("set with a trap", 100000, function (i) { p.a = i; p[i & 1 ? 'b' : 'n'] = i; return target.a + target.b; });
    }
  `,
  "JSONParseOperations.cjs": String.raw`
    const { hot } = require("./hot.cjs");
    {
      hot("an object of one shape", 100000, function (i) { const o = JSON.parse('{"id":' + (i & 15) + ',"name":"n","on":true,"list":[1,2.5,null]}'); return o.id + o.name + o.on + o.list.length; });
    }
    {
      const text = JSON.stringify(Array.from({ length: 20 }, (_, k) => k & 1 ? { a: k } : { a: k, b: 2 }));
      hot("a list of objects", 60000, function (i) { return JSON.parse(text).reduce((s, e) => s + e.a + (e.b ?? 0), i & 1); });
    }
  `,
  "StringBuilderOperations.cjs": String.raw`
    const { hot } = require("./hot.cjs");
    {
      hot("a text grows in a loop", 100000, function (i) { let s = ''; for (let k = 0; k < 12; k++) s += k + ','; return s + i % 3; });
    }
    {
      const source = 'the quick brown fox \u00e9\u4e2d jumps';
      hot("a text grows by slices", 100000, function (i) { let s = ''; for (let k = 0; k < 8; k++) s += source.slice(k, k + 3 + (i & 1)); return s; });
    }
  `,
  "TypedArrayOperations.cjs": String.raw`
    const { hot, mixedValues } = require("./hot.cjs");
    {
      hot("made from a length a list and a buffer", 100000, function (i) { const a = new Uint8Array(i & 7), b = new Float64Array([1, 2.5, i & 1]), c = new Int16Array(new ArrayBuffer(8), 2, 2); return a.length + b[1] + b[2] + c.byteOffset; });
    }
    {
      const mixed = mixedValues(); const u8 = new Uint8Array(4), f64 = new Float64Array(2);
      hot("stores of values of any type", 100000, function (i) { try { u8[i & 3] = mixed[i % mixed.length]; f64[i & 1] = mixed[(i + 1) % 9]; } catch (e) { return e.name; } return u8[i & 3] + ':' + f64[i & 1]; });
    }
    {
      const u8 = new Uint8Array(8);
      hot("set from lists and views", 100000, function (i) { u8.set([1, 2, i & 3]); u8.set(new Uint16Array([300, 4]), 3); u8.set({ length: 1, 0: '9' }, 5); try { u8.set([1], 8); } catch (e) { return e.name + u8.join(); } });
    }
  `,
  "TextEncodingOperations.cjs": String.raw`
    const { hot } = require("./hot.cjs");
    {
      const decoder = new TextDecoder(); const bytes = [new Uint8Array([104, 105]), new Uint8Array([0xe4, 0xb8, 0xad, 0x21]), new Uint8Array([0xff, 0x41]), new Uint8Array(0), new Uint8Array([0xf0, 0x9f, 0x98, 0x80]).buffer];
      hot("bytes become text", 100000, function (i) { return decoder.decode(bytes[i % bytes.length]); });
    }
    {
      const encoder = new TextEncoder(); const texts = ['hi', '\u4e2d!', '', '\ud83d\ude00', '\ud800', 'a'.repeat(40)];
      hot("text becomes bytes", 100000, function (i) { const b = encoder.encode(texts[i % texts.length]); return b.length + ':' + b[0]; });
    }
  `,
  "PrivateNameOperations.cjs": String.raw`
    const { hot } = require("./hot.cjs");
    {
      class Counter { #n = 0; constructor(n) { this.#n = n; } add(k) { this.#n += k; return this; } get value() { return this.#n; } }
      hot("fields are read and written", 100000, function (i) { const c = new Counter(i & 3); c.add(2); return c.value; });
    }
    {
      class Marked { #m; static is(o) { return #m in o; } } class Other { #m; } const all = [new Marked(), new Other(), {}, Object.create(new Marked()), new Proxy(new Marked(), {})];
      hot("a brand is asked", 100000, function (i) { return Marked.is(all[i % all.length]); });
    }
  `,
  "SuperOperations.cjs": String.raw`
    const { hot } = require("./hot.cjs");
    {
      class Parent { say(n) { return 'p' + n; } } class Child extends Parent { say(n) { return super.say(n) + 'c'; } }
      hot("a method above is called", 100000, function (i) { return new Child().say(i & 3); });
    }
    {
      const key = 'dyn'; class Parent { get kept() { return this._k ?? 0; } set kept(v) { this._k = v * 2; } get dyn() { return 'd'; } } class Child extends Parent { bump(v) { super.kept = v; super.plain = v; } read() { return super.kept + super[key]; } }
      hot("a property above is read and written", 100000, function (i) { const c = new Child(); c.bump(i & 3); return c.read() + ':' + c.kept + ':' + c[key]; });
    }
    {
      class Parent { constructor(...all) { this.sum = all.reduce((a, b) => a + b, 0); } } class Child extends Parent { constructor(...all) { super(...all, 1); } }
      hot("the parent is constructed with a list", 100000, function (i) { return new Child(1, i & 3, 2).sum; });
    }
  `,
  "ClassOperations.cjs": String.raw`
    const { hot } = require("./hot.cjs");
    {
      const name = 'm';
      hot("a class is made each turn", 60000, function (i) { class Point { constructor(x) { this.x = x; } get double() { return this.x * 2; } static of(x) { return new Point(x); } [name + (i & 1)]() { return 1; } } return Point.of(i & 3).double + Object.getOwnPropertyNames(Point.prototype).join(); });
    }
    {
      function Plain() {} const bad = function () {}; bad.prototype = 3; const all = [Object, null, Plain, Array, 5, () => 1, bad, class {}];
      hot("what a class extends is computed", 60000, function (i) { try { const K = class extends all[i % all.length] {}; return typeof K + Object.getPrototypeOf(K.prototype); } catch (e) { return e.name; } });
    }
  `,
  "DynamicImportOperations.mjs": String.raw`
    import { createRequire } from "node:module";
    import { hot, hotAsync } from "./hot.cjs";

    const require = createRequire(import.meta.url);
    const names = ["one", "two"];

    await hotAsync("a written name", 20000, async i => (await import("./modules/one.mjs")).value + (i & 1));
    await hotAsync("a computed name", 20000, async i => (await import("./modules/" + names[i & 1] + ".mjs")).value);
    await hotAsync("a module that awaits in its body", 20000, async () => (await import("./modules/waits.mjs")).done);
    await hotAsync("a name that is not there", 100, async i => {
      try {
        return await import("./modules/missing" + (i & 1) + ".mjs");
      } catch (error) {
        return error.name;
      }
    });
    hot("require with a computed name", 100000, i => require("./modules/" + names[i & 1] + ".cjs").value);
    hot("resolve with a computed name", 20000, i =>
      require
        .resolve("./modules/" + names[i & 1] + ".cjs")
        .split("/")
        .pop(),
    );
  `,
  "ReExportOperations.cjs": String.raw`
    const handedOn = require("./modules/hands-on-all.cjs");
    console.log(handedOn.value, Object.keys(handedOn));

    const live = require("./modules/passes-on-live-values.cjs");
    console.log(live.count);
    live.bump();
    console.log(live.count, typeof Object.getOwnPropertyDescriptor(live, "count").get);

    import("./modules/imports-what-is-passed-on.mjs").then(({ seen }) => console.log(seen));
  `,
  "ModuleFailureOperations.cjs": String.raw`
    for (let turn = 0; turn < 3; turn++) {
      try {
        console.log(require("./modules/throws.cjs"));
      } catch (error) {
        console.log(turn, error.message, globalThis.loadsOfWhatThrows);
      }
    }

    const counted = require.resolve("./modules/counts-its-loads.cjs");
    for (let turn = 0; turn < 4; turn++) {
      console.log(require("./modules/counts-its-loads.cjs").loads);
      if (turn & 1) delete require.cache[counted];
    }

    (async () => {
      for (let turn = 0; turn < 3; turn++) {
        try {
          console.log(await import("./modules/throws.mjs"));
        } catch (error) {
          console.log(turn, error.message, globalThis.loadsOfTheModuleThatThrows);
        }
      }
    })();
  `,
  "GlobalBindingOperations.cjs": String.raw`
    const { hot } = require("./hot.cjs");
    {
      globalThis.counter = 0; globalThis.shared = 10;
      hot("a global found by name", 100000, function (i) { counter = (counter + 1) & 7; return counter + shared; });
    }
    {
      hot("a name nobody declared", 60000, function (i) { try { return i & 1 ? typeof nowhere : nowhere; } catch (e) { return e.name + e.message; } });
    }
    {
      function strict(i) { 'use strict'; try { unheard = i; } catch (e) { return e.name; } }
      hot("a store to a name nobody declared", 60000, function (i) { if (i & 1) { fresh = i & 3; return fresh; } return strict(i); });
    }
    {
      hot("a free name is deleted", 60000, function (i) { globalThis.gone = 1; const a = delete gone; return [a, typeof gone, delete Infinity, delete globalThis.undefined]; });
    }
    {
      var x = 'outer'; const scopes = [{ x: 'in' }, {}, { y: 1 }, { x: 'hidden', [Symbol.unscopables]: { x: true } }, new Proxy({}, { has: (t, k) => k === 'x', get: (t, k) => k === Symbol.unscopables ? undefined : 'proxied' })];
      hot("names inside with", 100000, function (i) { with (scopes[i % scopes.length]) { return x + (typeof y); } });
    }
  `,
  "ArgumentsObjectOperations.cjs": String.raw`
    const { hot } = require("./hot.cjs");
    {
      function f(a, b) { arguments[0] = a + 10; b = 7; return a + ':' + arguments[1] + ':' + arguments.length; }
      hot("mapped to the parameters", 100000, function (i) { return f(i & 3, 2); });
    }
    {
      function f(a, b) { 'use strict'; arguments[0] = a + 10; b = 7; return a + ':' + arguments[1] + ':' + arguments.length; }
      hot("not mapped in strict code", 100000, function (i) { return f(i & 3, 2); });
    }
    {
      function f(k) { return arguments[k] + arguments[String(k)]; }
      hot("read under a computed index", 100000, function (i) { return f(i % 5, 'a', 'b', 'c'); });
    }
  `,
  "AsyncIteratorOperations.mjs": String.raw`
    import { hotAsync } from "./hot.cjs";
    {
      async function* up(n) { for (let k = 0; k < n; k++) yield k; }
      await hotAsync("for await over an async generator", 20000, async function (i) { let s = 0; for await (const v of up(3 + (i & 1))) s += v; return s; });
    }
    {
      await hotAsync("for await over a list of promises", 20000, async function (i) { let s = ''; for await (const v of [1, Promise.resolve(2), { then(r) { r(i & 3); } }]) s += v; return s; });
    }
  `,
  "GeneratorOperations.cjs": String.raw`
    const { hot } = require("./hot.cjs");
    {
      function* gen(a) { const b = yield a; const c = yield a + b; return c; }
      hot("values go out and come in", 100000, function (i) { const g = gen(i & 3); return [g.next().value, g.next(5).value, g.next(6)]; });
    }
    {
      const log = []; function* gen() { try { yield 1; yield 2; } catch (e) { yield 'c' + e.message; } finally { log.push(1); } }
      hot("return and throw from outside", 100000, function (i) { const g = gen(); g.next(); const a = i & 1 ? g.return(7) : g.throw(new Error('t')); return [a, g.next(), log.length & 3]; });
    }
  `,
  "AwaitOperations.mjs": String.raw`
    import { hotAsync } from "./hot.cjs";
    {
      await hotAsync("values promises and thenables", 20000, async function (i) { return (await 1) + (await Promise.resolve(2)) + (await { then(r) { r(i & 3); } }); });
    }
    {
      let done = 0;
      await hotAsync("a rejection is caught", 20000, async function (i) { try { await Promise.reject(new RangeError('r' + (i & 1))); } catch (e) { return e.message; } finally { done++; } });
    }
  `,
  "PromiseOperations.mjs": String.raw`
    import { hotAsync } from "./hot.cjs";
    {
      await hotAsync("made resolved and rejected", 20000, async function (i) { const a = await new Promise(r => r(i & 3)), b = await new Promise((_, j) => j(new Error('x'))).catch(e => e.message), c = await new Promise(() => { throw new TypeError('t'); }).catch(e => e.name); return [a, b, c]; });
    }
    {
      await hotAsync("then catch finally", 20000, async function (i) { return await Promise.resolve(i & 3).then(v => v + 1).then(() => { throw new Error('e'); }).catch(e => e.message + 1).finally(() => 9); });
    }
  `,
  "MapAndSetOperations.cjs": String.raw`
    const { hot } = require("./hot.cjs");
    {
      hot("made from entries and lists", 100000, function (i) { const m = new Map([[1, 'a'], ['k', i & 3], [NaN, 0]]), s = new Set([1, 1, '1', NaN, NaN, -0]); return [m.size, m.get('k'), m.get(NaN), s.size, s.has(0)]; });
    }
    {
      const m = new Map([['a', 1], ['b', 2]]), s = new Set([3, 4]);
      hot("walked by for of and by next", 100000, function (i) { let t = ''; for (const [k, v] of m) t += k + v; for (const v of s) t += v; const it = m.keys(); return t + it.next().value + it.next().value + it.next().done + (i & 1); });
    }
  `,
  "ObjectCopyOperations.cjs": String.raw`
    const { hot } = require("./hot.cjs");
    {
      const a = { x: 1, y: 2 }, b = { y: 3, w: 4 };
      hot("a spread into a literal", 100000, function (i) { const c = { ...a, z: i & 3, ...b }; return c; });
    }
    {
      const key = 'b', sym = Symbol('s');
      hot("rest in a pattern", 100000, function (i) { const { a, [key]: skipped, ...rest } = { a: 1, b: 2, c: i & 3, [sym]: 4, 1: 5 }; return [a, skipped, Object.keys(rest), rest[sym]]; });
    }
  `,
  "PropertyEnumerationOperations.cjs": String.raw`
    const { hot } = require("./hot.cjs");
    {
      const o = Object.create({ above: 1, shadowed: 2 }); o.b = 1; o.shadowed = 3; o[2] = 0; o[1] = 0; Object.defineProperty(o, 'hidden', { value: 1 }); o[Symbol('s')] = 1;
      hot("for in with what stands above", 100000, function (i) { let t = ''; for (const k in o) t += k; return t + (i & 1); });
    }
    {
      const all = [{ b: 1, a: 2, 1: 'n' }, [5, 6], 'st', 7, { get g() { return 1; } }, new (class { f = 1; m() {} })()];
      hot("keys values entries", 100000, function (i) { const o = all[i % all.length]; return [Object.keys(o), Object.values(o), Object.entries(o)]; });
    }
  `,
  "PropertyDescriptorOperations.cjs": String.raw`
    const { hot } = require("./hot.cjs");
    {
      hot("a property is defined", 100000, function (i) { const o = {}; Object.defineProperty(o, 'a', { value: i & 3, enumerable: true }); Object.defineProperty(o, 'g', { get() { return this.a + 1; }, configurable: true }); try { Object.defineProperty(o, 'a', { value: 9 }); } catch (e) { return [o.a, o.g, e.name]; } return [o.a, o.g]; });
    }
    {
      const all = [[{ a: 1 }, 'a'], [{ get g() { return 1; } }, 'g'], [[1], 'length'], [[1], 0], ['ab', 1], [function f() {}, 'name'], [{}, 'none'], [new Uint8Array(1), 0], [Object.freeze({ z: 1 }), 'z']];
      hot("a descriptor is read", 100000, function (i) { return Object.getOwnPropertyDescriptor(all[i % all.length][0], all[i % all.length][1]); });
    }
  `,
  "PropertyDeletionOperations.cjs": String.raw`
    const { hot } = require("./hot.cjs");
    {
      hot("by a written name", 100000, function (i) { const o = { a: 1, b: 2 }; const r = delete o.a; return [r, delete o.none, Object.keys(o), i & 1]; });
    }
    {
      const sym = Symbol('s'), keys = ['a', 'zz', 3, '3', sym, 1.5, { toString() { return 'b'; } }];
      hot("by a computed key", 100000, function (i) { const o = { a: 1, b: 2, 3: 3, [sym]: 4 }; return [delete o[keys[i % keys.length]], Reflect.ownKeys(o).length]; });
    }
    {
      const o = {}; Object.defineProperty(o, 'fixed', { value: 1 }); function f() {}
      hot("a fixed property in sloppy code", 100000, function (i) { return [delete o.fixed, delete [].length, delete 'ab'[0], delete f.prototype, o.fixed + (i & 1)]; });
    }
    {
      const key = 'fixed', o = {}; Object.defineProperty(o, 'fixed', { value: 1 });
      hot("a fixed property in strict code", 60000, function (i) { 'use strict'; try { return i & 1 ? delete o.fixed : delete o[key]; } catch (e) { return e.name + e.message; } });
    }
  `,
  "ArrayMutationOperations.cjs": String.raw`
    const { hot } = require("./hot.cjs");
    {
      hot("splice", 100000, function (i) { const a = [1, 2, 3, 4, 5]; const r = a.splice(i % 6, i & 3, 'n', 'm'); return [r, a, a.splice(-1), a.splice(1), a.splice()]; });
    }
    {
      hot("unshift and shift", 100000, function (i) { const a = [1.5, 2]; a.unshift(i & 3, 'x'); const s = a.shift(); a.unshift(); return [a, s, a.unshift([])]; });
    }
  `,
  "ArraySearchOperations.cjs": String.raw`
    const { hot } = require("./hot.cjs");
    {
      const ints = [5, 3, 1, 3, 0];
      hot("whole numbers", 100000, function (i) { return [ints.indexOf(i & 7), ints.includes(i & 7), ints.lastIndexOf(3), ints.indexOf(3, 3), ints.indexOf(3, -1), ints.indexOf('3'), ints.indexOf(3.0)]; });
    }
    {
      const d = [1.5, NaN, -0, 2, 3.25];
      hot("numbers with fractions", 100000, function (i) { return [d.indexOf(1.5), d.indexOf(NaN), d.includes(NaN), d.indexOf(0), d.includes(-0), d.indexOf(i & 3), d.indexOf(2)]; });
    }
    {
      const t = ['a', 'b', '\u4e2d', 'ab', 'a'], made = ['a' + 'b', ['z'].join()];
      hot("texts", 100000, function (i) { return [t.indexOf('b'), t.indexOf('b' + ''), t.includes(made[i & 1]), t.indexOf('\u4e2d'), t.indexOf(''), t.lastIndexOf('a')]; });
    }
  `,
  "ArrayCreationOperations.cjs": String.raw`
    const { hot } = require("./hot.cjs");
    {
      hot("a spread of lists texts sets and maps", 100000, function (i) { return [...[1, 2], ...'a\ud83d\ude00', ...new Set([i & 3, 3]), ...new Map([[1, 2]]), ...new Map([[1, 2]]).values(), ...new Uint8Array([7]), ...(function* () { yield 8; })(), ...[, 1]]; });
    }
    {
      const all = [[1, 2, 3, 4, 5], 'xy', new Set([1]), [], (function* () { yield 1; yield 2; yield undefined; yield 4; })(), new Map([[1, 2]])];
      hot("patterns over what can be walked", 100000, function (i) { const [a, , b = 'd', ...rest] = all[i % all.length]; return [a, b, rest]; });
    }
    {
      hot("stores past the end and under odd keys", 100000, function (i) { const a = [1]; a[3] = i & 3; a[1.5] = 'f'; a['2'] = 's'; a[-1] = 'n'; a[4294967295] = 'big'; return [a.length, a, Object.keys(a)]; });
    }
  `,
  "StringSearchOperations.cjs": String.raw`
    const { hot } = require("./hot.cjs");
    {
      const s = 'the quick brown fox jumps over the lazy dog';
      hot("a character and a written text", 100000, function (i) { return [s.indexOf('q'), s.indexOf('quick'), s.indexOf('zz'), s.indexOf(''), s.indexOf('o', 13 + (i & 1)), s.indexOf('the', -5), s.indexOf('g', 99)]; });
    }
    {
      const s = 'the quick brown fox jumps over the lazy dog';
      hot("from the end", 100000, function (i) { return [s.lastIndexOf('o'), s.lastIndexOf('the'), s.lastIndexOf('the', 10), s.lastIndexOf('zz'), s.lastIndexOf(''), s.lastIndexOf('t', -1), s.lastIndexOf('o', NaN), i & 1]; });
    }
  `,
  "StringCreationOperations.cjs": String.raw`
    const { hot } = require("./hot.cjs");
    {
      const r = [2, 10, 36, undefined, 1, 37, '8'];
      hot("a radix", 100000, function (i) { try { return [(i & 1023).toString(2), (255).toString(16), (-255.5).toString(36), (0.5).toString(2), (1e21).toString(7), (5).toString(r[i % r.length])]; } catch (e) { return e.name; } });
    }
    {
      const r = [0, 2, 1.9, '3', -1, Infinity];
      hot("pad and repeat", 100000, function (i) { try { return ['5'.padStart(3 + (i & 1), '0'), 'ab'.padEnd(5, 'xy'), 'a'.padStart(1), 'a'.padEnd(3, ''), 'ab'.repeat(i & 3), ''.repeat(1e9).length, 'x'.repeat(r[i % r.length]).length]; } catch (e) { return e.name; } });
    }
  `,
  "StringComparisonOperations.cjs": String.raw`
    const { hot } = require("./hot.cjs");
    {
      const t = ['a', 'b', 'ab', '', 'A', '\u4e2d', 'a\u4e2d', '10', '9', 'a'.repeat(20), 'a'.repeat(20) + 'b'];
      hot("less and greater", 100000, function (i) { const x = t[i % t.length], y = t[(i * 7 + 1) % t.length]; return [x < y, x <= y, x > y, x >= y]; });
    }
    {
      const t = ['alpha', 'beta', 'gam' + ['ma'].join(), '', '\u4e2d', 'alphb', ['al', 'pha'].join('')];
      hot("equal to a written text", 100000, function (i) { const x = t[i % t.length]; return [x === 'alpha', x == 'beta', x !== 'gamma', x === '', x === 'alph' + 'a', x === '\u4e2d']; });
    }
  `,
  "ArithmeticOperations.cjs": String.raw`
    const { hot, mixedValues, show } = require("./hot.cjs");

    const mixed = mixedValues();
    const operators = {
      add: (a, b) => a + b,
      subtract: (a, b) => a - b,
      multiply: (a, b) => a * b,
      divide: (a, b) => a / b,
      remainder: (a, b) => a % b,
      power: (a, b) => a ** b,
      and: (a, b) => a & b,
      or: (a, b) => a | b,
      xor: (a, b) => a ^ b,
      "shift left": (a, b) => a << b,
      "shift right": (a, b) => a >> b,
      "shift right unsigned": (a, b) => a >>> b,
      negate: a => -a,
      not: a => ~a,
      plus: a => +a,
      increment: a => [show(a++), show(++a)],
      decrement: a => [show(a--), show(--a)],
      "a number and a value": a => [show(2 + a), show(2.5 - a), show(3 * a), show(7 / a)],
      "Number called on a value": a => Number(a),
    };
    for (const [name, operate] of Object.entries(operators))
      hot(name, 100000, i => operate(mixed[i % mixed.length], mixed[(i * 5 + 3) % mixed.length]));

    hot("big integers in views", 100000, i => {
      const view = new BigInt64Array(1);
      view[0] = BigInt(i) * 4294967297n;
      return view[0] + 123456789012345678901234567890n;
    });
  `,
  "ComparisonOperations.cjs": String.raw`
    const { hot, mixedValues } = require("./hot.cjs");

    const mixed = mixedValues();
    const operators = {
      "loosely equal": (a, b) => a == b,
      "strictly equal": (a, b) => a === b,
      less: (a, b) => a < b,
      "less or equal": (a, b) => a <= b,
      greater: (a, b) => a > b,
      "greater or equal": (a, b) => a >= b,
    };
    for (const [name, compare] of Object.entries(operators))
      hot(name, 100000, i => compare(mixed[i % mixed.length], mixed[(i * 5 + 3) % mixed.length]));
  `,
  "ConversionOperations.cjs": String.raw`
    const { hot, mixedValues } = require("./hot.cjs");
    {
      const all = [1, 'a', true, null, undefined, {}, [], () => 1, class {}, Symbol('s'), 1n, new Proxy(function () {}, {}), new Proxy({}, {}), /r/, function* () {}];
      hot("typeof", 100000, function (i) { return typeof all[i % all.length]; });
    }
    {
      const mixed = mixedValues(); mixed.push(0n, new Boolean(false), new String(''), Symbol('s'));
      hot("true or false", 100000, function (i) { const v = mixed[i % mixed.length]; return [!!v, v ? 1 : 0, v && 1, v || 2, Boolean(v), !v]; });
    }
  `,
  "MembershipTestOperations.cjs": String.raw`
    const { hot } = require("./hot.cjs");
    {
      const sym = Symbol('s'), keys = ['a', 0, '0', 1, 2, -1, 1.5, 'length', sym, { toString() { return 'a'; } }, '00'], o = { a: 1, 0: 1, [sym]: 1 }, a = [1, , 3], u8 = new Uint8Array(2), s = new String('xy');
      hot("in by a computed key", 100000, function (i) { const k = keys[i % keys.length]; return [k in o, k in a, k in u8, k in s]; });
    }
    {
      class A {} class B extends A {} function F() {} const bound = A.bind(null), odd = function () {}; odd.prototype = 5; const vals = [new A(), new B(), new F(), {}, [], 5, null, Object.create(null), () => 1], kinds = [A, B, F, Object, Array, Function, bound, odd, () => 1, {}, 5, { [Symbol.hasInstance](v) { return v === 5; } }];
      hot("instanceof", 100000, function (i) { const v = vals[i % vals.length], K = kinds[(i >> 2) % kinds.length]; try { return v instanceof K; } catch (e) { return e.name; } });
    }
  `,
  "CallOperations.cjs": String.raw`
    const { hot } = require("./hot.cjs");
    {
      function f() { 'use strict'; return this + ':' + arguments.length + ':' + Array.prototype.join.call(arguments); } const all = [[1, 2], [], null, undefined, { length: 2, 0: 'a' }, 'ab', 5, (function () { return arguments; })(1, 2, 3), new Uint8Array([4, 5]), [, 1]];
      hot("apply with lists of every kind", 100000, function (i) { try { return f.apply(i & 1 ? null : 7, all[i % all.length]); } catch (e) { return e.name; } });
    }
    {
      function f(x, y, z) { if (new.target) { this.made = x + ':' + y; return; } return this.t + ':' + x + y + z; }
      hot("bound functions", 100000, function (i) { const b = f.bind({ t: 1 }, 1), c = b.bind(null, 2); return [b(i & 3), c(3), b.name, c.length, new b(5).made, b.prototype, new c() instanceof f]; });
    }
  `,
  "ErrorOperations.cjs": String.raw`
    const { hot, mixedValues, show } = require("./hot.cjs");
    {
      const mixed = mixedValues();
      hot("values of any type are thrown and caught", 100000, function (i) { try { throw mixed[i % mixed.length]; } catch (e) { return show(e); } });
    }
    {
      const log = []; function f(k) { for (let n = 0; n < 2; n++) { try { try { if (k === 0) return 'ret'; if (k === 1) throw new Error('t'); if (k === 2) break; if (k === 3) continue; } finally { log.push('f' + n); } } catch (e) { log.push('c'); return e.message; } finally { log.push('F'); } } return 'end'; }
      hot("finally runs on every way out", 100000, function (i) { log.length = 0; const r = f(i % 4); return [r, log.join('')]; });
    }
    {
      const all = [() => null.x, () => undefined.x.y, () => { 'use strict'; Object.freeze([1]).push(2); }, () => { early; let early; }, () => [].reduce((a, b) => a), () => new Array(-1), () => 'a'.repeat(-1), () => (1).toFixed(101), () => BigInt(1.5), () => 1n + 1, () => Symbol() + '', () => JSON.parse('{'), () => decodeURI('%'), () => new (class A extends Object { constructor() {} })(), () => ({}) instanceof 5, () => 'x' in 'y', () => structuredClone(() => 1), () => new Intl.NumberFormat('xx-invalid-locale-zz'), () => null[Symbol.iterator], () => { 'use strict'; undefined.x = 1; }];
      hot("the errors that the engine makes", 40000, function (i) { try { return all[i % all.length](); } catch (e) { return e.constructor.name + ': ' + e.message; } });
    }
  `,
  "DateOperations.cjs": String.raw`
    const { hot } = require("./hot.cjs");
    {
      hot("now and the iso form", 100000, function (i) { const n = Date.now(); return [typeof n, n > 1.6e12, new Date(86400000 * (i & 1023)).toISOString(), new Date(-1).toISOString(), new Date(8.64e15).toISOString()]; });
    }
    {
      hot("a date that is none", 60000, function (i) { try { return [String(new Date(NaN)), new Date('nope').getTime(), new Date(8.64e15 + 1).getTime(), JSON.stringify(new Date(NaN)), new Date(NaN).toISOString()]; } catch (e) { return e.name + (i & 1); } });
    }
  `,
  "ImageDataOperations.cjs": String.raw`
    const { hot, show } = require("./hot.cjs");
    {
      hot("a large written object", 100000, function (i) { const o = { a: 1, b: 'two', c: [1, 2, 3], d: { e: { f: null, g: true } }, h: 1.5, i: -0, j: [{ k: 1 }, { k: 2 }], l: undefined, 1: 'n', 'with space': 0, m: 10n, n: /r/g.flags }; o.c.push(i & 3); return [o.c, o.d.e, o.j[1].k, Object.keys(o).length, show(o.m)]; });
    }
    {
      hot("maps and sets of written values", 100000, function (i) { const m = new Map([['a', 1], ['b', 2], ['c', [3]], [4, 'd']]), s = new Set(['x', 'y', 1, 2.5, null]); m.get('c').push(i & 1); return [[...m], [...s]]; });
    }
  `,
  "DirectEvalOperations.cjs": String.raw`
    const { hot } = require("./hot.cjs");
    {
      hot("reads and writes locals", 20000, function (i) { let local = i & 3; const r = eval('local + 1'); eval('local = 9'); return [r, local]; });
    }
    {
      hot("declares a variable in the caller", 20000, function (i) { eval('var born = ' + (i & 3)); return [typeof born, born, (function () { 'use strict'; eval('var inner = 1'); return typeof inner; })()]; });
    }
  `,
};

const shared: Record<string, string> = {
  "runner.mjs": `
    import { resolve } from "node:path";
    await import(resolve(process.argv[2]));
  `,
  "hot.cjs": `
    function show(value) {
      try {
        if (typeof value === "string") return value;
        if (typeof value === "bigint") return value + "n";
        if (typeof value === "symbol") return value.toString();
        if (typeof value === "function") return "function " + value.name;
        return JSON.stringify(value) ?? String(value);
      } catch (error) {
        return "cannot be shown: " + error.name;
      }
    }

    function thrown(error) {
      return "threw " + (error && error.name) + ": " + (error && error.message);
    }

    function mix(digest, text) {
      for (let at = 0; at < text.length; at += 5) digest = (digest * 31 + text.charCodeAt(at)) | 0;
      return digest;
    }

    function hot(name, turns, run) {
      let digest = 0;
      let last = "";
      for (let i = 0; i < turns; i++) {
        try {
          last = show(run(i));
        } catch (error) {
          last = thrown(error);
        }
        digest = mix(digest, last);
      }
      console.log(name, digest, last.slice(0, 160));
    }

    async function hotAsync(name, turns, run) {
      let digest = 0;
      let last = "";
      for (let i = 0; i < turns; i++) {
        try {
          last = show(await run(i));
        } catch (error) {
          last = thrown(error);
        }
        digest = mix(digest, last);
      }
      console.log(name, digest, last.slice(0, 160));
    }

    function mixedValues() {
      const withValueOf = { valueOf: () => 4 };
      const withToString = { toString: () => "9" };
      const numbers = [0, 1, -1, 1.5, NaN, 2147483647, -2147483648, 1e21, -0];
      return [...numbers, "7", "x", "", true, false, null, undefined, 10n, -3n, withValueOf, withToString, [5], []];
    }

    module.exports = { hot, hotAsync, mixedValues, show };
  `,
  "modules/counter.cjs": `
    exports.count = 1;
    exports.bump = function () {
      exports.count++;
    };
  `,
  "modules/counts-its-loads.cjs": `
    globalThis.loadsThatWereCounted = (globalThis.loadsThatWereCounted ?? 0) + 1;
    exports.loads = globalThis.loadsThatWereCounted;
  `,
  "modules/hands-on-all.cjs": `
    module.exports = require("./one.cjs");
  `,
  "modules/imports-what-is-passed-on.mjs": `
    import all, { value } from "./hands-on-all.cjs";
    import * as namespace from "./passes-on-live-values.cjs";
    
    export const seen = [value, Object.keys(all), Object.keys(namespace).sort(), namespace.count > 0];
  `,
  "modules/one.cjs": `
    exports.value = 1;
  `,
  "modules/one.mjs": `
    export const value = 1;
  `,
  "modules/passes-on-live-values.cjs": `
    const counter = require("./counter.cjs");
    Object.keys(counter).forEach(function (key) {
      Object.defineProperty(exports, key, {
        enumerable: true,
        get: function () {
          return counter[key];
        },
      });
    });
  `,
  "modules/throws.cjs": `
    globalThis.loadsOfWhatThrows = (globalThis.loadsOfWhatThrows ?? 0) + 1;
    exports.half = 1;
    throw new Error("thrown at load " + globalThis.loadsOfWhatThrows);
  `,
  "modules/throws.mjs": `
    globalThis.loadsOfTheModuleThatThrows = (globalThis.loadsOfTheModuleThatThrows ?? 0) + 1;
    throw new Error("thrown at load " + globalThis.loadsOfTheModuleThatThrows);
  `,
  "modules/two.cjs": `
    exports.value = 2;
  `,
  "modules/two.mjs": `
    export const value = 2;
  `,
  "modules/waits.mjs": `
    await null;
    const later = await Promise.resolve(5);
    export const done = later + 1;
  `,
};

describe.skipIf(!canTrim)("an executable built with --trim and without --aot", () => {
  let dir: ReturnType<typeof tempDir> | undefined;
  let runner: Promise<string> | undefined;
  afterAll(() => dir?.[Symbol.dispose]());

  async function build() {
    dir = tempDir("compile-trim-operations-without-aot", { ...shared, ...programs });
    const cmd = [bunExe(), "build", "--compile", "--trim", "runner.mjs", "--outfile", "runner"];
    const { stderr, exitCode } = await spawned(cmd, String(dir), bunEnv);
    expect(stderr).not.toMatch(/^error\b/m);
    expect(exitCode).toBe(0);
    return join(String(dir), "runner" + (isWindows ? ".exe" : ""));
  }
  const built = () => (runner ??= build());

  test("has none of the families of operations", async () => {
    const removed = new Set(readRemovedFeatures(await built()));
    expect(families.length).toBeGreaterThan(30);
    expect(model.features.filter(each => families.includes(each.name) && !removed.has(each.index))).toEqual([]);
  }, 600_000);

  test("every family has a program here", () => {
    expect(Object.keys(programs).map(file => file.split(".")[0])).toEqual(families);
  });

  test.each(Object.keys(programs))(
    "runs %s as plain bun runs it",
    async file => {
      const executable = await built();
      const plain = await spawned([bunExe(), file], String(dir), bunEnv);
      const trimmed = await spawned([executable, file], String(dir), bunEnv);
      expect(plain.stdout).not.toBe("");
      expect({ stdout: trimmed.stdout, exitCode: trimmed.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
    },
    600_000,
  );
});
