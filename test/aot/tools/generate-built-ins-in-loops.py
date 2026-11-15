#!/usr/bin/env python3
# Writes the two programs in which each function of Math, each operator on numbers and each built-in that has code in line stands in a small counted loop, and what it gives comes round the loop:
#   ../parallel/numbers/what-math-and-operators-make-of-fractions-that-fold-comes-round-a-loop.ts
#   ../parallel/builtins/what-a-built-in-with-code-in-line-gives-comes-round-a-loop.ts
# Before a loop is compiled each value in it is typed once ahead, from the operations as they are written. The code that is then built may fold `d / 3` to a number, call a built-in by its row or put its code in line:
# whatever it builds has to lie within what was said ahead, or the build stops. `b = Math.trunc(d / 3)` with d = 7 stopped it.
#   python3 test/aot/tools/generate-built-ins-in-loops.py
import os, re

unary = "abs acos acosh asin asinh atan atanh cbrt ceil clz32 cos cosh exp expm1 f16round floor fround log log10 log1p log2 round sign sin sinh sqrt tan tanh trunc".split()
ruled = {"abs", "ceil", "floor", "round", "sign", "trunc", "min", "max"}
operands = ["d / 3", "e / 3", "d", "e", "i", "i / 2", "-i / 2", "b", "y", "y / 2", "0.5", "-0.5", "d * 0.5", "NaN", "1e300", "-0", "d % 3", "i - 2", "d / 3 + i", "(d / 3) | 0", "2.5 - d / 2", "Infinity", "-d / 7"]
pairs = [("d / 3", "i"), ("i", "d / 3"), ("b", "i"), ("e / 3", "0.5"), ("d", "e"), ("y", "i / 2"), ("d / 3", "e / 3"), ("-0", "0"), ("NaN", "d / 3"), ("i / 2", "i")]

def numbers():
    out = []
    for f in unary:
        out += [(f"Math.{f}({x})", f in ruled) for x in operands]
    for f in "atan2 imul max min pow hypot".split():
        out += [(f"Math.{f}({a}, {c})", f in ruled) for a, c in pairs]
    for f in "max min hypot".split():
        out += [(x, f in ruled) for x in (f"Math.{f}()", f"Math.{f}(d / 3)", f"Math.{f}(d / 3, i, e / 3)", f"Math.{f}(d / 3, i, e / 3, b)", f"Math.{f}(...[d / 3, i])")]
    for x in operands:
        out += [(t, False) for t in (f"Number({x})", f"+({x})", f"-({x})", f"({x}) + 1", f"({x}) - 0.5", f"({x}) * 2", f"({x}) / 2", f"({x}) % 2", f"({x}) ** 2", f"~({x})", f"({x}) >>> 0", f"({x}) | 0")]
    return out

giveNumbers = ["parseInt('12px')", "parseInt(String(d / 3))", "parseFloat('2.5')", "Number('2.5')", "Number.parseFloat('0.25')", "s.length", "s.charCodeAt(i)", "s.charCodeAt(d / 3)", "s.charCodeAt(e)", "s.codePointAt(i) ?? -1", "s.indexOf('l')", "s.indexOf('l', d / 3)", "s.lastIndexOf('l')", "s.lastIndexOf('l', d / 3)", "s.search(/l/)", "s.localeCompare('h')",
    "a.length", "a.indexOf(2.5)", "a.indexOf(d / 2)", "a.push(d / 3)", "a.unshift(d / 3)", "a.at(i) ?? -1", "a.at(d / 3) ?? -1", "a.at(-1) ?? -1", "a.pop() ?? -1", "a.shift() ?? -1", "Math.max(...a)", "Math.min(...a)", "Math.max.apply(null, a)",
    "u.length", "u.byteLength", "u.byteOffset", "u[i] ?? -1", "f64[i] ?? -1", "f64[0] / 3", "u.at(i) ?? -1",
    "m.size", "m.get(1) ?? -1", "m.get(d / 2) ?? -1", "st.size", "view.getFloat64(0)", "view.getInt8(i)", "view.getUint32(0)", "view.byteLength", "buffer.byteLength",
    "date.getTime()", "date.getUTCFullYear()", "date.getUTCMonth()", "date.getUTCDate()", "date.getUTCDay()", "date.getUTCHours()", "date.getUTCMinutes()", "date.getUTCSeconds()", "date.getUTCMilliseconds()", "date.setTime(d / 3)", "re.lastIndex",
    "Atomics.load(i32, 0)", "Atomics.add(i32, 0, d / 3)", "Atomics.store(i32, 0, d / 3)", "Atomics.exchange(i32, 0, 2)", "Atomics.compareExchange(i32, 0, 2, 3)", "Atomics.or(i32, 0, 1)", "Atomics.and(i32, 0, 3)", "Atomics.sub(i32, 0, 1)", "Atomics.xor(i32, 0, 1)",
    "node.readUInt8(i)", "node.readInt16LE(0)", "node.readDoubleLE(0)", "node.readFloatBE(0)", "node.writeUInt8(d, 0)", "node.writeDoubleLE(d / 3, 0)", "node.length", "Buffer.byteLength(s)"]
giveAnything = ["isNaN(d / 3)", "isFinite(d / 3)", "Number.isNaN(d / 3)", "Number.isFinite(d / 3)", "Number.isInteger(d / 3)", "Number.isInteger(i)", "Number.isSafeInteger(d / 3)", "Number.isSafeInteger(b)", "Object.is(d / 3, b)", "Object.is(-0, 0)",
    "(d / 3).toString()", "(d / 3).toFixed(2)", "(i).toString(2)", "String(d / 3)", "String(i)", "`${d / 3}`", "'' + d / 3",
    "s.at(i)", "s.at(d / 3)", "s.at(e)", "s.charAt(i)", "s.charAt(d / 3)", "s.slice(i)", "s.slice(d / 3)", "s.slice(e / 3)", "s.slice(1, d / 3)", "s.substring(i)", "s.substring(d / 3, e)", "s.substr(i, 2)", "s.substr(d / 3)", "s.startsWith('h')", "s.startsWith('e', d / 7)", "s.endsWith('d')", "s.includes('l')", "s.includes('l', d / 3)",
    "s.toLowerCase()", "s.toUpperCase()", "s.trim()", "s.trimStart()", "s.trimEnd()", "s.concat('x')", "s.concat(d / 3)", "String.fromCharCode(65 + i)", "String.fromCharCode(65.5)", "String.fromCharCode(d / 3 + 64)", "String.fromCodePoint(65 + i)", "s.repeat(i)", "s.repeat(d / 3)", "s.padStart(d * 2)", "s.padEnd(d * 2.5, '.')", "s.isWellFormed()", "s.toWellFormed()", "s.normalize()",
    "s.split('l')", "s.split('l', d / 3)", "s.split(/l/)", "s.replace('l', 'L')", "s.replace(/l/, 'L')", "s.replaceAll('l', 'L')", "s.replaceAll(/l/g, 'L')", "s.match(/l+/)", "s.match(/z/)", "re.exec(s)", "re.test(s)", "re.flags", "re.source", "re.global", "new RegExp('a' + i)",
    "a.includes(2.5)", "a.includes(d / 2)", "a.join()", "a.join('-')", "a.concat([d / 3])", "a.slice(i)", "a.slice(d / 3)", "a.splice(0, 1)", "a.splice(d / 3)", "a.with(0, d / 3)", "a.toReversed()", "a.toSpliced(0, 1)", "Array.isArray(a)", "Array.isArray(b)", "Array(i)", "new Array(3)", "Array.of(d / 3, i)", "Array.from(a)", "Array.from(s)", "[...a.keys()]", "[...a.values()]", "[...a.entries()]", "[d / 3, i]",
    "new Uint8Array(i)", "new Float64Array(2)", "(u.set([1]), u)", "Object.keys(o)", "Object.getOwnPropertyNames(o)", "Object.getOwnPropertySymbols(o)", "Reflect.ownKeys(o)", "Object.getOwnPropertyDescriptor(o, 'x')", "Object.hasOwn(o, 'x')", "o.hasOwnProperty('x')", "o.propertyIsEnumerable('x')", "Object.values(o)", "Object.entries(o)",
    "Object.create(null)", "Object.create(o)", "Object.getPrototypeOf(o) === Object.prototype", "Reflect.getPrototypeOf(o) === Object.prototype", "Object.setPrototypeOf({}, o)", "Reflect.setPrototypeOf({}, o)", "Object(d / 3)", "Object(o)", "Object.freeze({ x: d / 3 })", "Object.prototype.toString.call(d / 3)", "o.toString()", "Object.assign({}, o)",
    "new Map()", "new Set()", "m.has(1)", "m.has(d / 2)", "st.has(d / 2)", "m.set(d / 3, i)", "st.add(d / 3)", "new Set(a)", "new Map([[d / 3, i]])", "wm.get(o)", "wm.has(o)", "ws.has(o)", "m.delete(1)", "st.delete(1)", "(m.clear(), m.size)", "(st.clear(), st.size)", "[...m.keys()]", "[...m.values()]", "[...m.entries()]", "[...st.values()]",
    "typeof Promise.resolve(d / 3)", "typeof Promise.resolve(1).then(() => 2)", "typeof Promise.reject(1).catch(() => 2)", "(view.setFloat64(0, d / 3), view.getFloat64(0))", "(view.setInt8(0, d / 3), view.getInt8(0))", "view.getBigInt64(0)", "typeof Date.now()", "typeof Math.random()", "Math.random() < 2", "date.toISOString()", "typeof date.getFullYear()", "typeof date.getTimezoneOffset()",
    "plus.bind(null, d / 3)()", "Reflect.apply(plus, null, [d / 3])", "plus.apply(null, [d / 3])", "plus.call(null, d / 3)", "Reflect.construct(Box, [d / 3])", "new Error('e' + i).message", "new TypeError('t').name", "new RangeError('r') instanceof Error", "node.toString('hex')", "(node.copy(node2), node2[0])", "node.readBigInt64LE(0)"]

declarations = [("d", "d: number = 7"), ("e", "e: number = -7"), ("s", 's: string = "hello world"'), ("a", "a: number[] = [1, 2.5, 3.5]"), ("u", "u = new Uint8Array([1, 2, 3, 4])"), ("f64", "f64 = new Float64Array([7, 2.5])"), ("i32", "i32 = new Int32Array(new SharedArrayBuffer(8))"),
    ("o", "o: any = { x: 1, z: 2.5 }"), ("m", "m = new Map<number, number>([[1, 2], [3.5, 4.5]])"), ("st", "st = new Set<number>([1, 3.5])"), ("wm", "wm = new WeakMap([[o, 1]])"), ("ws", "ws = new WeakSet([o])"),
    ("buffer", "buffer = new ArrayBuffer(16)"), ("view", "view = new DataView(buffer)"), ("date", "date = new Date(86400000.5 * 400)"), ("re", "re = /l+/g"), ("node", "node = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])"), ("node2", "node2 = Buffer.alloc(8)")]
needs = {"wm": ["o"], "ws": ["o"], "view": ["buffer"]}

def localsOf(expression):
    withoutTexts = re.sub(r"'[^']*'|/[a-z+]+/g?", "", expression).replace("...", " ")
    names = set(re.findall(r"(?<![.\w])[a-z]\w*", withoutTexts))
    for name in list(names):
        names.update(needs.get(name, []))
    return ", ".join(text for name, text in declarations if name in names)

show = '''function show(v: any): string {
  if (typeof v === "number") return Object.is(v, -0) ? "-0" : String(v);
  if (typeof v === "bigint") return v + "n";
  if (v === undefined || v === null || typeof v !== "object") return typeof v + ":" + String(v);
  if (v instanceof Map) return "Map" + show([...v]);
  if (v instanceof Set) return "Set" + show([...v]);
  if (v instanceof RegExp) return String(v);
  if (ArrayBuffer.isView(v)) return "view" + show(Array.from(v as any));
  if (Array.isArray(v)) return "[" + v.map(show).join(",") + "]";
  if (v instanceof Number) return "Number(" + show(v.valueOf()) + ")";
  return "{" + Object.keys(v).map(k => k + ":" + show(v[k])).join(",") + "}";
}
function p(n: number, x: any, y: any, z: any) { console.log(n, show(x), show(y), show(z)); }
'''

def write(path, head, more, cases):
    lines = [head, "// Written by ../../tools/generate-built-ins-in-loops.py.", show + more]
    n = 0
    for expression, declared, initial in cases:
        n += 1
        held = localsOf(expression)
        lines.append(f"function k{n}(y: number) {{ {'let ' + held + '; ' if held else ''}let b: {declared} = {initial}, i = 0; while (i < (y & 3) + 1) {{ i++; b = {expression}; }} return b; }}")
        lines.append(f"p({n}, k{n}(1.5), k{n}(0), k{n}(2));")
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), path), "w") as file:
        file.write("\n".join(lines) + "\n")
    print(n, "loops:", path)

cases = []
for expression, isRuled in numbers():
    cases.append((expression, "number", "0"))
    if isRuled:
        cases.append((expression, "number", "y"))
write("../parallel/numbers/what-math-and-operators-make-of-fractions-that-fold-comes-round-a-loop.ts",
    "// Each function of Math and each operator on numbers in a counted loop, over operands that fold to a fraction, that lie in a range, or of which nothing is known. What it gives comes round the loop.", "", cases)
cases = [(expression, "number", "0") for expression in giveNumbers] + [(expression, "any", "undefined") for expression in giveAnything]
write("../parallel/builtins/what-a-built-in-with-code-in-line-gives-comes-round-a-loop.ts",
    "// Each built-in that has code in line, in a counted loop, with operands that fold to a fraction among them. What it gives comes round the loop.",
    "function plus(x: number) { return x + 1; }\nclass Box { x: number; constructor(x: number) { this.x = x; } }\n", cases)
