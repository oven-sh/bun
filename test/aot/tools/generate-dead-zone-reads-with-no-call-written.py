#!/usr/bin/env python3
# Writes ../parallel/dead-zone-read-with-no-call-written/: ONE DEED A PROGRAM. In each, code of the program runs where no call is written (a getter, a setter, a trap, a conversion, an iterator, a thenable ..)
# and reads a `const` of the module in front of its store: a ReferenceError, then, behind the store, the value. With twenty deeds in one program a fault of this kind hid entirely.
# To add a deed: a line in `cases`: what is declared in front, and `function deed()`.
import os

folder = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'parallel', 'dead-zone-read-with-no-call-written')
head = 'function attempt(deed) { try { return deed(); } catch (error) { return error.name; } }\n'
tail = 'const before = attempt(deed);\nconst late = { rate: 0.2 };\nconsole.log(before, attempt(deed));\n'
getter = 'const early = { get rate() { return late.rate; } };\n'
cases = {
    'getter-in-a-literal': getter + 'function deed() { return early.rate; }\n',
    'setter-in-a-literal': 'let seen;\nconst early = { set rate(value) { seen = late.rate + value; } };\nfunction deed() { early.rate = 1; return seen; }\n',
    'getter-by-define-property': 'const early = {};\nObject.defineProperty(early, "rate", { get() { return late.rate; }, configurable: true });\nfunction deed() { return early.rate; }\n',
    'getter-by-define-property-on-a-field': 'const early = { rate: 1 };\nObject.defineProperty(early, "rate", { get() { return late.rate; }, configurable: true });\nfunction deed() { return early.rate; }\n',
    'setter-by-define-property': 'let seen;\nconst early = {};\nObject.defineProperty(early, "rate", { set(value) { seen = late.rate + value; }, configurable: true });\nfunction deed() { early.rate = 1; return seen; }\n',
    'getter-by-define-properties': 'const early = {};\nObject.defineProperties(early, { rate: { get() { return late.rate; } } });\nfunction deed() { return early.rate; }\n',
    'getter-by-object-create': 'const early = Object.create(null, { rate: { get() { return late.rate; } } });\nfunction deed() { return early.rate; }\n',
    'getter-by-reflect-define-property': 'const early = {};\nReflect.defineProperty(early, "rate", { get() { return late.rate; } });\nfunction deed() { return early.rate; }\n',
    'getter-by-define-getter': 'const early = {};\nearly.__defineGetter__("rate", function () { return late.rate; });\nfunction deed() { return early.rate; }\n',
    'getter-in-a-class': 'class Early { get rate() { return late.rate; } }\nconst early = new Early();\nfunction deed() { return early.rate; }\n',
    'setter-in-a-class': 'let seen;\nclass Early { set rate(value) { seen = late.rate + value; } }\nconst early = new Early();\nfunction deed() { early.rate = 1; return seen; }\n',
    'static-getter-in-a-class': 'class Early { static get rate() { return late.rate; } }\nfunction deed() { return Early.rate; }\n',
    'static-setter-in-a-class': 'let seen;\nclass Early { static set rate(value) { seen = late.rate + value; } }\nfunction deed() { Early.rate = 1; return seen; }\n',
    'getter-on-a-prototype-object': 'function Early() {}\nObject.defineProperty(Early.prototype, "rate", { get() { return late.rate; } });\nconst early = new Early();\nfunction deed() { return early.rate; }\n',
    'getter-in-a-literal-that-is-a-prototype': 'const above = { get rate() { return late.rate; } };\nconst early = Object.create(above);\nfunction deed() { return early.rate; }\n',
    'getter-in-a-literal-under-proto': 'const early = { __proto__: { get rate() { return late.rate; } } };\nfunction deed() { return early.rate; }\n',
    'getter-read-by-a-pattern': getter + 'function deed() { const { rate } = early; return rate; }\n',
    'getter-read-by-a-computed-key': getter + 'const key = ["ra", "te"].join("");\nfunction deed() { return early[key]; }\n',
    'getter-read-by-a-spread': getter + 'function deed() { return { ...early }.rate; }\n',
    'getter-read-by-object-assign': getter + 'function deed() { return Object.assign({}, early).rate; }\n',
    'getter-read-by-json-stringify': getter + 'function deed() { return JSON.stringify(early); }\n',
    'getter-read-by-object-values': getter + 'function deed() { return Object.values(early)[0]; }\n',
    'getter-read-by-object-entries': getter + 'function deed() { return Object.entries(early)[0][1]; }\n',
    'getter-read-by-reflect-get': getter + 'function deed() { return Reflect.get(early, "rate"); }\n',
    'getter-read-by-a-rest-pattern': 'const early = { other: 1, get rate() { return late.rate; } };\nfunction deed() { const { other, ...rest } = early; return rest.rate; }\n',
    'getter-read-by-structured-clone': getter + 'function deed() { return structuredClone(early).rate; }\n',
    'getter-read-by-an-optional-chain': getter + 'function deed() { return early?.rate; }\n',
    'getter-called-as-a-method': 'const early = { get rate() { return () => late.rate; } };\nfunction deed() { return early.rate(); }\n',
    'proxy-get-trap': 'const early = new Proxy({}, { get() { return late.rate; } });\nfunction deed() { return early.rate; }\n',
    'proxy-has-trap': 'const early = new Proxy({}, { has() { return late.rate > 0; } });\nfunction deed() { return "rate" in early; }\n',
    'proxy-set-trap': 'let seen;\nconst early = new Proxy({}, { set(target, key, value) { seen = late.rate + value; return true; } });\nfunction deed() { early.rate = 1; return seen; }\n',
    'proxy-own-keys-trap': 'const early = new Proxy({}, { ownKeys() { return [String(late.rate)]; }, getOwnPropertyDescriptor() { return { value: 1, enumerable: true, configurable: true }; } });\nfunction deed() { return Object.keys(early)[0]; }\n',
    'to-primitive-by-an-operator': 'const early = { [Symbol.toPrimitive]() { return late.rate; } };\nfunction deed() { return early + 1; }\n',
    'value-of-by-an-operator': 'const early = { valueOf() { return late.rate; } };\nfunction deed() { return early * 2; }\n',
    'value-of-by-a-comparison': 'const early = { valueOf() { return late.rate; } };\nfunction deed() { return early < 1; }\n',
    'to-string-by-a-template': 'const early = { toString() { return "r" + late.rate; } };\nfunction deed() { return `${early}`; }\n',
    'to-string-by-a-concatenation': 'const early = { toString() { return "r" + late.rate; } };\nfunction deed() { return "" + early; }\n',
    'to-string-by-a-computed-key': 'const early = { toString() { return "r" + late.rate; } };\nfunction deed() { return Object.keys({ [early]: 1 })[0]; }\n',
    'to-string-by-a-join': 'const early = { toString() { return "r" + late.rate; } };\nfunction deed() { return [early].join(); }\n',
    'to-json-by-stringify': 'const early = { toJSON() { return late.rate; } };\nfunction deed() { return JSON.stringify(early); }\n',
    'iterator-next-by-for-of': 'const early = { [Symbol.iterator]() { return { next() { return { done: false, value: late.rate }; } }; } };\nfunction deed() { for (const value of early) return value; }\n',
    'iterator-by-a-spread': 'const early = { [Symbol.iterator]() { let turn = 0; return { next() { return { done: turn++ > 0, value: late.rate }; } }; } };\nfunction deed() { return [...early][0]; }\n',
    'iterator-by-a-list-pattern': 'const early = { [Symbol.iterator]() { return { next() { return { done: false, value: late.rate }; } }; } };\nfunction deed() { const [first] = early; return first; }\n',
    'iterator-return-by-a-break': 'const early = { [Symbol.iterator]() { return { next() { return { done: false, value: 1 }; }, return() { late.rate; return {}; } }; } };\nfunction deed() { for (const value of early) break; return "left"; }\n',
    'generator-by-for-of': 'function* early() { yield late.rate; }\nfunction deed() { for (const value of early()) return value; }\n',
    'tagged-template': 'function early(strings) { return late.rate; }\nfunction deed() { return early`text`; }\n',
    'has-instance-by-instanceof': 'const early = { [Symbol.hasInstance]() { return late.rate > 0; } };\nfunction deed() { return ({}) instanceof early; }\n',
    'species-by-map': 'class Early extends Array { static get [Symbol.species]() { late.rate; return Array; } }\nconst early = new Early(1);\nfunction deed() { return early.map(x => x).length; }\n',
    'callback-of-sort': 'const early = [2, 1];\nfunction deed() { return early.slice().sort((a, b) => a - b + 0 * late.rate)[0]; }\n',
    'callback-of-a-replace': 'function deed() { return "a".replace("a", () => String(late.rate)); }\n',
    'field-initializer-of-a-class': 'class Early { rate = late.rate; }\nfunction deed() { return new Early().rate; }\n',
    'static-block-read-later': 'class Early { static read() { return late.rate; } }\nfunction deed() { return Early.read(); }\n',
    'default-of-a-parameter': 'function early(rate = late.rate) { return rate; }\nfunction deed() { return early(); }\n',
    'default-in-a-pattern': 'function deed() { const { rate = late.rate } = {}; return rate; }\n',
    'computed-key-of-a-class': 'function deed() { class Early { [late.rate]() {} } return Object.getOwnPropertyNames(Early.prototype)[1]; }\n',
    'bound-function': 'const early = function () { return late.rate; }.bind(null);\nfunction deed() { return early(); }\n',
    'function-by-call': 'function early() { return late.rate; }\nfunction deed() { return early.call(null); }\n',
    'function-by-apply': 'function early() { return late.rate; }\nfunction deed() { return early.apply(null, []); }\n',
    'function-by-reflect-apply': 'function early() { return late.rate; }\nfunction deed() { return Reflect.apply(early, null, []); }\n',
    'constructor-by-reflect-construct': 'function Early() { this.rate = late.rate; }\nfunction deed() { return Reflect.construct(Early, []).rate; }\n',
    'function-out-of-a-list': 'const early = [function () { return late.rate; }];\nfunction deed() { return early[0](); }\n',
    'function-out-of-a-map': 'const early = new Map([["rate", function () { return late.rate; }]]);\nfunction deed() { return early.get("rate")(); }\n',
    'super-getter': 'class Above { get rate() { return late.rate; } }\nclass Early extends Above { read() { return super.rate; } }\nconst early = new Early();\nfunction deed() { return early.read(); }\n',
    'private-getter': 'class Early { get #rate() { return late.rate; } read() { return this.#rate; } }\nconst early = new Early();\nfunction deed() { return early.read(); }\n',
    'getter-on-the-global-object-read-as-a-free-name': 'Object.defineProperty(globalThis, "earlyRate", { get() { return late.rate; }, configurable: true });\nfunction deed() { return earlyRate; }\n',
}
whole = {
    'getter-in-a-literal-reads-a-let.js': head + getter + 'function deed() { return early.rate; }\nconst before = attempt(deed);\nlet late = { rate: 0.2 };\nconsole.log(before, attempt(deed));\n',
    'getter-in-a-literal-reads-a-class.js': head + 'const early = { get rate() { return Late.rate; } };\nfunction deed() { return early.rate; }\nconst before = attempt(deed);\nclass Late { static rate = 0.2; }\nconsole.log(before, attempt(deed));\n',
    'getter-in-a-literal-reads-a-number.js': head + 'const early = { get rate() { return late; } };\nfunction deed() { return early.rate; }\nconst before = attempt(deed);\nconst late = 0.2;\nconsole.log(before, attempt(deed));\n',
    'thenable-by-await.mjs': 'const early = { then(resolve) { resolve(late.rate); } };\nasync function deed() { try { return await early; } catch (error) { return error.name; } }\nconst before = await deed();\nconst late = { rate: 0.2 };\nconsole.log(before, await deed());\n',
    'thenable-by-promise-resolve.mjs': 'const early = { then(resolve) { resolve(late.rate); } };\nfunction deed() { return Promise.resolve(early).catch(error => error.name); }\nconst first = deed();\nconst late = { rate: 0.2 };\nconsole.log(await first, await deed());\n',
    'async-iterator-by-for-await.mjs': 'const early = { [Symbol.asyncIterator]() { return { next() { return Promise.resolve({ done: false, value: late.rate }); } }; } };\nasync function deed() { try { for await (const value of early) return value; } catch (error) { return error.name; } }\nconst before = await deed();\nconst late = { rate: 0.2 };\nconsole.log(before, await deed());\n',
}
os.makedirs(folder, exist_ok=True)
for name, text in cases.items():
    open(os.path.join(folder, name + '.js'), 'w').write(head + text + tail)
for name, text in whole.items():
    open(os.path.join(folder, name), 'w').write(text)
print(len(cases) + len(whole), 'programs in', os.path.normpath(folder))
