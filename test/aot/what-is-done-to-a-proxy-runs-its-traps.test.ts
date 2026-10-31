// What a program does to a proxy, to an object below one, or to something that holds one runs the traps of the handler as in plain Bun.
// Each scene has a proxy and a handler of its own, so that what one scene does to its proxy says nothing of another's. A trap writes its
// name and its key into the log of its scene. The programs are written here, built, and held against what plain Bun prints.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, slot, spawned, told } from "./harness/commands";
import { test } from "./supported";

const everyTrap = `{
  get(t, k, r) { log.push("get:" + String(k)); return Reflect.get(t, k); },
  has(t, k) { log.push("has:" + String(k)); return Reflect.has(t, k); },
  set(t, k, v, r) { log.push("set:" + String(k)); return Reflect.set(t, k, v); },
  deleteProperty(t, k) { log.push("delete:" + String(k)); return Reflect.deleteProperty(t, k); },
  ownKeys(t) { log.push("ownKeys"); return Reflect.ownKeys(t); },
  getOwnPropertyDescriptor(t, k) { log.push("describe:" + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); },
  defineProperty(t, k, d) { log.push("define:" + String(k)); return Reflect.defineProperty(t, k, d); },
  getPrototypeOf(t) { log.push("getPrototypeOf"); return Reflect.getPrototypeOf(t); },
  setPrototypeOf(t, o) { log.push("setPrototypeOf"); return Reflect.setPrototypeOf(t, o); },
  isExtensible(t) { log.push("isExtensible"); return Reflect.isExtensible(t); },
  preventExtensions(t) { log.push("preventExtensions"); return Reflect.preventExtensions(t); },
}`;

const everyTrapOfAFunction = `{
  get(t, k, r) { log.push("get:" + String(k)); return Reflect.get(t, k); },
  has(t, k) { log.push("has:" + String(k)); return Reflect.has(t, k); },
  set(t, k, v, r) { log.push("set:" + String(k)); return Reflect.set(t, k, v); },
  deleteProperty(t, k) { log.push("delete:" + String(k)); return Reflect.deleteProperty(t, k); },
  ownKeys(t) { log.push("ownKeys"); return Reflect.ownKeys(t); },
  getOwnPropertyDescriptor(t, k) { log.push("describe:" + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); },
  defineProperty(t, k, d) { log.push("define:" + String(k)); return Reflect.defineProperty(t, k, d); },
  getPrototypeOf(t) { log.push("getPrototypeOf"); return Reflect.getPrototypeOf(t); },
  setPrototypeOf(t, o) { log.push("setPrototypeOf"); return Reflect.setPrototypeOf(t, o); },
  isExtensible(t) { log.push("isExtensible"); return Reflect.isExtensible(t); },
  preventExtensions(t) { log.push("preventExtensions"); return Reflect.preventExtensions(t); },
  apply(t, s, l) { log.push("apply"); return 1; },
  construct(t, l, n) { log.push("construct"); return {}; },
}`;

const everyTrapButGet = `{
  has(t, k) { log.push("has:" + String(k)); return Reflect.has(t, k); },
  set(t, k, v, r) { log.push("set:" + String(k)); return true; },
  deleteProperty(t, k) { log.push("delete:" + String(k)); return true; },
  ownKeys(t) { log.push("ownKeys"); return []; },
  getOwnPropertyDescriptor(t, k) { log.push("describe:" + String(k)); return undefined; },
  defineProperty(t, k, d) { log.push("define:" + String(k)); return true; },
  getPrototypeOf(t) { log.push("getPrototypeOf"); return null; },
}`;

const trapsThatSayWhatIsStored = `{
  get(t, k, r) { log.push("get:" + String(k)); return Reflect.get(t, k); },
  has(t, k) { log.push("has:" + String(k)); return Reflect.has(t, k); },
  set(t, k, v, r) { log.push("set:" + String(k) + "=" + (v && v.mark)); return Reflect.set(t, k, v); },
  deleteProperty(t, k) { log.push("delete:" + String(k)); return Reflect.deleteProperty(t, k); },
  ownKeys(t) { log.push("ownKeys"); return Reflect.ownKeys(t); },
  getOwnPropertyDescriptor(t, k) { log.push("describe:" + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); },
  defineProperty(t, k, d) { log.push("define:" + String(k) + "=" + (d.value && d.value.mark)); return Reflect.defineProperty(t, k, d); },
  getPrototypeOf(t) { log.push("getPrototypeOf"); return Reflect.getPrototypeOf(t); },
}`;

type Scene = [name: string, does: string];
type Program = { awaits: boolean; before: string; scenes: Scene[] };

const doneToAnObjectBelow: Scene[] = [
  ["read by name", "return o.a;"],
  ["read of a name nobody has", "return o.none;"],
  ["read by a computed key", "return o[key];"],
  ["read by a symbol", "return o[Symbol.iterator];"],
  ["test by in", 'return "a" in o;'],
  ["test by in under a computed key", "return key in o;"],
  ["store", "return (o.a = 2);"],
  ["store of a new name", "return (o.fresh = 2);"],
  ["store under a computed key", "return (o[key] = 2);"],
  ["delete", "return delete o.a;"],
  ["call of a member", "return o.m();"],
  ["optional call of a member", "return o.none?.();"],
  ["keys", "return Object.keys(o).join();"],
  ["for in", 'return (() => { let s = ""; for (const k in o) s += k; return s; })();'],
  ["spread into a literal", "return Object.keys({ ...o }).join();"],
  ["pattern", "return (() => { const { a } = o; return a; })();"],
  ["assign from", "return Object.assign({}, o).a;"],
  ["instanceof on the left", "return o instanceof Array;"],
  ["instanceof a class of the program", "return o instanceof Named;"],
  ["isPrototypeOf", "return Array.prototype.isPrototypeOf(o);"],
  ["prototype asked twice", "return Object.getPrototypeOf(Object.getPrototypeOf(o)) === Object.prototype;"],
  ["has own", 'return Object.hasOwn(o, "a");'],
  ["JSON", "return JSON.stringify(o);"],
  ["template", "return `${o}`;"],
  ["concatenation", 'return "" + o;'],
  ["arithmetic", "return +o;"],
  ["loose equality", "return o == 1;"],
  ["String", "return String(o);"],
  ["join of a list", "return [o].join();"],
  ["super read", "return { __proto__: o, f() { return super.a; }, }.f();"],
  ["Reflect.get", 'return Reflect.get(o, "a");'],
  ["Reflect.has", 'return Reflect.has(o, "a");'],
  ["Reflect.set", 'return Reflect.set(o, "a", 1);'],
  ["await", "return typeof (await o);"],
  ["returned by an async function", "return typeof (await (async () => o)());"],
  ["Promise.resolve", "return typeof (await Promise.resolve(o));"],
  ["for of", "return (() => { try { for (const x of o) return x; } catch (e) { return e.constructor.name; } })();"],
  ["Array.from", "return Array.from(o).length;"],
  ["concat", "return [].concat(o).length;"],
  ["handed to a function that reads", "return (q => q.a)(o);"],
  ["this of a call", "return function () { return this.a; }.call(o);"],
  ["descriptor", 'return Object.defineProperty({}, "x", o).x;'],
  ["options of a built-in", 'return new Intl.NumberFormat("en", o).format(1);'],
  ["toString.call", "return Object.prototype.toString.call(o);"],
  ["cause of an error", 'return new Error("m", o).cause;'],
  ["one more below", "return Object.create(o).a;"],
];

const waysToStandBelow: [standing: string, made: string][] = [
  ["a literal", "const o = { __proto__: p };"],
  ["what Object.create made", "const o = Object.create(p);"],
  ["what setPrototypeOf moved", "const o = Object.setPrototypeOf({}, p);"],
  ["an instance of a function whose prototype it is", "function F() {} F.prototype = p; const o = new F();"],
  [
    "an instance of a class whose prototype object stands below it",
    "class C {} Object.setPrototypeOf(C.prototype, p); const o = new C();",
  ],
  [
    "what Reflect.construct made for a function whose prototype it is",
    "function G() {} G.prototype = p; const o = Reflect.construct(Object, [], G);",
  ],
];

const programs: Record<string, Program> = {
  "a built-in gets a proxy or what holds one": {
    awaits: true,
    before: `const p = new Proxy( { a: 1 }, ${everyTrap}, );`,
    scenes: [
      ["Object.values", "return Object.values({ x: p })[0] === p;"],
      ["Object.entries", "return Object.entries({ x: p })[0][1] === p;"],
      ["Object.fromEntries", 'return Object.fromEntries([["x", p]]).x === p;'],
      ["Object.assign of a holder", "return Object.assign({}, { x: p }).x === p;"],
      ["spread of a holder", "return { ...{ x: p } }.x === p;"],
      [
        "structuredClone of a holder",
        "return (() => { try { return typeof structuredClone({ x: p }); } catch (e) { return e.constructor.name; } })();",
      ],
      ["JSON of a holder in a holder", "return JSON.stringify({ y: { x: p } });"],
      ["JSON with a replacer", "return JSON.stringify({ x: p }, (k, v) => v);"],
      ["JSON with a list of keys that is the proxy", "return JSON.stringify({ a: 1 }, p);"],
      ["Map.forEach", "return (() => { let r; new Map([[1, p]]).forEach(v => (r = v === p)); return r; })();"],
      ["values of a Map", "return [...new Map([[1, p]]).values()][0] === p;"],
      ["Array.from a list", "return Array.from([p])[0] === p;"],
      ["Array.from with a function", "return Array.from([p], q => q === p)[0];"],
      ["Array.of", "return Array.of(p)[0] === p;"],
      ["flat", "return [[p]].flat()[0] === p;"],
      ["flat of the list that holds it", "return [p].flat()[0] === p;"],
      ["flatMap", "return [1].flatMap(() => p).length;"],
      ["concat of a list that holds it", "return [].concat([p])[0] === p;"],
      ["slice", "return [p].slice()[0] === p;"],
      ["filter", "return [p].filter(() => true)[0] === p;"],
      ["find", "return [p].find(() => true) === p;"],
      ["indexOf", "return [p].indexOf(p);"],
      ["reverse", "return [p, 1].reverse()[1] === p;"],
      ["sort with a function", "return [p, p].sort(() => 0)[0] === p;"],
      ["toSorted without a function", "return [p, p].toSorted().length;"],
      ["toString of a list", "return [p].toString();"],
      ["toLocaleString of a list", "return [p].toLocaleString();"],
      ["template of a list", "return `${[p]}`;"],
      ["Promise.all", "return (await Promise.all([p]))[0] === p;"],
      ["Promise.allSettled", "return (await Promise.allSettled([p]))[0].status;"],
      ["Promise.race", "return (await Promise.race([p])) === p;"],
      ["Promise.any", "return (await Promise.any([p])) === p;"],
      ["reduce", "return [p].reduce((a, q) => a + (q === p), 0);"],
      ["Object.groupBy", 'return Object.keys(Object.groupBy([p], q => "g")).join();'],
      [
        "Object.groupBy by the proxy",
        "return (() => { try { return Object.keys(Object.groupBy([1], () => p)).length; } catch (e) { return e.constructor.name; } })();",
      ],
      ["Reflect.apply with it as this", "return Reflect.apply( function () { return this === p; }, p, [], );"],
      ["Reflect.apply with it in the list", "return Reflect.apply(q => q === p, null, [p]);"],
      ["apply with it in the list", "return (q => q === p).apply(null, [p]);"],
      ["call", "return (q => q === p).call(null, p);"],
      ["bind", "return (q => q === p).bind(null, p)();"],
      ["spread call", "return (q => q === p)(...[p]);"],
      ["new with it as an argument", "return new (class { constructor(q) { this.r = q === p; } })(p).r;"],
      [
        "Reflect.construct with it in the list",
        "return Reflect.construct( class { constructor(q) { this.r = q === p; } }, [p], ).r;",
      ],
      [
        "Reflect.construct with it as the list",
        "return (() => { try { return typeof Reflect.construct(Object, p); } catch (e) { return e.constructor.name; } })();",
      ],
      [
        "Reflect.construct with it as new.target",
        "return (() => { try { return typeof Reflect.construct(Object, [], p); } catch (e) { return e.constructor.name; } })();",
      ],
      ["Object.is", "return Object.is(p, p);"],
      ["WeakRef", "return new WeakRef(p).deref() === p;"],
      ["WeakSet", "return new WeakSet([p]).has(p);"],
      [
        "Symbol description",
        "return (() => { try { return typeof Symbol(p); } catch (e) { return e.constructor.name; } })();",
      ],
      ["Number", "return Number(p);"],
      ["BigInt", "return (() => { try { return typeof BigInt(p); } catch (e) { return e.constructor.name; } })();"],
      ["Boolean", "return Boolean(p);"],
      ["parseInt", "return parseInt(p);"],
      ["isNaN", "return isNaN(p);"],
      ["Math.max", "return Math.max(p);"],
      ["String.prototype.concat", 'return "".concat(p);'],
      [
        "includes of a string",
        'return (() => { try { return "a".includes(p); } catch (e) { return e.constructor.name; } })();',
      ],
      [
        "RegExp from it",
        "return (() => { try { return typeof new RegExp(p); } catch (e) { return e.constructor.name; } })();",
      ],
      ["Date from it", "return typeof new Date(p);"],
      ["Error message", "return new Error(p).message;"],
      ["AggregateError of a list that holds it", "return new AggregateError([p]).errors[0] === p;"],
      ["typed array from it", "return new Uint8Array(p).length;"],
      ["Array constructor", "return new Array(p).length;"],
      ["Object constructor", "return Object(p) === p;"],
      [
        "new Set from it",
        "return (() => { try { return new Set(p).size; } catch (e) { return e.constructor.name; } })();",
      ],
      [
        "new Map from a list of it",
        "return (() => { try { return new Map([p]).size; } catch (e) { return e.constructor.name; } })();",
      ],
      [
        "Object.fromEntries of a list of it",
        "return (() => { try { return Object.keys(Object.fromEntries([p])).length; } catch (e) { return e.constructor.name; } })();",
      ],
      ["Object.freeze of a holder", "return Object.freeze({ x: p }).x === p;"],
      ["Object.seal", "return Object.seal(p) === p;"],
      ["propertyIsEnumerable", 'return Object.prototype.propertyIsEnumerable.call(p, "a");'],
      ["valueOf", "return Object.prototype.valueOf.call(p) === p;"],
      ["toLocaleString.call", "return Object.prototype.toLocaleString.call(p);"],
      ["__lookupGetter__", 'return typeof Object.prototype.__lookupGetter__.call(p, "a");'],
      ["__defineGetter__", 'return typeof Object.prototype.__defineGetter__.call(p, "g", () => 1);'],
      ["__proto__ read", "return p.__proto__ === Object.prototype;"],
      ["__proto__ stored", "return ((p.__proto__ = null), 1);"],
      [
        "getter of __proto__ called for it",
        'return Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").get.call(p) === Object.prototype;',
      ],
      ["Array.prototype.push.call", "return Array.prototype.push.call(p, 1);"],
      ["Array.prototype.map.call", "return Array.prototype.map.call(p, x => x).length;"],
      ["Array.prototype.join.call", "return Array.prototype.join.call(p);"],
      [
        "Function.prototype.toString.call",
        "return (() => { try { return typeof Function.prototype.toString.call(p); } catch (e) { return e.constructor.name; } })();",
      ],
      ["iterator helper over a list that holds it", "return [p] .values() .map(q => q === p) .toArray()[0];"],
      [
        "Iterator.from",
        "return (() => { try { return typeof Iterator.from(p); } catch (e) { return e.constructor.name; } })();",
      ],
      ["queueMicrotask of a function that reads", "return await new Promise(r => queueMicrotask(() => r(p.a)));"],
      ["setTimeout with it as an argument", "return await new Promise(r => setTimeout(q => r(q === p), 0, p));"],
      ["a generator yields it", "return ( [ ...(function* () { yield p; })(), ][0] === p );"],
      [
        "a generator is sent it",
        "return (() => { const g = (function* () { return (yield) === p; })(); g.next(); return g.next(p).value; })();",
      ],
      ["an async generator yields it", "return ( ( await (async function* () { yield p; })().next() ).value === p );"],
      ["label of console.count", "return (console.countReset(p), 1);"],
      ["Bun.inspect", "return typeof Bun.inspect(p);"],
      ["Bun.inspect of a holder", "return typeof Bun.inspect({ x: p });"],
      ["Bun.deepEquals", "return Bun.deepEquals(p, { a: 1 });"],
      ["Bun.deepEquals of holders", "return Bun.deepEquals({ x: p }, { x: p });"],
    ],
  },
  "one thing is done to a proxy": {
    awaits: true,
    before: `const p = new Proxy( { a: 1, m() { return 7; }, }, ${everyTrapOfAFunction}, );`,
    scenes: [
      ["read by name", "return p.a;"],
      ["read by a computed key", "return p[key];"],
      ["read by a symbol", "return p[Symbol.iterator];"],
      ["test by in", 'return "a" in p;'],
      ["test by in under a computed key", "return key in p;"],
      ["store", "return (p.a = 2);"],
      ["store under a computed key", "return (p[key] = 2);"],
      ["delete", "return delete p.a;"],
      ["call of a member", "return p.m();"],
      ["optional call of a member", "return p.none?.();"],
      ["keys", "return Object.keys(p).join();"],
      ["own names", "return Object.getOwnPropertyNames(p).join();"],
      ["entries", "return Object.entries(p).length;"],
      ["for in", 'return (() => { let s = ""; for (const k in p) s += k; return s; })();'],
      ["spread into a literal", "return Object.keys({ ...p }).join();"],
      ["rest of a pattern", "return (() => { const { a, ...rest } = p; return a + Object.keys(rest).join(); })();"],
      ["pattern", "return (() => { const { a } = p; return a; })();"],
      ["assign from", "return Object.assign({}, p).a;"],
      ["assign to", "return Object.assign(p, { z: 1 }) === p;"],
      ["instanceof on the left", "return p instanceof Array;"],
      ["prototype asked", "return Object.getPrototypeOf(p) === Object.prototype;"],
      ["prototype set", "return Object.setPrototypeOf(p, null) === p;"],
      ["is extensible", "return Object.isExtensible(p);"],
      ["prevent extensions", "return Object.preventExtensions(p) === p;"],
      ["freeze", "return Object.isFrozen(p);"],
      ["define", 'return Object.defineProperty(p, "d", { value: 1, configurable: true }) === p;'],
      ["describe", 'return typeof Object.getOwnPropertyDescriptor(p, "a");'],
      ["has own", 'return Object.hasOwn(p, "a");'],
      ["hasOwnProperty", 'return Object.prototype.hasOwnProperty.call(p, "a");'],
      ["JSON", "return JSON.stringify(p);"],
      ["JSON of a holder", "return JSON.stringify({ inner: p });"],
      ["JSON of a list", "return JSON.stringify([p]);"],
      ["template", "return `${p}`;"],
      ["concatenation", 'return "" + p;'],
      ["arithmetic", "return +p;"],
      ["loose equality", "return p == 1;"],
      ["strict equality", "return p === 1;"],
      ["typeof", "return typeof p;"],
      ["truth", "return !p;"],
      ["String", "return String(p);"],
      ["join of a list", "return [p].join();"],
      ["below a literal", "return { __proto__: p }.a;"],
      ["below what Object.create made", "return Object.create(p).a;"],
      ["below by setPrototypeOf", "return Object.setPrototypeOf({}, p).a;"],
      ["test below a literal", 'return "a" in { __proto__: p };'],
      ["store below a literal", "return ({ __proto__: p }.a = 3);"],
      [
        "below the prototype object of a class",
        "return (() => { class C {} Object.setPrototypeOf(C.prototype, p); return new C().a; })();",
      ],
      ["super read", "return { __proto__: p, f() { return super.a; }, }.f();"],
      ["Reflect.get", 'return Reflect.get(p, "a");'],
      ["Reflect.get for another receiver", 'return Reflect.get( { get a() { return this.a2; }, }, "a", p, );'],
      ["Reflect.has", 'return Reflect.has(p, "a");'],
      ["Reflect.set", 'return Reflect.set(p, "a", 1);'],
      ["Reflect.ownKeys", "return Reflect.ownKeys(p).join();"],
      ["Reflect.set for another receiver", 'return Reflect.set({}, "a", 1, p);'],
      ["await", "return await p;"],
      ["returned by an async function", "return await (async () => p)();"],
      ["Promise.resolve", "return await Promise.resolve(p);"],
      ["resolved by an executor", "return await new Promise(r => r(p));"],
      ["then answers it", "return await Promise.resolve(1).then(() => p);"],
      ["for of", "return (() => { try { for (const x of p) return x; } catch (e) { return e.constructor.name; } })();"],
      [
        "spread into a list",
        "return (() => { try { return [...p].length; } catch (e) { return e.constructor.name; } })();",
      ],
      ["Array.from", "return Array.from(p).length;"],
      ["concat", "return [].concat(p).length;"],
      ["Array.isArray", "return Array.isArray(p);"],
      [
        "list pattern",
        "return (() => { try { const [x] = p; return x; } catch (e) { return e.constructor.name; } })();",
      ],
      [
        "yield star",
        "return (() => { try { return [ ...(function* () { yield* p; })(), ].length; } catch (e) { return e.constructor.name; } })();",
      ],
      ["key of a Map", "return new Map([[p, 1]]).get(p);"],
      ["member of a Set", "return new Set([p]).has(p);"],
      ["key of a WeakMap", "return new WeakMap([[p, 1]]).has(p);"],
      ["handed to a function that reads", "return (q => q.a)(p);"],
      ["handed to a function that stores", "return (q => (q.a = 1))(p);"],
      ["handed to a function that keeps it", "return (q => typeof [q])(p);"],
      ["kept in a field and read", "return { f: p }.f.a;"],
      ["kept in a list and read", "return [p][0].a;"],
      ["kept in a list and mapped", "return [p].map(q => q.a).join();"],
      ["this of a call", "return function () { return this.a; }.call(p);"],
      ["this of a bound function", "return function () { return this.a; }.bind(p)();"],
      ["list of apply", "return Math.max.apply(null, p);"],
      ["options of a built-in", 'return new Intl.NumberFormat("en", p).format(1);'],
      ["descriptor", 'return Object.defineProperty({}, "x", p).x;'],
      ["map of descriptors", "return Object.keys(Object.defineProperties({}, p)).length;"],
      ["second operand of Object.create", "return Object.keys(Object.create(null, p)).length;"],
      ["descriptor out of a getter", "return Object.defineProperties( {}, { get x() { return p; }, }, ).x;"],
      ["target of another proxy", "return new Proxy(p, {}).a;"],
      ["handler of another proxy", "return new Proxy({}, p).a;"],
      ["toString.call", "return Object.prototype.toString.call(p);"],
      [
        "structuredClone",
        "return (() => { try { return typeof structuredClone(p); } catch (e) { return e.constructor.name; } })();",
      ],
      ["sorted", "return [p, p].sort().length;"],
      ["includes", "return [p].includes(p);"],
      ["thrown and caught", "return (() => { try { throw p; } catch (e) { return e.a; } })();"],
      ["thrown and only compared", "return (() => { try { throw p; } catch (e) { return e === p; } })();"],
      ["cause of an error", 'return new Error("m", p).cause;'],
      ["replacer", 'return "a".replace("a", p);'],
      ["separator", 'return "a,b".split(p).length;'],
      [
        "class above",
        "return (() => { try { class D extends p {} return typeof D; } catch (e) { return e.constructor.name; } })();",
      ],
      ["called", "return (() => { try { return p(); } catch (e) { return e.constructor.name; } })();"],
      ["constructed", "return (() => { try { return new p(); } catch (e) { return e.constructor.name; } })();"],
      [
        "instanceof on the right",
        "return (() => { try { return {} instanceof p; } catch (e) { return e.constructor.name; } })();",
      ],
      ["tag", "return (() => { try { return p``; } catch (e) { return e.constructor.name; } })();"],
      ["on globalThis and read", "return ((globalThis.published = p), globalThis.published.a);"],
      ["with a key that is the proxy", "return { x: 1 }[p];"],
      ["in with a key that is the proxy", "return p in { x: 1 };"],
    ],
  },
  "stores and deletions through a proxy": {
    awaits: false,
    before: "",
    scenes: [
      [
        "a store with every trap",
        `const p = new Proxy( { a: 1 }, ${trapsThatSayWhatIsStored}, ); p.a = { mark: 7 }; return typeof p.a;`,
      ],
      [
        "a store under a computed key with every trap",
        `const p = new Proxy( { a: 1 }, ${trapsThatSayWhatIsStored}, ); p[key] = { mark: 7 }; return typeof p[key];`,
      ],
      [
        "a store without set",
        'const p = new Proxy( { a: 1 }, { get(t, k, r) { log.push("get:" + String(k)); return Reflect.get(t, k); }, has(t, k) { log.push("has:" + String(k)); return Reflect.has(t, k); }, deleteProperty(t, k) { log.push("delete:" + String(k)); return Reflect.deleteProperty(t, k); }, ownKeys(t) { log.push("ownKeys"); return Reflect.ownKeys(t); }, getOwnPropertyDescriptor(t, k) { log.push("describe:" + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); }, defineProperty(t, k, d) { log.push("define:" + String(k) + "=" + (d.value && d.value.mark)); return Reflect.defineProperty(t, k, d); }, getPrototypeOf(t) { log.push("getPrototypeOf"); return Reflect.getPrototypeOf(t); }, }, ); p.a = { mark: 7 }; return typeof p.a;',
      ],
      [
        "a store of a new name without set",
        'const p = new Proxy( { a: 1 }, { get(t, k, r) { log.push("get:" + String(k)); return Reflect.get(t, k); }, has(t, k) { log.push("has:" + String(k)); return Reflect.has(t, k); }, deleteProperty(t, k) { log.push("delete:" + String(k)); return Reflect.deleteProperty(t, k); }, ownKeys(t) { log.push("ownKeys"); return Reflect.ownKeys(t); }, getOwnPropertyDescriptor(t, k) { log.push("describe:" + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); }, defineProperty(t, k, d) { log.push("define:" + String(k) + "=" + (d.value && d.value.mark)); return Reflect.defineProperty(t, k, d); }, getPrototypeOf(t) { log.push("getPrototypeOf"); return Reflect.getPrototypeOf(t); }, }, ); p.fresh = { mark: 7 }; return typeof p.fresh;',
      ],
      [
        "a store with defineProperty alone",
        'const p = new Proxy( { a: 1 }, { defineProperty(t, k, d) { log.push("define:" + String(k) + "=" + (d.value && d.value.mark)); return Reflect.defineProperty(t, k, d); }, }, ); p.a = { mark: 7 }; return typeof p.a;',
      ],
      [
        "a store with getOwnPropertyDescriptor alone",
        'const p = new Proxy( { a: 1 }, { getOwnPropertyDescriptor(t, k) { log.push("describe:" + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); }, }, ); p.a = { mark: 7 }; return typeof p.a;',
      ],
      ["a store with no trap at all", "const p = new Proxy({ a: 1 }, {}); p.a = { mark: 7 }; return p.a.mark;"],
      [
        "a store finds a setter of the target that tests this",
        'const p = new Proxy( { set a(v) { log.push("setter " + ("z" in this)); }, }, { has(t, k) { log.push("has:" + String(k)); return Reflect.has(t, k); }, }, ); p.a = { mark: 7 }; return 1;',
      ],
      [
        "a store finds a setter of the target that stores into this",
        'const p = new Proxy( { set a(v) { this.b = v; }, }, { defineProperty(t, k, d) { log.push("define:" + String(k) + "=" + (d.value && d.value.mark)); return Reflect.defineProperty(t, k, d); }, getOwnPropertyDescriptor(t, k) { log.push("describe:" + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); }, }, ); p.a = { mark: 7 }; return typeof p.b;',
      ],
      [
        "a store finds a setter above the target",
        'const p = new Proxy( Object.create({ set a(v) { log.push("setter " + Object.keys(this).length); }, }), { ownKeys(t) { log.push("ownKeys"); return Reflect.ownKeys(t); }, }, ); p.a = { mark: 7 }; return 1;',
      ],
      [
        "the set trap stores into its receiver",
        'const p = new Proxy( { a: 1 }, { set(t, k, v, r) { log.push("set:" + String(k)); if (k === "a") r.b = v; return true; }, defineProperty(t, k, d) { log.push("define:" + String(k)); return true; }, }, ); p.a = { mark: 7 }; return 1;',
      ],
      [
        "the set trap keeps the value and it is called later",
        'const p = new Proxy( { a: 1 }, { set(t, k, v, r) { log.push("set:" + String(k)); kept = v; return true; }, }, ); p.a = () => "called"; return kept();',
      ],
      [
        "the set trap answers false in strict code",
        'const p = new Proxy( { a: 1 }, { set(t, k, v, r) { log.push("set:" + String(k)); return false; }, }, ); p.a = 1; return "not thrown";',
      ],
      [
        "a handler that gets set later",
        'const H = {}; const p = new Proxy({ a: 1 }, H); p.a = { mark: 7 }; H.set = function (t, k, v) { log.push("set:" + String(k)); return true; }; p.a = 2; return typeof p.a;',
      ],
      [
        "a handler that loses set",
        'const H2 = { set(t, k, v) { log.push("set:" + String(k)); return true; }, defineProperty(t, k, d) { log.push("define:" + String(k)); return Reflect.defineProperty(t, k, d); }, }; const p = new Proxy({ a: 1 }, H2); p.a = 1; delete H2.set; p.a = { mark: 7 }; return typeof p.a;',
      ],
      [
        "a handler whose set is put to undefined",
        'const H3 = { set(t, k, v) { log.push("set:" + String(k)); return true; }, defineProperty(t, k, d) { log.push("define:" + String(k)); return Reflect.defineProperty(t, k, d); }, }; const p = new Proxy({ a: 1 }, H3); p.a = 1; H3.set = undefined; p.a = { mark: 7 }; return typeof p.a;',
      ],
      ["a compound store", `const p = new Proxy( { a: 1 }, ${trapsThatSayWhatIsStored}, ); p.a += 1; return p.a;`],
      ["an increment", `const p = new Proxy( { a: 1 }, ${trapsThatSayWhatIsStored}, ); p.a++; return p.a;`],
      [
        "a logical store",
        `const p = new Proxy( { a: 0 }, ${trapsThatSayWhatIsStored}, ); p.a ||= 5; p.a &&= 6; p.none ??= 7; return p.a + p.none;`,
      ],
      [
        "a store by a pattern",
        `const p = new Proxy( { a: 1 }, ${trapsThatSayWhatIsStored}, ); [p.a, p.b] = [5, 6]; ({ x: p.c } = { x: 7 }); return p.a + p.b + p.c;`,
      ],
      [
        "a store by for of",
        `const p = new Proxy( { a: 1 }, ${trapsThatSayWhatIsStored}, ); for (p.a of [1, 2]); return p.a;`,
      ],
      [
        "a store by for in",
        `const p = new Proxy( { a: 1 }, ${trapsThatSayWhatIsStored}, ); for (p.a in { q: 1 }); return p.a;`,
      ],
      [
        "a deletion with every trap",
        `const p = new Proxy( { a: 1 }, ${trapsThatSayWhatIsStored}, ); return delete p.a;`,
      ],
      [
        "a deletion under a computed key with every trap",
        `const p = new Proxy( { a: 1 }, ${trapsThatSayWhatIsStored}, ); return delete p[key];`,
      ],
      [
        "a deletion without the trap",
        'const p = new Proxy( { a: 1 }, { get(t, k, r) { log.push("get:" + String(k)); return Reflect.get(t, k); }, has(t, k) { log.push("has:" + String(k)); return Reflect.has(t, k); }, set(t, k, v, r) { log.push("set:" + String(k) + "=" + (v && v.mark)); return Reflect.set(t, k, v); }, ownKeys(t) { log.push("ownKeys"); return Reflect.ownKeys(t); }, getOwnPropertyDescriptor(t, k) { log.push("describe:" + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); }, defineProperty(t, k, d) { log.push("define:" + String(k) + "=" + (d.value && d.value.mark)); return Reflect.defineProperty(t, k, d); }, getPrototypeOf(t) { log.push("getPrototypeOf"); return Reflect.getPrototypeOf(t); }, }, ); return delete p.a + " " + ("a" in p);',
      ],
      ["a deletion with no trap at all", 'const p = new Proxy({ a: 1 }, {}); return delete p.a + " " + p.a;'],
      [
        "a deletion that the trap refuses in strict code",
        'const p = new Proxy( { a: 1 }, { deleteProperty(t, k) { log.push("delete:" + String(k)); return false; }, }, ); return delete p.a;',
      ],
      [
        "a deletion of what the target cannot lose",
        "const p = new Proxy(Object.freeze({ a: 1 }), {}); return delete p.a;",
      ],
      [
        "a handler that gets deleteProperty later",
        'const H4 = {}; const T4 = { a: 1, b: 2 }; const p = new Proxy(T4, H4); const first = delete p.a; H4.deleteProperty = function (t, k) { log.push("delete:" + String(k)); return true; }; return first + " " + delete p.b + " " + Object.keys(T4).join();',
      ],
      [
        "the target is read behind a store through the proxy",
        'const T5 = { a: 1 }; const p = new Proxy(T5, { get(t, k, r) { log.push("get:" + String(k)); return Reflect.get(t, k); }, }); p.a = 5; return T5.a;',
      ],
      [
        "the target is read behind a deletion through the proxy",
        'const T6 = { a: 1 }; const p = new Proxy(T6, { get(t, k, r) { log.push("get:" + String(k)); return Reflect.get(t, k); }, }); delete p.a; return String(T6.a);',
      ],
      [
        "the target is read behind a store that the trap makes",
        "const T7 = { a: 1 }; const p = new Proxy(T7, { set(t, k, v) { t[k] = v + 1; return true; }, }); p.a = 5; return T7.a;",
      ],
    ],
  },
  "a proxy without the trap hands on to its target": {
    awaits: false,
    before: "",
    scenes: [
      [
        "the getter tests by in",
        `const p = new Proxy( { other: 5, get a() { return "z" in this; }, }, ${everyTrapButGet}, ); const answer = p.a; return kept ? answer + " " + ("k" in kept) + ((kept = undefined), "") : answer;`,
      ],
      [
        "the getter reads",
        `const p = new Proxy( { other: 5, get a() { return this.other; }, }, ${everyTrapButGet}, ); const answer = p.a; return kept ? answer + " " + ("k" in kept) + ((kept = undefined), "") : answer;`,
      ],
      [
        "the getter stores",
        `const p = new Proxy( { other: 5, get a() { return (this.w = 1); }, }, ${everyTrapButGet}, ); const answer = p.a; return kept ? answer + " " + ("k" in kept) + ((kept = undefined), "") : answer;`,
      ],
      [
        "the getter deletes",
        `const p = new Proxy( { other: 5, get a() { return delete this.d; }, }, ${everyTrapButGet}, ); const answer = p.a; return kept ? answer + " " + ("k" in kept) + ((kept = undefined), "") : answer;`,
      ],
      [
        "the getter lists the keys",
        `const p = new Proxy( { other: 5, get a() { return Object.keys(this).length; }, }, ${everyTrapButGet}, ); const answer = p.a; return kept ? answer + " " + ("k" in kept) + ((kept = undefined), "") : answer;`,
      ],
      [
        "the getter asks for the prototype",
        `const p = new Proxy( { other: 5, get a() { return Object.getPrototypeOf(this) === null; }, }, ${everyTrapButGet}, ); const answer = p.a; return kept ? answer + " " + ("k" in kept) + ((kept = undefined), "") : answer;`,
      ],
      [
        "the getter defines",
        `const p = new Proxy( { other: 5, get a() { return Object.defineProperty(this, "n", { value: 1, configurable: true }) === this; }, }, ${everyTrapButGet}, ); const answer = p.a; return kept ? answer + " " + ("k" in kept) + ((kept = undefined), "") : answer;`,
      ],
      [
        "the getter describes",
        `const p = new Proxy( { other: 5, get a() { return typeof Object.getOwnPropertyDescriptor(this, "other"); }, }, ${everyTrapButGet}, ); const answer = p.a; return kept ? answer + " " + ("k" in kept) + ((kept = undefined), "") : answer;`,
      ],
      [
        "the getter hands it to a function that tests",
        `const p = new Proxy( { other: 5, get a() { return (q => "y" in q)(this); }, }, ${everyTrapButGet}, ); const answer = p.a; return kept ? answer + " " + ("k" in kept) + ((kept = undefined), "") : answer;`,
      ],
      [
        "the getter keeps it and tests later",
        `const p = new Proxy( { other: 5, get a() { return ((kept = this), 1); }, }, ${everyTrapButGet}, ); const answer = p.a; return kept ? answer + " " + ("k" in kept) + ((kept = undefined), "") : answer;`,
      ],
      [
        "a handler that gets its trap later, and the getter tests by in",
        `const handler = ${everyTrapButGet}; const p = new Proxy( { other: 5, get a() { return "z" in this; }, }, handler, ); const first = p.a; handler.get = function (t, k, r) { log.push("get:" + String(k)); return 9; }; const answer = first + " " + p.a; return kept ? answer + " " + ("k" in kept) + ((kept = undefined), "") : answer;`,
      ],
      [
        "a handler that gets its trap later, and the getter reads",
        `const handler = ${everyTrapButGet}; const p = new Proxy( { other: 5, get a() { return this.other; }, }, handler, ); const first = p.a; handler.get = function (t, k, r) { log.push("get:" + String(k)); return 9; }; const answer = first + " " + p.a; return kept ? answer + " " + ("k" in kept) + ((kept = undefined), "") : answer;`,
      ],
      [
        "a handler that gets its trap later, and the getter stores",
        `const handler = ${everyTrapButGet}; const p = new Proxy( { other: 5, get a() { return (this.w = 1); }, }, handler, ); const first = p.a; handler.get = function (t, k, r) { log.push("get:" + String(k)); return 9; }; const answer = first + " " + p.a; return kept ? answer + " " + ("k" in kept) + ((kept = undefined), "") : answer;`,
      ],
      [
        "a handler that gets its trap later, and the getter deletes",
        `const handler = ${everyTrapButGet}; const p = new Proxy( { other: 5, get a() { return delete this.d; }, }, handler, ); const first = p.a; handler.get = function (t, k, r) { log.push("get:" + String(k)); return 9; }; const answer = first + " " + p.a; return kept ? answer + " " + ("k" in kept) + ((kept = undefined), "") : answer;`,
      ],
      [
        "a handler that gets its trap later, and the getter lists the keys",
        `const handler = ${everyTrapButGet}; const p = new Proxy( { other: 5, get a() { return Object.keys(this).length; }, }, handler, ); const first = p.a; handler.get = function (t, k, r) { log.push("get:" + String(k)); return 9; }; const answer = first + " " + p.a; return kept ? answer + " " + ("k" in kept) + ((kept = undefined), "") : answer;`,
      ],
      [
        "a handler that gets its trap later, and the getter asks for the prototype",
        `const handler = ${everyTrapButGet}; const p = new Proxy( { other: 5, get a() { return Object.getPrototypeOf(this) === null; }, }, handler, ); const first = p.a; handler.get = function (t, k, r) { log.push("get:" + String(k)); return 9; }; const answer = first + " " + p.a; return kept ? answer + " " + ("k" in kept) + ((kept = undefined), "") : answer;`,
      ],
      [
        "a handler that gets its trap later, and the getter defines",
        `const handler = ${everyTrapButGet}; const p = new Proxy( { other: 5, get a() { return Object.defineProperty(this, "n", { value: 1, configurable: true }) === this; }, }, handler, ); const first = p.a; handler.get = function (t, k, r) { log.push("get:" + String(k)); return 9; }; const answer = first + " " + p.a; return kept ? answer + " " + ("k" in kept) + ((kept = undefined), "") : answer;`,
      ],
      [
        "a handler that gets its trap later, and the getter describes",
        `const handler = ${everyTrapButGet}; const p = new Proxy( { other: 5, get a() { return typeof Object.getOwnPropertyDescriptor(this, "other"); }, }, handler, ); const first = p.a; handler.get = function (t, k, r) { log.push("get:" + String(k)); return 9; }; const answer = first + " " + p.a; return kept ? answer + " " + ("k" in kept) + ((kept = undefined), "") : answer;`,
      ],
      [
        "a handler that gets its trap later, and the getter hands it to a function that tests",
        `const handler = ${everyTrapButGet}; const p = new Proxy( { other: 5, get a() { return (q => "y" in q)(this); }, }, handler, ); const first = p.a; handler.get = function (t, k, r) { log.push("get:" + String(k)); return 9; }; const answer = first + " " + p.a; return kept ? answer + " " + ("k" in kept) + ((kept = undefined), "") : answer;`,
      ],
      [
        "a handler that gets its trap later, and the getter keeps it and tests later",
        `const handler = ${everyTrapButGet}; const p = new Proxy( { other: 5, get a() { return ((kept = this), 1); }, }, handler, ); const first = p.a; handler.get = function (t, k, r) { log.push("get:" + String(k)); return 9; }; const answer = first + " " + p.a; return kept ? answer + " " + ("k" in kept) + ((kept = undefined), "") : answer;`,
      ],
      [
        "the getter lies above the target",
        'const p = new Proxy( Object.create({ get a() { return "z" in this; }, }), { has(t, k) { log.push("has:" + String(k)); return true; }, }, ); return p.a;',
      ],
      [
        "the read is under a computed key",
        'const p = new Proxy( { get a() { return "z" in this; }, }, { has(t, k) { log.push("has:" + String(k)); return true; }, }, ); return p[process.argv.length > 99 ? "b" : "a"];',
      ],
      [
        "the trap hands the read on for its receiver",
        'const p = new Proxy( { get a() { return "z" in this; }, }, { get(t, k, r) { log.push("get:" + String(k)); return Reflect.get(t, k, r); }, has(t, k) { log.push("has:" + String(k)); return true; }, }, ); return p.a;',
      ],
      [
        "the trap stores into its receiver",
        'const stored = { mark: 1 }; const p = new Proxy( {}, { get(t, k, r) { log.push("get:" + String(k)); r.w = stored; return 1; }, set(t, k, v, r) { log.push("set:" + String(k) + ":" + v.mark); return true; }, }, ); return p.a;',
      ],
    ],
  },
  "what a read through a proxy answers, and reads nobody uses": {
    awaits: false,
    before: "",
    scenes: [
      [
        "a read nobody uses",
        'const p = new Proxy( { a: 1 }, { get(t, k) { log.push("get:" + String(k)); return 1; }, }, ); p.a; return "done";',
      ],
      [
        "a test nobody uses",
        'const p = new Proxy( { a: 1 }, { has(t, k) { log.push("has:" + String(k)); return true; }, }, ); "a" in p; return "done";',
      ],
      [
        "a read nobody uses in a loop",
        'const p = new Proxy( { a: 1 }, { get(t, k) { log.push("get:" + String(k)); return 1; }, }, ); for (let i = 0; i < 3; i++) p.a; return "done";',
      ],
      [
        "two reads of one name are two calls",
        'let n = 0; const p = new Proxy( { a: 1 }, { get(t, k) { return ++n; }, }, ); return p.a + " " + p.a;',
      ],
      [
        "the trap answers another kind than the target holds",
        'const p = new Proxy( { a: 1 }, { get(t, k) { return "text of " + String(k); }, }, ); return p.a.toUpperCase();',
      ],
      [
        "the trap answers an object of the program",
        "const made = { deep: { deeper: 5 } }; const p = new Proxy( { a: 1 }, { get(t, k) { return made; }, }, ); return p.a.deep.deeper + p.none.deep.deeper;",
      ],
      [
        "the trap answers a function that is called",
        "const p = new Proxy( {}, { get(t, k) { return x => String(k) + x; }, }, ); return p.a(1) + p.b(2);",
      ],
      [
        "the trap answers the proxy",
        "const p = new Proxy( {}, { get(t, k, r) { log.push(String(k)); return r; }, }, ); return p.a.b.c === p;",
      ],
      [
        "the trap answers undefined for some names",
        'const p = new Proxy( { a: 1 }, { get(t, k) { return k === "a" ? t.a : undefined; }, }, ); return typeof p.a + " " + typeof p.b + " " + (p.b ?? "none");',
      ],
      [
        "the trap throws",
        'const p = new Proxy( { a: 1 }, { get(t, k) { throw new RangeError("no " + String(k)); }, }, ); try { return p.a; } catch (e) { return e.message; }',
      ],
      [
        "without the trap the target answers",
        "const p = new Proxy({ a: 1, deep: { deeper: 5 } }, {}); return p.a + p.deep.deeper + String(p.none);",
      ],
      [
        "without the trap what stands above the target answers",
        'const p = new Proxy(Object.create({ above: "yes" }), {}); return p.above + " " + typeof p.toString + " " + ("above" in p) + " " + ("none" in p);',
      ],
      [
        "has answers otherwise than the target",
        'const p = new Proxy( { a: 1 }, { has(t, k) { return k !== "a"; }, }, ); return ("a" in p) + " " + ("b" in p);',
      ],
      [
        "what has answers is made a boolean",
        'const p = new Proxy( {}, { has(t, k) { return "text"; }, }, ); return "a" in p === true;',
      ],
      [
        "the answer is held against a target that cannot change",
        "const p = new Proxy(Object.freeze({ a: 1 }), { get(t, k) { return 2; }, }); return p.a;",
      ],
      [
        "a proxy is compared and asked for its kind",
        'const t = { a: 1 }; const p = new Proxy(t, { get(x, k) { log.push("get"); return 1; }, }); return (p === t) + " " + (p === p) + " " + typeof p + " " + !!p + " " + (p == null);',
      ],
      [
        "two proxies come to one read",
        'const a = new Proxy( {}, { get(t, k) { return "first"; }, }, ); const b = new Proxy( {}, { get(t, k) { return 2; }, }, ); let s = ""; for (const p of [a, b]) s += typeof p.x; return s;',
      ],
      [
        "a proxy and an object come to one read",
        'const a = new Proxy( {}, { get(t, k) { return "trap"; }, }, ); let s = ""; for (const p of [a, { x: 5 }, { y: 1 }]) s += String(p.x); return s;',
      ],
      [
        "a number read through a proxy is counted with",
        "const p = new Proxy( { n: 2 ** 31 }, { get(t, k) { return t[k] + 0.5; }, }, ); return p.n + 1;",
      ],
      [
        "a handler of a class",
        "class Handler { constructor() { this.reads = 0; } get(t, k) { this.reads++; return t[k]; } } const h = new Handler(); const p = new Proxy({ a: 1 }, h); return p.a + p.a + h.reads;",
      ],
      [
        "a handler whose trap is replaced",
        'const h = { get(t, k) { return "first"; }, }; const p = new Proxy({}, h); const one = p.a; h.get = (t, k) => 2; return one + typeof p.a;',
      ],
      [
        "a proxy that is opened behind its reads",
        'const p = new Proxy( { a: 1 }, { get(t, k) { return "read"; }, ownKeys(t) { log.push("ownKeys"); return []; }, }, ); const one = p.a; return one + Object.keys(p).length + p.a;',
      ],
    ],
  },
  "what is called hands back a proxy": {
    awaits: true,
    before: `const p = new Proxy( { a: 1 }, ${everyTrap}, );`,
    scenes: [
      ["toJSON answers it", "return JSON.stringify({ toJSON() { return p; }, });"],
      ["a replacer answers it", 'return JSON.stringify({ x: 1 }, (k, v) => (k === "x" ? p : v));'],
      ["a reviver answers it", 'return typeof JSON.parse(\'{"x":1}\', (k, v) => (k === "x" ? p : v)).x;'],
      [
        "valueOf answers it",
        "return (() => { try { return +{ valueOf() { return p; }, toString() { return p; }, }; } catch (e) { return e.constructor.name; } })();",
      ],
      [
        "Symbol.toPrimitive answers it",
        "return (() => { try { return `${{ [Symbol.toPrimitive]() { return p; }, }}`; } catch (e) { return e.constructor.name; } })();",
      ],
      [
        "Symbol.iterator answers it",
        "return (() => { try { return [ ...{ [Symbol.iterator]() { return p; }, }, ].length; } catch (e) { return e.constructor.name; } })();",
      ],
      [
        "next answers it",
        "return (() => { try { let n = 0; for (const x of { [Symbol.iterator]() { return { next() { return p; }, }; }, }) if (++n > 2) break; return n; } catch (e) { return e.constructor.name; } })();",
      ],
      ["a comparator answers it", "return [2, 1].sort(() => p).length;"],
      ["a replacer function of a string answers it", 'return "x".replace("x", () => p);'],
      ["a mapper answers it", "return [1].map(() => p)[0] === p;"],
      ["a mapper of flatMap answers it", "return [1].flatMap(() => p).length;"],
      ["a mapper of Array.from answers it", "return Array.from({ length: 1 }, () => p)[0] === p;"],
      ["a predicate answers it", "return [1].filter(() => p).length;"],
      ["a reducer answers it", "return [1, 2].reduce(() => p) === p;"],
      [
        "a getter of an assigned source answers it",
        "return ( Object.assign( {}, { get x() { return p; }, }, ).x === p );",
      ],
      ["a getter of a spread source answers it", "return ( { ...{ get x() { return p; }, }, }.x === p );"],
      [
        "a getter of a descriptor answers it",
        'return ( Object.defineProperty({}, "x", { get value() { return p; }, }).x === p );',
      ],
      [
        "a getter of a descriptor answers it for get",
        'return (() => { try { return typeof Object.defineProperty({}, "x", { get get() { return p; }, }); } catch (e) { return e.constructor.name; } })();',
      ],
      ["then hands it on", "return ( (await { then(resolve) { resolve(p); }, }) === p );"],
      ["a handler of then answers it", "return (await Promise.resolve(1).then(() => p)) === p;"],
      ["a handler of catch answers it", "return (await Promise.reject(1).catch(() => p)) === p;"],
      ["finally answers it", "return await Promise.resolve(1).finally(() => p);"],
      [
        "a constructor under Symbol.species answers it",
        "return (() => { try { class A extends Array { static get [Symbol.species]() { return function () { return p; }; } } return typeof new A(1, 2).map(x => x); } catch (e) { return e.constructor.name; } })();",
      ],
      ["a constructor answers it", "return ( new (function () { return p; })() === p );"],
      [
        "a class constructor below another answers it",
        "return (() => { class B { constructor() { return p; } } class D extends B { constructor() { super(); this.mark = 1; } } return new D() === p; })();",
      ],
      [
        "a field is defined on it behind super",
        "return (() => { class B { constructor() { return p; } } class D extends B { field = 1; } return new D() === p; })();",
      ],
      [
        "a trap of another proxy answers it as the prototype",
        "return ( Object.getPrototypeOf( new Proxy( {}, { getPrototypeOf() { return p; }, }, ), ) === p );",
      ],
      [
        "a trap of another proxy answers it as the prototype and instanceof walks on",
        "return ( new Proxy( {}, { getPrototypeOf() { return p; }, }, ) instanceof Array );",
      ],
      ["a trap of another proxy answers it for a read", "return new Proxy( {}, { get() { return p; }, }, ).x.a;"],
      [
        "a trap of another proxy answers it as a descriptor",
        'return (() => { try { return typeof Object.getOwnPropertyDescriptor( new Proxy( {}, { getOwnPropertyDescriptor() { return p; }, }, ), "x", ); } catch (e) { return e.constructor.name; } })();',
      ],
      [
        "a trap of another proxy answers it as the keys",
        "return (() => { try { return Object.keys( new Proxy( {}, { ownKeys() { return p; }, }, ), ).length; } catch (e) { return e.constructor.name; } })();",
      ],
      ["Symbol.hasInstance gets it", "return ( p instanceof { [Symbol.hasInstance](x) { return x === p; }, } );"],
      ["a tag function gets it", "return ((s, x) => x === p)`${p}`;"],
      ["a generator returns it", "return ( (function* () { return p; })().next().value === p );"],
      [
        "an async generator returns it",
        "return ( ( await (async function* () { return p; })().next() ).value === p );",
      ],
      [
        "a key function of groupBy answers it",
        "return (() => { try { return Object.keys(Object.groupBy([1], () => p)).length; } catch (e) { return e.constructor.name; } })();",
      ],
      ["a key function of Map.groupBy answers it", "return Map.groupBy([1], () => p).has(p);"],
    ],
  },
};
for (const [standing, made] of waysToStandBelow) {
  programs[`one thing is done to ${standing} below a proxy`] = {
    awaits: true,
    before: `const p = new Proxy({ a: 1, m() { return 7; } }, ${everyTrap}); ${made}`,
    scenes: doneToAnObjectBelow,
  };
}

function textOf({ awaits, before, scenes }: Program) {
  const [asynchronous, waits] = awaits ? ["async ", "await "] : ["", ""];
  return `
const key = process.argv.length > 99 ? "b" : "a";
class Named {}
let kept;
const lines = [];
${asynchronous}function scene(name, run) {
  const log = [];
  let answer;
  try {
    answer = ${waits}run(log);
  } catch (e) {
    answer = "threw " + e.constructor.name;
  }
  lines.push(name + ": " + (typeof answer === "object" && answer !== null ? "an object" : String(answer)) + " | " + log.join(" "));
}
${scenes.map(([name, does]) => `${waits}scene(${JSON.stringify(name)}, ${asynchronous}log => { ${before} ${does} });`).join("\n")}
console.log(lines.join("\\n"));
`;
}

for (const [name, program] of Object.entries(programs)) {
  test.concurrent(
    name,
    async () => {
      using dir = tempDir("aot-done-to-a-proxy", { "main.mjs": textOf(program) });
      const folder = String(dir);
      const executable = join(folder, isWindows ? "main.exe" : "main");
      await slot(async () => {
        built(
          await spawned(
            [bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", executable],
            folder,
            bunEnv,
          ),
        );
        const plain = told(await spawned([bunExe(), "./main.mjs"], folder, bunEnv));
        expect(plain.stdout.trim().split("\n").length).toBe(program.scenes.length);
        expect(told(await spawned([executable], folder, bunEnv))).toEqual(plain);
      });
    },
    240_000,
  );
}
