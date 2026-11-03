// Values that go from Python to JavaScript and back.
import { program } from "./helpers";

const group = program();

const setup = `
import js, math
ident = js.eval("x => x")
kind = js.eval("x => x === null ? 'null' : Array.isArray(x) ? 'array' : typeof x")
null = js.eval("null")
`;

group("None, undefined and null", { setup }, [
  ["kind(None)", "'undefined'"],
  ["ident(None) is None", "True"],
  ["js.eval('undefined') is None, js.eval('null') is None", "(True, True)"],
  ["js.eval('[null, undefined]')", "[None, None]"],
  // null stays null where it is only passed on.
  ["kind(null), kind([null][0]), kind(js.JSON.parse('{\"a\": null}').a)", "('null', 'null', 'null')"],
  [
    "null is None, null == None, repr(null), type(null).__name__, hash(null) == hash(None)",
    "(True, True, 'None', 'NoneType', True)",
  ],
  ["js.JSON.stringify([None, null, {'a': None, 'b': null}])", `'[null,null,{"b":null}]'`],
  ["js.eval('(a, b = 5) => b')(1, None)", "5"],
  ["js.eval('(a, b = 5) => b')(1, null)", "None"],
  ["js.eval('(...a) => a.length')(None, None)", "2"],
  // Some functions tell the two apart: stream.push(null), Object.create(null). Python has no name for null.
  ["kind(js.null)", "'null'", "there is no way to write null but js.eval('null')"],
]);

group("numbers", { setup }, [
  [
    "[kind(v) for v in (True, 1, 1.5, 2.0, 2**53 - 1, 2**53, -2**53, 2**64)]",
    "['boolean', 'number', 'number', 'number', 'number', 'bigint', 'bigint', 'bigint']",
  ],
  [
    "[ident(v) for v in (0, 1, -1, 2**53 - 1, 2**53, 2**53 + 1, -2**53, 2**63, 2**200)] == [0, 1, -1, 2**53 - 1, 2**53, 2**53 + 1, -2**53, 2**63, 2**200]",
    "True",
  ],
  ["[ident(v) for v in (0.1, 1e308, 1e21, math.inf, -math.inf, -0.0)]", "[0.1, 1e+308, 1e+21, inf, -inf, -0.0]"],
  ["math.isnan(ident(math.nan))", "True"],
  // A whole float is a number to JavaScript, and a whole number an int to Python.
  ["ident(1.0), type(ident(1.0)).__name__", "(1, 'int')"],
  ["js.Math.sqrt(16), js.Math.round(2.5), js.Math.max(1, 2.5, 2)", "(4, 3, 2.5)"],
  ["js.eval('-0'), js.eval('1e21'), js.eval('2**53'), js.eval('0.5 + 0.5')", "(-0.0, 1e+21, 9007199254740992.0, 1)"],
  [
    "js.eval('5n'), type(js.eval('5n')).__name__, js.eval('9007199254740993n'), js.eval('-(2n**70n)')",
    "(5, 'int', 9007199254740993, -1180591620717411303424)",
  ],
  ["js.Number.MAX_SAFE_INTEGER + 2", "9007199254740993"],
  [
    "js.Number.isInteger(2.0), js.Number.isInteger(2.5), js.Number.isSafeInteger(2**53 - 1), js.isNaN(math.nan)",
    "(True, False, True, True)",
  ],
  ["js.eval('(a, b) => a + b')(2**64, 2**64)", "36893488147419103232"],
  ["js.eval('(a, b) => a + b')(1, 2**64)", "!JSError: TypeError: Invalid mix of BigInt and other type in addition."],
  // What BigInt() makes stays a BigInt on the way back, small as it may be.
  [
    "kind(js.BigInt(5)), js.BigInt(5) == 5, js.BigInt(5) + 1, js.BigInt.asUintN(8, js.BigInt(257))",
    "('bigint', True, 6, 1)",
  ],
  ["a = js.BigInt64Array(2)\na[0] = 2**62\na[1] = js.BigInt(5)\nlist(a)", "[4611686018427387904, 5]"],
  ["a = js.BigInt64Array(1)\na[0] = 5\na[0]", "5", "an int below 2**53 is a number, which a BigInt64Array refuses"],
  ["js.BigInt.asUintN(8, 257)", "1", "an int below 2**53 is a number where JavaScript wants a BigInt"],
  ["type(js.process.hrtime.bigint()).__name__", "'int'"],
  ["js.JSON.stringify([2**53])", "!JSError: TypeError: JSON.stringify cannot serialize BigInt."],
  ["js.parseInt('12px'), js.parseFloat('1.50'), js.Number('0x10'), js.Number('')", "(12, 1.5, 16, 0)"],
  [
    "js.Intl.NumberFormat('en-US').format(1234567.891), js.Intl.NumberFormat('en-US').format(2**64)",
    "('1,234,567.891', '18,446,744,073,709,551,616')",
  ],
  ["js.Intl.NumberFormat('de-DE', style='currency', currency='EUR').format(1234.5)", "'1.234,50\\xa0€'"],
]);

group("strings", { setup: setup + `s = "a\\U0001F600b"\n` }, [
  ["len(s), js.eval('s => s.length')(s), js.eval('s => [...s].length')(s)", "(3, 4, 3)"],
  ["ident(s) == s, ident(s) is s", "(True, True)"],
  ["js.eval('s => s.codePointAt(1)')(s) == ord(s[1]), s[1] == js.eval('s => [...s][1]')(s)", "(True, True)"],
  ["js.eval(\"'\\\\ud83d'\") == '\\ud83d', len(js.eval(\"'\\\\ud83d\\\\ude00'\"))", "(True, 1)"],
  [
    "js.eval('s => s.at(-1)')(s), 'x'.join(js.eval(\"['a', 'b']\")), js.eval('s => s.toUpperCase()')('é')",
    "('b', 'axb', 'É')",
  ],
  [
    "js.encodeURIComponent('a b&é'), js.atob(js.btoa('abc')), js.eval('(a, b) => a + b')('a', 'b')",
    "('a%20b%26%C3%A9', 'abc', 'ab')",
  ],
  ["js.eval('s => typeof s')('') , js.eval('s => s.length')('\\0')", "('string', 1)"],
  ["[x.segment for x in js.Intl.Segmenter('en', granularity='word').segment('a bc')]", "['a', ' ', 'bc']"],
  // A str has the methods of Python, in Python.
  ["hasattr('abc', 'toUpperCase'), hasattr('abc', 'length')", "(False, False)"],
  [
    "js.String.prototype.toUpperCase.call('abc')",
    "'ABC'",
    "a function read off an object is bound to it, so call() passes no other `this`",
  ],
  ["js.Reflect.apply(js.Reflect.get(js.String.prototype, 'toUpperCase'), 'abc', [])", "'ABC'"],
]);

group("lists are arrays", { setup }, [
  [
    "kind([]), js.Array.isArray([1]), type(js.eval('[1]')).__name__, type(js.Array(3)).__name__, type(js.Array.of(1, 2)).__name__",
    "('array', True, 'list', 'list', 'list')",
  ],
  ["l = [1, 2]\nident(l) is l", "True"],
  ["l = [1]\njs.eval('a => { a.push(2); }')(l)\nl.append(3)\nl, js.eval('a => a.length')(l)", "([1, 2, 3], 3)"],
  ["l = list(range(5))\njs.eval('a => a.splice(1, 2)')(l), l", "([1, 2], [0, 3, 4])"],
  [
    "l = list(range(3))\njs.eval('a => a.reverse()')(l) is l, l, js.eval('a => a.shift()')(l), js.eval('a => a.unshift(9, 8)')(l), l",
    "(True, [9, 8, 1, 0], 2, 4, [9, 8, 1, 0])",
  ],
  [
    "js.eval('a => { a.length = 1; return a; }')([1, 2, 3]), js.eval('a => { a[3] = 1; return a; }')([1])",
    "([1], [1, None, None, 1])",
  ],
  [
    "h = js.eval('[1, , 3]')\nh, len(h), h[1], h == [1, None, 3], h.count(None), js.eval('a => 1 in a')(h)",
    "([1, None, 3], 3, None, True, 1, False)",
  ],
  [
    "js.eval('new Array(2)'), js.eval('[1.5, , 2.5]'), js.eval('[1.5, 2.5]') + [1]",
    "([None, None], [1.5, None, 2.5], [1.5, 2.5, 1])",
  ],
  [
    "l = js.eval('[1, 2]')\nl.append(1.5)\nl.append('s')\nl.append(2**70)\nl.append(None)\nl",
    "[1, 2, 1.5, 's', 1180591620717411303424, None]",
  ],
  // In Python the methods are Python's.
  ["l = js.eval('[10, 9, 1]')\nl.sort()\nl, js.eval('a => a.sort()')([10, 9, 1])", "([1, 9, 10], [1, 10, 9])"],
  ["hasattr([], 'map'), hasattr([], 'length'), hasattr([], 'push')", "(False, False, False)"],
  [
    "js.eval('(a, f) => a.map(f)')([1, 2, 3], lambda x: x * 2), js.eval('(a, f) => a.filter(f)')([0, 1, 2, 3], lambda x: x % 2)",
    "([2, 4, 6], [1, 3])",
  ],
  [
    "js.eval('(a, f) => a.sort(f)')([3, 1, 2], lambda a, b: a - b), js.eval('(a, f) => a.reduce(f, 0)')([3, 1, 2], lambda acc, x: acc + x)",
    "([1, 2, 3], 6)",
  ],
  ["js.Reflect.apply(js.Reflect.get(js.Array.prototype, 'map'), [1, 2], [lambda x: x * 2])", "[2, 4]"],
  [
    "js.Array.prototype.map.call([1, 2], lambda x: x * 2)",
    "[2, 4]",
    "Array.prototype is an array, so a list, which has no map",
  ],
  [
    "[js.Array['from'](v) for v in ((1, 2), range(3), 'ab', {'a': 1}, (x * 2 for x in range(2)))]",
    "[[1, 2], [0, 1, 2], ['a', 'b'], [['a', 1]], [0, 2]]",
  ],
  ["sorted(js.Array['from']({1, 2}))", "[1, 2]"],
  [
    "js.eval('a => [...a, 4]')([[1]]), js.eval('a => a.flat()')([[1], [2]]), js.eval('a => a.concat([3])')([1])",
    "([[1], 4], [1, 2], [1, 3])",
  ],
  ["js.eval('([a, b], ...c) => [a, b, c]')((1, 2), 3)", "[1, 2, [3]]"],
  [
    "big = list(range(100000))\njs.eval('a => a.reduce((x, y) => x + y, 0)')(big), js.Math.max(*big)",
    "(4999950000, 99999)",
  ],
  [
    "out = []\nl = [1, 2, 3]\nfor x in l:\n    out.append(x)\n    js.eval('a => { a.length = 1; }')(l)\nout, l",
    "([1], [1])",
  ],
  // An array that JavaScript has frozen, sealed or made sparse is stored otherwise.
  [
    "l = js.Object.freeze([1, 2])\nl, l[0], len(l), sum(l)",
    "([1, 2], 1, 2, 3)",
    "the items of a frozen array read as None",
  ],
  ["l = js.Object.seal([1, 2])\nl[0] = 9\nl", "[9, 2]", "the items of a sealed array read as None"],
  ["l = js.Object.preventExtensions([1, 2])\nl", "[1, 2]", "the items read as None"],
  [
    "l = js.eval('(() => { const a = [1, 2]; a[100000] = 4; return a; })()')\nlen(l), l[0], l[100000]",
    "(100001, 1, 4)",
    "an item of a sparse array reads as None",
  ],
  [
    "l = js.eval('(() => { const a = [1, 2]; Object.defineProperty(a, 1, { get() { return 7; } }); return a; })()')\nl",
    "[1, 7]",
    "the items read as None",
  ],
  ["l = js.Object.freeze([1, 2])\nl.append(3)", "!JSError: TypeError: Attempted to assign to readonly property."],
  // What an array has besides its items.
  [
    "m = js.eval(\"/(?<y>a)/.exec('xa')\")\nlist(m), js.Reflect.get(m, 'index'), js.Reflect.get(m, 'groups').y",
    "(['a', 'a'], 1, 'a')",
  ],
  [
    "js.eval(\"/(?<y>a)/.exec('xa')\").groups.y",
    "'a'",
    "the properties of an array that are no items cannot be reached",
  ],
  [
    "l = js.eval('(() => { class Sum extends Array { sum() { return this.reduce((a, b) => a + b, 0); } } return Sum.from([1, 2]); })()')\nl.sum()",
    "3",
    "nor can the methods of a class derived from Array",
  ],
]);

group("dicts, tuples, sets and objects", { setup }, [
  ["kind({}), kind(()), kind(set()), kind(b''), kind(range(1))", "('object', 'object', 'object', 'object', 'object')"],
  ["d = {'a': 1}\nident(d) is d", "True"],
  [
    "js.Object.keys({'a': 1, 'b': 2}), js.Object.entries({'a': 1, 2: 3}), js.Object.values({'a': [1]})",
    "(['a', 'b'], [['a', 1], ['2', 3]], [[1]])",
  ],
  [
    "dict(js.Object.assign(js.Object(), {'a': 1}, {'b': [1]})), js.Object.assign({}, {'a': 1})",
    "({'a': 1, 'b': [1]}, {'a': 1})",
  ],
  ["js.eval('d => ({ ...d })')({'a': 1, 'b': 2}).items()", "[('a', 1), ('b', 2)]"],
  ["js.eval('({ a, b = 5 }) => a + b')({'a': 1})", "6"],
  ["d = {'a': 1}\njs.eval('d => { d.b = 2; delete d.a; }')(d)\nd", "{'b': 2}"],
  [
    "js.eval('d => [...d]')({'a': 1}), js.eval('d => new Map(d).get(\"a\")')({'a': 1}), js.eval('d => Object.fromEntries(d).a')({'a': 1})",
    "([['a', 1]], 1, 1)",
  ],
  ["js.eval('d => [\"a\" in d, \"z\" in d, d.z, d.a]')({'a': 1})", "[True, False, None, 1]"],
  [
    "js.eval('t => [t.length, t[0], [...t], JSON.stringify(t), Array.isArray(t)]')((1, 2))",
    "[2, 1, [1, 2], '[1,2]', False]",
  ],
  ["js.eval('s => [[...s].sort(), s.length, JSON.stringify([...s].sort())]')({1, 2})", "[[1, 2], 2, '[1,2]']"],
  ["js.eval('r => [r.length, r[1], [...r], r.start, r.step]')(range(1, 7, 2))", "[3, 3, [1, 3, 5], 1, 2]"],
  [
    "o = js.eval('({ a: 1, b: [1, 2], c: { d: null } })')\ntype(o).__name__, o.a, o['a'], o.b, o.c.d, len(o), list(o), 'a' in o, 'z' in o",
    "('JSObject', 1, 1, [1, 2], None, 3, ['a', 'b', 'c'], True, False)",
  ],
  [
    "o = js.eval('({ a: 1 })')\no.b = 2\no['c'] = 3\ndel o.a\ndict(o), {**o}, o.keys(), o.values(), o.items()",
    "({'b': 2, 'c': 3}, {'b': 2, 'c': 3}, ['b', 'c'], [2, 3], [('b', 2), ('c', 3)])",
  ],
  [
    "o = js.eval('({ a: 1 })')\ngetattr(o, 'z', 'default'), hasattr(o, 'z'), o.get('a') if hasattr(o, 'get') else 'no get()'",
    "('default', False, 'no get()')",
  ],
  ["js.eval('({ a: 1 })').z", "!AttributeError: 'JSObject' object has no attribute 'z'"],
  ["js.eval('({ a: 1 })')['z']", "!KeyError: 'z'"],
  ["o = js.Object()\no == o, o == js.Object(), hash(o) == hash(o), {o: 1}[o]", "(True, False, True, 1)"],
  // As libraries look at what they are given.
  [
    'js.eval(\'d => [Object.hasOwn(d, "a"), d.hasOwnProperty("a"), Reflect.has(d, "a"), Object.getPrototypeOf(d) === Object.prototype, d.constructor === Object, Object.prototype.toString.call(d), Symbol.iterator in d]\')({\'a\': 1})',
    "[True, True, True, False, False, '[object dict]', True]",
  ],
  [
    "d = {'a': 1, 'b': {'c': [1, 2]}}\njs.eval('d => { d.a++; d.a += 1; d.b.c.push(3); const { a, ...rest } = d; return [a, Object.keys(rest), d?.x?.y, d.b?.c?.[1]]; }')(d), d",
    "([3, ['b'], None, 2], {'a': 3, 'b': {'c': [1, 2, 3]}})",
  ],
  // Options: keyword arguments make an object of JavaScript; a dict is a dict, with a length and methods.
  [
    "js.eval('o => [o.length, typeof o.get, typeof o.keys, typeof o.items]')({'a': 1})",
    "[1, 'function', 'function', 'function']",
  ],
  [
    "js.eval('o => [o.length, typeof o.get, Object.getPrototypeOf(o) === Object.prototype]')(a=1)",
    "[None, 'undefined', True]",
  ],
]);

group("JSON and structuredClone", { setup: "import json, copy\n" + setup }, [
  [
    "js.JSON.stringify({'a': [1, 2.0, None, True, 's', (1, 2)], 'b': {'c': 1.5}, 3: 4})",
    `'{"a":[1,2,null,true,"s",[1,2]],"b":{"c":1.5},"3":4}'`,
  ],
  [
    "js.JSON.stringify('s'), js.JSON.stringify(None), js.JSON.stringify(1.0), js.JSON.stringify([1], None, 1)",
    `('"s"', None, '1', '[\\n 1\\n]')`,
  ],
  [
    'r = js.JSON.parse(\'{"a": [1, 2.0, null, {"b": 1e3}], "c": 1.5}\')\ntype(r).__name__, r.a[:3], r.a[3].b, r.c',
    "('JSObject', [1, 2, None], 1000, 1.5)",
  ],
  ["js.JSON.parse('[1, 2]', lambda key, value: value * 2 if isinstance(value, int) else value)", "[2, 4]"],
  ["js.JSON.stringify({'a': 1, 'b': 2}, lambda key, value: None if key == 'a' else value)", `'{"b":2}'`],
  [
    'json.dumps(js.JSON.parse(\'{"a": [1, {"b": null}]}\'))',
    `'{"a": [1, {"b": null}]}'`,
    "json does not know an object of JavaScript",
  ],
  ["json.loads(js.JSON.stringify({'a': (1, 2)}))", "{'a': [1, 2]}"],
  ["json.dumps([None, null]), kind(copy.deepcopy([null])[0])", "('[null, null]', 'null')"],
  ["js.structuredClone([1, 'a', None, [2.5], True, 2**64])", "[1, 'a', None, [2.5], True, 18446744073709551616]"],
  ["l = [1]\njs.structuredClone(l) is l", "False"],
  ["c = js.structuredClone(js.Map([[1, js.Set([2])]]))\nc.get(1).has(2)", "True"],
  ["js.structuredClone([1.0, 2.5])", "[1, 2.5]", "a whole float in a list is an object that cannot be cloned"],
  ["dict(js.structuredClone({'a': 1}))", "{'a': 1}", "a dict cannot be cloned"],
  ["list(js.structuredClone((1, 2)))", "[1, 2]", "a tuple cannot be cloned"],
  ["bytes(js.structuredClone(b'ab'))", "b'ab'", "bytes cannot be cloned"],
  ["copy.copy(js.eval('({ a: 1 })')).a", "1", "copy does not know an object of JavaScript"],
]);
