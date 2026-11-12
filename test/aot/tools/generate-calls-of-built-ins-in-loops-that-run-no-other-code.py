# generate-calls-of-built-ins-in-loops-that-run-no-other-code.py <folder>: all 216; ../parallel/calls-of-built-ins-in-loops-that-run-no-other-code/ holds 1 of them: A CALL OF A BUILT-IN STANDS IN A LOOP THAT OTHERWISE RUNS NO OTHER CODE. The looks take some of them for what their row does; the walk has forms of its own for many.
# What the walk builds may do no more than the looks have counted on: under --aot-check=Validate the build stops where it does, and a plain build says "is walked again". One call a program, with local state and with state in variables.
import sys, os
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
for f in os.listdir(out): os.remove(out + '/' + f)
calls = {
 # texts and numbers in, a number or a boolean out
 'char-code-at': 'text.charCodeAt(i)', 'code-point-at': 'text.codePointAt(i) ?? -1', 'index-of': 'text.indexOf("c", i)', 'last-index-of': 'text.lastIndexOf("c", i)', 'includes': 'text.includes("cd", i)',
 'starts-with': 'text.startsWith("c", i)', 'ends-with': 'text.endsWith("c", i)', 'locale-compare': 'text.localeCompare("abd")', 'starts-with-a-join': 'text.startsWith(other + "b")', 'index-of-a-join': 'text.indexOf(other + "b")',
 'search-a-text': 'text.search("c")', 'is-well-formed': 'text.isWellFormed()', 'length': 'text.length',
 'is-integer': 'Number.isInteger(i / 2)', 'is-safe-integer': 'Number.isSafeInteger(i * 1e15)', 'is-finite': 'Number.isFinite(1 / i)', 'is-nan': 'Number.isNaN(0 / i)', 'global-is-nan': 'isNaN(0 / i)', 'global-is-finite': 'isFinite(1 / i)',
 'parse-int': 'parseInt(text.length + "" + i)', 'parse-int-with-a-radix': 'parseInt("ff", 16 + (i & 1))', 'parse-float': 'parseFloat("1.5e" + i)', 'number-of-a-text': 'Number("1" + i)', 'number-of-a-boolean': 'Number(i > 2)', 'boolean-of-a-text': 'Boolean(text)',
 'floor': 'Math.floor(i / 3)', 'ceil': 'Math.ceil(i / 3)', 'round': 'Math.round(i / 3)', 'trunc': 'Math.trunc(-i / 3)', 'abs': 'Math.abs(3 - i)', 'sign': 'Math.sign(3 - i)', 'sqrt': 'Math.sqrt(i)', 'pow': 'Math.pow(i, 2)', 'hypot': 'Math.hypot(i, 4)',
 'min': 'Math.min(i, 3, 7)', 'max': 'Math.max(i, 3)', 'imul': 'Math.imul(i, 7)', 'clz32': 'Math.clz32(i)', 'fround': 'Math.fround(i / 3)', 'atan2': 'Math.atan2(i, 2)', 'log2': 'Math.log2(i + 1)', 'min-of-nothing': 'Math.min()',
 'random': 'Math.random() < 2', 'now': 'Date.now() > 0', 'performance-now': 'performance.now() >= 0', 'utc': 'Date.UTC(2020, i)', 'date-parse': 'Date.parse("2020-01-0" + (i % 9 + 1))',
 'big-int-as-int': 'Number(BigInt.asIntN(8, 300n))', 'object-is': 'Object.is(i, -0)', 'string-raw-length': 'String.raw`a${i}`.length',
 # an object is among the operands, or a text or an object comes out
 'has-own': 'Object.hasOwn(box, "a")', 'has-own-property': 'box.hasOwnProperty("a")', 'has-own-of-a-missing-name': 'Object.hasOwn(box, "z")', 'property-is-enumerable': 'box.propertyIsEnumerable("a")', 'is-prototype-of': 'Object.prototype.isPrototypeOf(box)',
 'json-of-a-record': 'JSON.stringify(box).length', 'json-of-a-number': 'JSON.stringify(i).length', 'json-of-a-text': 'JSON.stringify(text).length', 'keys': 'Object.keys(box).length', 'values': 'Object.values(box).length', 'entries': 'Object.entries(box).length',
 'is-array': 'Array.isArray(list)', 'is-array-of-a-record': 'Array.isArray(box)', 'list-index-of': 'list.indexOf(i)', 'list-includes': 'list.includes(i)', 'list-at': 'list.at(-1) ?? 0', 'list-join': 'list.join().length', 'list-push-and-pop': '(list.push(i), list.pop() ?? 0)',
 'list-slice': 'list.slice(1).length', 'list-concat': 'list.concat(list).length', 'map-get': 'map.get(i) ?? 0', 'map-has': 'map.has(i)', 'map-set': 'map.set(i, i).size', 'set-has': 'set.has(i)', 'set-add': 'set.add(i).size', 'is-frozen': 'Object.isFrozen(box)',
 'is-extensible': 'Object.isExtensible(box)', 'get-prototype-of': 'Object.getPrototypeOf(box) === Object.prototype', 'reflect-has': 'Reflect.has(box, "a")', 'reflect-own-keys': 'Reflect.ownKeys(box).length', 'regexp-test': '/c/.test(text)', 'regexp-with-a-state': 'sticky.test(text)',
 'match': '(text.match(/c/) ?? []).length', 'replace': 'text.replace("c", "x").length', 'split': 'text.split("c").length', 'substring': 'text.substring(i).length', 'slice': 'text.slice(i).length', 'char-at': 'text.charAt(i).length', 'at': '(text.at(i) ?? "").length',
 'to-upper-case': 'text.toUpperCase().length', 'trim': 'text.trim().length', 'pad-start': 'text.padStart(i).length', 'repeat': 'text.repeat(i & 3).length', 'concat': 'text.concat(other).length', 'normalize': 'text.normalize().length', 'from-char-code': 'String.fromCharCode(65 + i).length',
 'to-string-of-a-number': 'i.toString().length', 'to-string-with-a-radix': 'i.toString(2).length', 'to-fixed': '(i / 3).toFixed(2).length', 'string-of-a-number': 'String(i).length', 'view-at': 'bytes.at(i & 3) ?? 0', 'view-index-of': 'bytes.indexOf(i)', 'view-fill': 'bytes.fill(i)[0]',
 'date-get-time': 'date.getTime() > 0', 'date-set-time': 'date.setTime(i)', 'symbol-description': '(Symbol.iterator.description ?? "").length', 'structured-clone': 'structuredClone(box).a', 'is-view': 'ArrayBuffer.isView(bytes)',
}
homes = {
 'local': '''function run(text: string, other: string, n: number): string {
  const box: { a: number; b?: number } = { a: 1 }; const list = [1, 2, 3]; const map = new Map<number, number>([[1, 2]]); const set = new Set<number>([1]); const bytes = new Uint8Array(4); const date = new Date(5); const sticky = /c/g;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Number(CALL);
  return String(Math.round(sum * 1000));
}
console.log(run("abcde", "a", 7), run("", "", 3));
''',
 'variables': '''function make() {
  let text = ""; let other = ""; let i = 0; let n = 0; let sum = 0;
  const box: { a: number; b?: number } = { a: 1 }; const list = [1, 2, 3]; const map = new Map<number, number>([[1, 2]]); const set = new Set<number>([1]); const bytes = new Uint8Array(4); const date = new Date(5); const sticky = /c/g;
  function run() { while (i < n) { sum += Number(CALL); i++; } return String(Math.round(sum * 1000)); }
  function set3(a: string, b: string, c: number) { text = a; other = b; n = c; i = 0; sum = 0; }
  return { run, set3 };
}
const made = make(); (globalThis as any).made = made;
made.set3("abcde", "a", 7); const first = made.run(); made.set3("", "", 3);
console.log(first, made.run());
''',
}
n = 0
for h, home in homes.items():
    for c, call in calls.items():
        open('%s/%s-%s.ts' % (out, h, c), 'w').write(home.replace('CALL', call)); n += 1
print(n, 'programs')
