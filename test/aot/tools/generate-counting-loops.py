#!/usr/bin/env python3
# generate-counting-loops.py test/aot/parallel/counting-loops: loops that count, one shape a program, each held to `bun <file>`.
# A compiler keeps a counter, a bound and a tally in integers where it can. Each program hands its one loop the values at which that stops being right: 2 ** 31, 2 ** 32, 2 ** 53, a fraction, NaN, -0,
# Infinity, a text, an object that converts by code; a bound, a counter or a list that is changed in the loop.
# Each shape comes in up to three forms, because what a build knows of the operands decides what it builds:
#   -of-anything.js   the values arrive as they are, of every kind
#   -of-numbers.js    they are converted at the call, so every operand is a number, of which nothing else is known
#   -typed.ts         the same, and the parameters are declared `number`
import os, sys
out = sys.argv[1]; os.makedirs(out, exist_ok=True)

HEAD = '''const unknown = value => new CustomEvent("unknown", { detail: value }).detail;
const show = value =>
  Object.is(value, -0) ? "-0"
  : typeof value === "string" ? JSON.stringify(value)
  : typeof value === "bigint" ? value + "n"
  : typeof value === "symbol" ? "a symbol"
  : typeof value === "function" ? "a function"
  : Array.isArray(value) ? "[" + value.map(show).join(", ") + "]"
  : value !== null && typeof value === "object" ? "an object"
  : String(value);
'''
TYPED_HEAD = HEAD.replace('value =>\n', '(value: any): string =>\n').replace('const unknown = value =>', 'const unknown = (value: any): any =>')

# What lies round the borders. No pair makes a loop turn more than a few dozen times.
I31, I32, I53 = '2 ** 31', '2 ** 32', '2 ** 53'
UP = [  # from, n: `i` goes up to `n`
    '0, 0', '0, 1', '0, 5', '0, -1', '0, -0', '-0, 0', '-0, 2', '0, 0.5', '0, 2.5', '0, 3.000000001', '0, NaN', 'NaN, 3', '0, -Infinity', '-Infinity, -Infinity', '-3, 2', '0.5, 3', '-0.5, 2', '5, 0',
    f'{I31} - 3, {I31} - 1', f'{I31} - 3, {I31}', f'{I31} - 3, {I31} + 3', f'{I31} - 1.5, {I31} + 1.5', f'{I32} - 2, {I32} + 2', f'-({I31}) - 3, -({I31}) + 3', f'-({I32}) - 2, -({I32}) + 2',
    f'{I53} - 3, {I53} - 1', f'{I53} - 3, {I53}', f'-({I53}), -({I53}) + 3', '1e15, 1e15 + 3',
]
DOWN = [  # from, n: `i` goes down to `n`
    '0, 0', '1, 0', '5, 0', '-1, 0', '2, -0', '0, -0', '2.5, 0', '3, 0.5', 'NaN, 0', '3, NaN', '3, Infinity', '2, -3',
    f'{I31} + 3, {I31} - 3', f'-({I31}) + 3, -({I31}) - 3', f'-({I32}) + 2, -({I32}) - 2', f'{I32} + 2, {I32} - 2', f'-({I53}) + 3, -({I53})', f'-({I53}) + 3, -({I53}) + 1', f'{I53}, {I53} - 3',
]
NEVER_ENDING = [  # from, n: the loop would never end, or not in our time: the shape has a way out
    '0, Infinity', '0, 1e300', f'0, {I31} + 5', f'{I31} - 3, Infinity', f'{I53} - 3, {I53} + 2', f'{I53} - 3, Infinity', f'{I53} - 3, 1e300', f'{I53}, Infinity', f'{I53} - 1, {I53} + 4', '1e300, Infinity', '0.5, Infinity',
]
OTHER_KINDS = [  # from, n: what is no number
    '0, "5"', '0, "2.5"', '0, "abc"', '0, ""', '0, " 3 "', '0, "0x3"', '0, null', '0, undefined', '0, true', '0, false', '0, [3]', '0, []', '0, [1, 2]', '0, {}', '0, { valueOf: () => 3 }', '0, { toString: () => "2" }',
    '0, 3n', '0, Symbol()', '"0", 3', '"1", "3"', '"a", "c"', '"", 2', 'null, 2', 'undefined, 2', 'true, 3', '[1], 3', '{ valueOf: () => 1 }, 3', '0n, 3', '0n, 3n', '1n, 2.5', 'Symbol(), 3',
]

shapes = []
def shape(name, says, parameters, body, numbers, others=(), more='', typed=True, results=None):
    shapes.append(dict(name=name, says=says, parameters=parameters, body=body, numbers=list(numbers), others=list(others), more=more, typed=typed))

# ---- the bound
shape('up-to-a-bound', 'The plainest of them.', 'from, n', 'let s = 0;\n  for (let i = from; i < n; i++) s++;\n  return s;', UP, OTHER_KINDS)
shape('up-to-a-bound-and-the-counter-behind-the-loop', 'What the counter holds behind the loop.', 'from, n', 'let s = 0, i = from;\n  for (; i < n; i++) s++;\n  return [s, i];', UP, OTHER_KINDS)
shape('up-to-and-with-a-bound', '`<=`.', 'from, n', 'let s = 0, i = from;\n  for (; i <= n; i++) s++;\n  return [s, i];', [p for p in UP if p != f'{I53} - 3, {I53}' and p != '-Infinity, -Infinity'], [p for p in OTHER_KINDS])
shape('up-to-a-bound-written-first', '`n > i`.', 'from, n', 'let s = 0, i = from;\n  for (; n > i; i++) s++;\n  return [s, i];', UP, OTHER_KINDS)
shape('up-while-not-at-or-over-a-bound', '`!(i >= n)`, which NaN does not end.', 'from, n', 'let s = 0, i = from;\n  for (; !(i >= n); i++) if (++s === 7) break;\n  return [s, i];', UP + NEVER_ENDING, OTHER_KINDS)
shape('up-until-the-bound-is-met', '`i !== n`, which only the very value ends.', 'from, n', 'let s = 0, i = from;\n  for (; i !== n; i++) if (++s === 7) break;\n  return [s, i];', UP + NEVER_ENDING, OTHER_KINDS)
shape('up-until-the-bound-is-met-loosely', '`i != n`.', 'from, n', 'let s = 0, i = from;\n  for (; i != n; i++) if (++s === 7) break;\n  return [s, i];', UP, OTHER_KINDS, typed=False)
shape('up-with-a-way-out', 'The bound lies out of reach, and the loop leaves by a break.', 'from, n', 'let last = from, turns = 0;\n  for (let i = from; i < n; i++) {\n    last = i;\n    if (++turns === 6) break;\n  }\n  return [last, turns];', NEVER_ENDING + UP[:8], OTHER_KINDS[:6])
shape('down-to-a-bound', 'Downwards.', 'from, n', 'let s = 0, i = from;\n  for (; i > n; i--) s++;\n  return [s, i];', DOWN, ['"3", 0', '3, "1"', '3, null', '3, undefined', '[3], 0', '3n, 0', '3n, 0n', '3, { valueOf: () => 1 }'])
shape('down-to-and-with-a-bound', '`>=`.', 'from, n', 'let s = 0, i = from;\n  for (; i >= n; i--) s++;\n  return [s, i];', [p for p in DOWN if p != f'-({I53}) + 3, -({I53})'], ['"3", 0', '3, "1"', '3, null', '3n, 0'])
shape('down-while-something-is-left', '`while (i--)`: zero, -0 and NaN end it.', 'from', 'let turns = 0, i = from;\n  while (i--) if (++turns === 7) break;\n  return [turns, i];', ['0', '-0', '1', '3', '-1', '2.5', 'NaN', 'Infinity', f'{I31} + 1', f'-({I31})', f'{I53}', f'-({I53})'], ['"3"', '""', '"a"', 'null', 'undefined', 'true', '[2]', '3n', '0n', '{ valueOf: () => 2 }'])
shape('down-in-front-of-the-test', '`while (--i > n)`.', 'from, n', 'let turns = 0, i = from;\n  while (--i > n) if (++turns === 7) break;\n  return [turns, i];', DOWN, ['"3", 0', '3n, 0'])

# ---- the step
shape('up-by-two', 'A step of two goes past the bound.', 'from, n', 'let s = 0, i = from;\n  for (; i < n; i += 2) s++;\n  return [s, i];', UP, OTHER_KINDS[:8] + ['"0", 3'])
shape('up-by-a-step-nobody-knows', 'The step is handed in.', 'from, n, by', 'let s = 0, i = from;\n  for (; i < n; i += by) if (++s === 7) break;\n  return [s, i];',
      ['0, 5, 1', '0, 5, 2', '0, 5, 0.5', '0, 5, 0', '0, 5, -0', '0, 5, -1', '0, 5, NaN', '0, 5, Infinity', '0, Infinity, Infinity', f'0, {I32}, {I31} - 1', f'0, {I53}, 2 ** 52', f'{I53} - 2, Infinity, 1', f'{I53} - 2, Infinity, 2', f'{I31} - 2, {I31} + 9, 3', '0, 1, 1e-300', '0.1, 1, 0.1'],
      ['0, 5, "1"', '0, 5, null', '0, 5, undefined', '0, 5, true', '0, 5, [2]', '0, 5, 1n', '0n, 5, 1n', '0, 5, { valueOf: () => 2 }', '"", 5, 1'])
shape('up-by-one-written-as-a-sum', '`i = i + 1`, which joins texts.', 'from, n', 'let s = 0, i = from;\n  for (; i < n; i = i + 1) if (++s === 7) break;\n  return [s, i];', UP, OTHER_KINDS)
shape('up-by-one-in-front', '`++i` in the test.', 'from, n', 'let s = 0, i = from;\n  while (++i < n) s++;\n  return [s, i];', UP, OTHER_KINDS[:10])
shape('up-by-one-behind-the-test', '`i++ < n`: the counter is one further than what was tested.', 'from, n', 'let s = 0, i = from;\n  while (i++ < n) s++;\n  return [s, i];', UP, OTHER_KINDS[:10])
shape('up-and-cut-to-32-bits', '`i = (i + 1) | 0` comes round at 2 ** 31.', 'from, n', 'let s = 0, i = from;\n  for (; i < n; i = (i + 1) | 0) if (++s === 7) break;\n  return [s, i];', UP + NEVER_ENDING, OTHER_KINDS[:6])
shape('up-and-cut-to-32-bits-without-a-sign', '`i = (i + 1) >>> 0` comes round at 2 ** 32.', 'from, n', 'let s = 0, i = from;\n  for (; i < n; i = (i + 1) >>> 0) if (++s === 7) break;\n  return [s, i];', UP + NEVER_ENDING, OTHER_KINDS[:6])
shape('up-by-doubling', '`i *= 2` leaves every width.', 'from, n', 'let s = 0, i = from;\n  for (; i < n; i *= 2) if (++s === 1100) break;\n  return [s, i];', ['1, 100', f'1, {I31} + 1', f'1, {I32} * 4', f'1, {I53} * 4', '1, Infinity', '0, 5', '-1, 5', '3, 1e300', '0.5, 9', 'NaN, 5'], ['"1", 9', '1n, 9', '1n, 9n'])
shape('up-by-shifting', '`i <<= 1` comes round to a negative number, then to zero.', 'from, n', 'let s = 0, i = from;\n  for (; i < n; i <<= 1) if (++s === 40) break;\n  return [s, i];', ['1, 100', f'1, {I31}', f'1, {I31} - 1', f'3, {I32}', '0, 5', '1.5, 9', f'{I32} + 1, {I32} + 9'], ['"1", 9', '1n, 9n'])

# ---- the tally
TALLY = ['0, 0, 1', '5, 0, 1', f'5, {I31} - 3, 1', f'5, -({I31}) + 3, -1', f'5, {I32} - 3, 1', f'5, {I53} - 3, 1', f'5, -({I53}) + 3, -1', f'5, {I53} - 3, 2', '5, 0, 0.1', '10, 0, 0.1', f'5, 0, 2 ** 30', f'5, 0, 2 ** 52', f'3, 1, {I53}', '3, 0, NaN', '3, 0, Infinity', '2, Infinity, -Infinity',
         '3, -0, -0', '0, -0, 1', '3, 0, -0', '3, -0, 0', '1, -1, 1', '3, 1e308, 1e308', '3, 0.5, 1', '3, NaN, 1']
shape('tally-grown-by-what-is-handed-in', '`s += by`.', 'n, start, by', 'let s = start;\n  for (let i = 0; i < n; i++) s += by;\n  return s;', TALLY,
      ['3, "", 1', '3, 0, "a"', '3, "x", "y"', '3, 0, null', '3, 0, undefined', '3, null, 1', '3, undefined, 1', '3, 0, true', '3, [], 1', '3, 0, [1]', '3, 0n, 1n', '3, 0, 1n', '3, 0, { valueOf: () => 2 }', '3, {}, 1', '2, 0, Symbol()'])
shape('tally-that-counts', '`s++` from a start that is handed in.', 'n, start', 'let s = start;\n  for (let i = 0; i < n; i++) s++;\n  return s;', ['0, 0', '5, 0', '0, -0', '1, -0', f'5, {I31} - 3', f'5, {I32} - 3', f'5, {I53} - 3', f'5, -({I31}) - 3', '3, 0.5', '3, NaN', '3, Infinity', '3, -1'], ['3, "1"', '0, "1"', '3, ""', '3, "a"', '3, null', '3, undefined', '3, true', '3, [1]', '3, 1n', '0, 1n', '3, { valueOf: () => 4 }'])
shape('tally-that-counts-down', '`s--`.', 'n, start', 'let s = start;\n  for (let i = 0; i < n; i++) s--;\n  return s;', ['0, 0', '5, 0', '0, -0', '1, 1', f'5, -({I31}) + 3', f'5, -({I53}) + 3', f'5, {I31} + 3', '3, 0.5', '3, NaN'], ['3, "1"', '3, null', '3, 1n'])
shape('tally-of-the-counter', '`s += i`: the sum grows by the square.', 'from, n', 'let s = 0;\n  for (let i = from; i < n; i++) s += i;\n  return s;', UP, OTHER_KINDS)
shape('tally-of-a-long-run', 'The sum leaves 32 bits in the middle of the loop.', 'n', 'let s = 0;\n  for (let i = 0; i < n; i++) s += i;\n  return s;', ['65535', '65536', '65537', '92681', '92682', '100000', '200000.5'])
shape('tally-of-products', '`s += i * i` and `s += i * by`: a product leaves 32 bits, then 53.', 'from, n, by', 'let s = 0, t = 0;\n  for (let i = from; i < n; i++) {\n    s += i * i;\n    t += i * by;\n  }\n  return [s, t];',
      ['0, 5, 1', '46339, 46343, 46341', f'{I31} - 2, {I31} + 2, 2', '94906265, 94906268, 94906267', '-3, 3, -0', '-3, 3, 0', '0, 3, -1', '0, 3, NaN', '1, 3, Infinity', '0, 3, Infinity', '0, 3, 0.5', f'1, 4, {I53}'])
shape('tally-cut-to-32-bits', '`s = (s + by) | 0`.', 'n, start, by', 'let s = start;\n  for (let i = 0; i < n; i++) s = (s + by) | 0;\n  return s;', TALLY)
shape('tally-doubled', '`s *= 2` goes to Infinity, `s /= 2` to zero.', 'n, start', 'let s = start, t = start;\n  for (let i = 0; i < n; i++) {\n    s *= 2;\n    t /= 2;\n  }\n  return [s, t];', ['0, 1', '30, 1', '31, 1', '32, 1', '53, 1', '54, 3', '1100, 1', '1100, -1', '3, 0', '3, -0', '3, NaN', '1080, 3'])
shape('tally-of-remainders-and-quotients', '`%` and `/` of the counter: -0, NaN and fractions come out of integers.', 'from, n, by', 'const seen = [];\n  for (let i = from; i < n; i++) seen.push(i % by, i / by, -i, i * by);\n  return seen;', ['-2, 3, 2', '-2, 3, -2', '-1, 2, 0', '-1, 2, -0', '0, 2, NaN', '0, 2, Infinity', f'{I31} - 1, {I31} + 1, -1', f'-({I31}) - 1, -({I31}) + 1, -1', '-1, 2, 0.5'])
shape('two-tallies-under-a-test', 'Which tally grows goes by a test in the turn.', 'n, start', 'let even = start, odd = start;\n  for (let i = 0; i < n; i++) {\n    if (i & 1) odd++;\n    else even += 2;\n  }\n  return [even, odd];', ['0, 0', '7, 0', f'7, {I31} - 4', f'7, {I53} - 4', '7, 0.5', '7, -0', '1, -0', '2, NaN'], ['3, "a"', '3, 1n', '3, null'])
shape('largest-and-smallest', 'What is kept is one of the values that came by.', 'from, n', 'let most = -Infinity, least = Infinity;\n  for (let i = from; i < n; i++) {\n    if (i > most) most = i;\n    if (i < least) least = i;\n  }\n  return [most, least];', UP)

# ---- what is changed in the loop
CHANGED = ['0', '1', '3', '5', '8', '2.5', 'NaN', '-1', f'{I31}', 'Infinity']
def changed(name, says, change, typed=True, others=('"6"', 'null', '[6]', '6n')):
    shape(name, says, 'n', f'let s = 0, i = 0;\n  for (; i < n; i++) {{\n    {change}\n    if (++s === 12) break;\n  }}\n  return [s, i, n];', CHANGED, others, typed=typed)
changed('bound-lowered-in-the-loop', '`n -= 2` in one turn.', 'if (i === 2) n -= 2;')
changed('bound-raised-in-the-loop', '`n++` in every other turn.', 'if (i & 1) n++;')
changed('bound-made-a-fraction-in-the-loop', '`n += 0.5`.', 'if (i === 1) n += 0.5;')
changed('bound-made-no-number-in-the-loop', '`n = NaN`.', 'if (i === 2) n = NaN;')
changed('bound-put-out-of-reach-in-the-loop', '`n = Infinity`, `n = 2 ** 53`.', 'if (i === 1) n = i & 2 ? Infinity : 2 ** 53;')
changed('bound-made-a-text-in-the-loop', '`n = "4"`.', 'if (i === 1) n = "4";', typed=False)
changed('bound-made-an-object-in-the-loop', 'From then on the test runs code of the program.', 'if (i === 1) n = { valueOf: () => (s < 5 ? 100 : 0) };', typed=False)
changed('counter-moved-on-in-the-loop', '`i += 2` in one turn.', 'if (i === 1) i += 2;')
changed('counter-set-back-in-the-loop', '`i--` in one turn, once.', 'if (i === 2 && s === 2) i--;')
changed('counter-made-a-fraction-in-the-loop', '`i += 0.5`.', 'if (i === 1) i += 0.5;')
changed('counter-put-past-32-bits-in-the-loop', '`i = 2 ** 31 - 2`.', 'if (i === 1) i = 2 ** 31 - 2;')
changed('counter-put-at-the-end-of-integers-in-the-loop', '`i = 2 ** 53 - 2`.', 'if (i === 1) i = 2 ** 53 - 2;')
changed('counter-made-no-number-in-the-loop', '`i = NaN`.', 'if (i === 2) i = NaN;')
changed('counter-made-minus-zero-in-the-loop', '`i = -0`, once.', 'if (i === 2 && s === 2) i = -0;')
changed('counter-made-a-text-in-the-loop', '`i = "2"`: `i++` makes a number of it.', 'if (i === 1) i = "2";', typed=False)
shape('bound-lowered-by-a-closure', 'A function that is called in the loop stores into the bound.', 'n', 'let s = 0;\n  const lower = () => { n -= 2; };\n  for (let i = 0; i < n; i++) {\n    if (i === 1) unknown(lower)();\n    s++;\n  }\n  return [s, n];', CHANGED[:8])
shape('counter-moved-by-a-closure', 'A function that is called in the loop stores into the counter of that turn.', 'n', 'let s = 0;\n  for (let i = 0; i < n; i++) {\n    const skip = () => { i += 2; };\n    if (i === 1) unknown(skip)();\n    if (++s === 12) break;\n  }\n  return s;', CHANGED)
shape('counter-kept-by-closures', 'Each turn has a counter of its own, and a closure keeps it.', 'n', 'const kept = [];\n  for (let i = 0; i < n; i++) {\n    kept.push(() => i);\n    if (i === 1) i++;\n    if (kept.length === 6) break;\n  }\n  return kept.map(each => each());', CHANGED)
shape('bound-in-a-variable-of-the-module', 'A function that is called in the loop stores into the variable.', 'n', 'limit = n;\n  let s = 0;\n  for (let i = 0; i < limit; i++) {\n    if (i === 1) unknown(lowerLimit)();\n    s++;\n  }\n  return [s, limit];', CHANGED[:8], more='let limit = 0;\nfunction lowerLimit() {\n  limit -= 2;\n}\n')
shape('bound-in-a-field', 'A function that is called in the loop stores into the field.', 'n', 'const holder = { n };\n  let s = 0;\n  for (let i = 0; i < holder.n; i++) {\n    if (i === 1) unknown(lowerField)(holder);\n    s++;\n  }\n  return [s, holder.n];', CHANGED[:8], ['"6"', '6n'], more='function lowerField(holder) {\n  holder.n -= 2;\n}\n', typed=False)
shape('bound-behind-a-getter', 'The test runs code of the program in every turn.', 'n', 'let asked = 0;\n  const holder = { get n() { return ++asked < 4 ? n : 0; } };\n  let s = 0;\n  for (let i = 0; i < holder.n; i++) s++;\n  return [s, asked];', CHANGED, typed=False)

# ---- lists
LISTS = ['[]', '[1]', '[1, 2, 3]', '[1.5, 2, 3]', '[1, , 3]', '[1, "a", 3]', f'[{I31} - 1, 1, 1]', f'[{I53} - 1, 1, 1]', '[-0]', '[-0, -0]', '[NaN, 1]', '[1, undefined]', '[1, null]', '[1n]', 'new Array(3)', 'Array.from({ length: 40 }, (_, i) => i)', '"abc"', '{ length: 2, 0: 5, 1: 6 }', '{ length: "2", 0: 5, 1: 6 }', '{ length: 1.5, 0: 5, 1: 6 }', '{ length: -1 }', '{}', 'new Uint8Array([250, 5, 1])', 'new Float64Array([0.5, -0])']
def lists(name, says, body, rows=LISTS):
    shape(name, says, 'list', body, [], rows, typed=False)
lists('sum-of-a-list', '`i < list.length`, asked in every turn.', 'let s = 0;\n  for (let i = 0; i < list.length; i++) s += list[i];\n  return s;')
lists('sum-of-a-list-whose-length-is-read-once', '`const n = list.length`.', 'let s = 0;\n  for (let i = 0, n = list.length; i < n; i++) s += list[i];\n  return s;')
lists('sum-of-a-list-from-its-end', '`i = list.length - 1; i >= 0`.', 'let s = 0;\n  for (let i = list.length - 1; i >= 0; i--) s += list[i];\n  return s;')
lists('sum-of-a-list-from-its-end-by-a-while', '`while (i--)`.', 'let s = 0, i = list.length, turns = 0;\n  while (i--) {\n    s += list[i];\n    if (++turns === 50) break;\n  }\n  return [s, i];')
lists('sum-past-the-end-of-a-list', '`i <= list.length` reads one past the end.', 'let s = 0;\n  for (let i = 0; i <= list.length; i++) s += list[i];\n  return s;')
GROWN = ['[]', '[1]', '[1, 2, 3]', '[1, 2, 3, 4, 5, 6]', '[1.5, 2]', '["a", "b", "c"]']
lists('list-that-grows-in-the-loop', '`push` in the loop.', 'let s = 0;\n  for (let i = 0; i < list.length; i++) {\n    if (list.length < 9 && i & 1) list.push(i);\n    s++;\n  }\n  return [s, list.length];', GROWN)
lists('list-that-shrinks-in-the-loop', '`pop` in the loop.', 'let s = 0;\n  for (let i = 0; i < list.length; i++) {\n    if (i & 1) list.pop();\n    s++;\n  }\n  return [s, list.length];', GROWN)
lists('list-that-is-cut-in-the-loop', '`list.length = 2` in the loop.', 'let s = 0;\n  for (let i = 0; i < list.length; i++) {\n    if (i === 1) list.length = 2;\n    s += typeof list[i] === "number" ? list[i] : 100;\n  }\n  return [s, list.length];', GROWN)
lists('list-that-is-cut-while-its-length-is-kept', 'The length was read in front of the loop: the turns go on over holes.', 'const seen = [];\n  for (let i = 0, n = list.length; i < n; i++) {\n    if (i === 1) list.length = 2;\n    seen.push(list[i]);\n  }\n  return seen;', GROWN)
lists('list-that-is-changed-by-a-function-called-in-the-loop', 'Nothing in the loop names the change.', 'let s = 0;\n  for (let i = 0; i < list.length; i++) {\n    if (i === 1) unknown(cut)(list);\n    s++;\n  }\n  return [s, list.length];', GROWN)
shapes[-1]['more'] = 'function cut(list) {\n  list.length = 2;\n}\n'
lists('list-that-is-replaced-in-the-loop', '`list = [..]` in the loop.', 'let s = 0;\n  for (let i = 0; i < list.length; i++) {\n    if (i === 1) list = [7, 7, 7, 7];\n    s += typeof list[i] === "number" ? list[i] : 100;\n  }\n  return s;', GROWN)

# ---- several counters, loops in loops, other ways out
shape('two-counters-that-meet', '`i++, j--`.', 'from, n', 'let turns = 0, i = from, j = n;\n  for (; i < j; i++, j--) turns++;\n  return [turns, i, j];', [p for p in UP if 'Infinity' not in p], ['0, "5"', '"0", 5', '0n, 5n'])
shape('loop-bounded-by-the-counter-around-it', 'The bound of the inner loop is the counter of the outer one.', 'from, n', 'let s = 0;\n  for (let i = from; i < n; i++) for (let j = from; j < i; j++) s++;\n  return s;', UP, OTHER_KINDS[:8])
shape('loop-that-goes-on-where-another-ended', 'The second loop begins at what the first left.', 'from, n', 'let i = from, s = 0;\n  for (; i < n; i++) s++;\n  for (; i < n + 2; i++) s += 10;\n  return [s, i];', [p for p in UP if 'Infinity' not in p and p != f'{I53} - 3, {I53}'], OTHER_KINDS[:8])
shape('turns-that-are-skipped', '`continue`: the step is taken all the same.', 'from, n', 'let s = 0, i = from;\n  for (; i < n; i++) {\n    if (i % 2) continue;\n    s++;\n  }\n  return [s, i];', UP, OTHER_KINDS[:8])
shape('loop-left-by-a-return', 'What the counter held.', 'from, n', 'let turns = 0;\n  for (let i = from; i < n; i++) if (i % 3 === 2 || ++turns === 5) return i;\n  return "ended";', UP + NEVER_ENDING, OTHER_KINDS[:8])
shape('loop-left-by-a-throw', 'A handler around the loop sees the counter and the tally as they were.', 'from, n', 'let s = 0, i = from;\n  try {\n    for (; i < n; i++) {\n      if (s === 3) throw new RangeError("enough");\n      s++;\n    }\n  } catch (error) {\n    return [error.name, s, i];\n  }\n  return [s, i];', UP + NEVER_ENDING, OTHER_KINDS[:8])
shape('handler-in-every-turn', 'The loop goes on behind a throw.', 'from, n', 'let s = 0, caught = 0, i = from;\n  for (; i < n; i++) {\n    try {\n      if (i % 2) throw i;\n      s++;\n    } catch (thrown) {\n      caught += thrown;\n    }\n  }\n  return [s, caught, i];', UP, OTHER_KINDS[:6])
shape('bound-worked-out-in-the-test', '`i < n / 2`, `i < n - 1`, `i * i < n`.', 'n', 'let a = 0, b = 0, c = 0;\n  for (let i = 0; i < n / 2; i++) a++;\n  for (let i = 0; i < n - 1; i++) b++;\n  for (let i = 0; i * i < n; i++) c++;\n  return [a, b, c];', ['0', '1', '5', '6', '2.5', '-3', 'NaN', '-0', '30.25'], ['"5"', 'null', '[4]'])
shape('bound-that-is-the-smaller-of-two', '`Math.min(a, b)`, NaN and -0 among them.', 'a, b', 'let s = 0, i = 0;\n  for (; i < Math.min(a, b); i++) s++;\n  return [s, i];', ['3, 5', '5, 3', '3, NaN', 'NaN, 3', '0, -0', '2.5, 9', '3, Infinity', '-1, 3', f'4, {I53}'], ['"3", 5', '3, undefined', '3, null'])
shape('counter-as-a-key', 'The counter reads and stores elements on both sides of zero and of the end.', 'from, n', 'const list = [10, 20, 30];\n  const seen = [];\n  for (let i = from; i < n; i++) {\n    seen.push(list[i]);\n    if (i > 3) list[i] = i;\n  }\n  return [seen, list.length];', ['0, 3', '-2, 2', '0, 5', '2, 7', '0.5, 3', '-0, 2', f'{I32} - 3, {I32}', f'{I32} - 2, {I32} + 1', f'{I31} - 1, {I31} + 1'], ['"0", 2', '0, "2"'])
shape('counter-in-a-text', 'The counter is printed: -0, fractions and large numbers have their own looks.', 'from, n', 'let text = "";\n  for (let i = from; i < n; i++) text += i + ",";\n  return text;', UP, OTHER_KINDS[:6])
shape('big-integers-that-count', 'The same loop on BigInts, which no width ends.', 'from, n', 'let s = 0n, i = from;\n  for (; i < n; i++) s += i;\n  return [s, i];', [], ['0n, 5n', '0n, 5', '0n, 2.5', '0n, NaN', '2n ** 31n - 2n, 2n ** 31n + 2n', '2n ** 53n - 2n, 2n ** 53n + 2n', '2n ** 63n - 2n, 2n ** 63n + 2n', '2n ** 64n - 2n, 2n ** 64n + 2n', '-2n, 2n', '0n, "3"'], typed=False)

# ---- the counter starts at a number that is WRITTEN, as most do: it is an integer to the build, which the counters above, handed in, are not. The red controls say so: of four faults laid into a compiler
# (a sum taken for an integer past 2 ** 53 . a fraction rounded the wrong way . NaN admits every integer . the bound cut to 32 bits) the shapes above caught each by one to five shapes, all of them shapes that start at a written 0.
BOUNDS = ['0', '1', '5', '-1', '-0', '0.5', '2.5', '3.000000001', '2.999999999', 'NaN', '-Infinity', '-0.5', '1e-300', '40']
FAR_BOUNDS = ['Infinity', '1e300', f'{I31} - 1', f'{I31}', f'{I31} + 5', f'{I32}', f'{I32} + 5', f'{I53} - 1', f'{I53}', f'{I53} + 2', '2 ** 62', '2 ** 63', '2 ** 64', '1.7976931348623157e308']
KINDS_OF_BOUNDS = ['"5"', '"2.5"', '"abc"', '""', '" 3 "', 'null', 'undefined', 'true', 'false', '[3]', '[]', '{}', '{ valueOf: () => 3 }', '3n', 'Symbol()']
for name, says, test in [('less', '`i < n`.', 'i < n'), ('less-or-equal', '`i <= n`.', 'i <= n'), ('greater-written-first', '`n > i`.', 'n > i'), ('greater-or-equal-written-first', '`n >= i`.', 'n >= i'), ('not-greater-or-equal', '`!(i >= n)`, which NaN does not end.', '!(i >= n)'), ('not-the-same', '`i !== n`.', 'i !== n')]:
    shape('from-zero-while-' + name, 'The counter starts at a written 0. ' + says, 'n', f'let s = 0, i = 0;\n  for (; {test}; i++) if (++s === 45) break;\n  return [s, i];', BOUNDS + FAR_BOUNDS, KINDS_OF_BOUNDS)
shape('from-zero-with-nothing-else-in-the-loop', 'The counter starts at a written 0, and the loop has one way out.', 'n', 'let s = 0;\n  for (let i = 0; i < n; i++) s++;\n  return s;', BOUNDS, KINDS_OF_BOUNDS)
shape('from-zero-and-the-counter-behind-the-loop', 'The counter starts at a written 0.', 'n', 'let i = 0;\n  for (; i < n; i++);\n  return i;', BOUNDS, KINDS_OF_BOUNDS)
for name, start in [('one', '1'), ('minus-one', '-1'), ('minus-zero', '-0'), ('a-half', '0.5'), ('the-last-int32', '2147483647'), ('the-first-int32', '-2147483648'), ('three-below-2-to-the-31', '2147483645'), ('three-below-2-to-the-32', '4294967293'), ('three-below-2-to-the-53', '9007199254740989'), ('2-to-the-53', '9007199254740992'), ('three-over-minus-2-to-the-31', '-2147483651'), ('minus-2-to-the-53', '-9007199254740992')]:
    near = [f'{start} + {d}' for d in ('0', '1', '2', '3', '4', '6', '0.5', '2.5')] + [f'{start} - 1', 'NaN', 'Infinity', '-Infinity', '0', '-0']
    shape('up-from-' + name, f'The counter starts at a written {start}.', 'n', f'let s = 0, i = {start};\n  for (; i < n; i++) if (++s === 9) break;\n  return [s, i];', near, ['"5"', 'null', '3n'])
    shape('down-from-' + name, f'The counter starts at a written {start}.', 'n', f'let s = 0, i = {start};\n  for (; i > n; i--) if (++s === 9) break;\n  return [s, i];', [f'{start} - {d}' for d in ('0', '1', '2', '3', '4', '6', '0.5', '2.5')] + [f'{start} + 1', 'NaN', 'Infinity', '-Infinity', '0', '-0'], ['"5"', 'null', '3n'])
for name, border in [('2-to-the-31', '2147483648'), ('2-to-the-32', '4294967296'), ('2-to-the-53', '9007199254740992'), ('2-to-the-62', '4611686018427387904')]:
    shape('leap-to-just-below-' + name, f'The counter starts at a written 0 and is put two below {border} by a written number: it stays an integer to the build, and crosses the border in the loop.', 'n',
          f'let s = 0, i = 0;\n  for (; i < n; i++) {{\n    if (i === 2) i = {border} - 2;\n    if (++s === 9) break;\n  }}\n  return [s, i];', ['0', '2', '3', '2.5', f'{border} - 1', f'{border}', f'{border} + 1', f'{border} + 3', f'{border} * 2', 'Infinity', 'NaN', '1e300'])
    shape('leap-to-just-over-minus-' + name, f'Downwards, to two over -{border}.', 'n',
          f'let s = 0, i = 0;\n  for (; i > n; i--) {{\n    if (i === -2) i = -{border} + 2;\n    if (++s === 9) break;\n  }}\n  return [s, i];', ['0', '-2', '-3', '-2.5', f'-{border} + 1', f'-{border}', f'-{border} - 1', f'-{border} - 3', f'-{border} * 2', '-Infinity', 'NaN', '-1e300'])
for name, step in [('two', '2'), ('three', '3'), ('a-half', '0.5'), ('2-to-the-30', '1073741824'), ('2-to-the-31', '2147483648'), ('2-to-the-52', '4503599627370496'), ('2-to-the-53', '9007199254740992'), ('nothing', '0'), ('minus-one', '-1')]:
    shape('from-zero-by-' + name, f'A written step of {step}.', 'n', f'let s = 0, i = 0;\n  for (; i < n; i += {step}) if (++s === 9) break;\n  return [s, i];', BOUNDS + FAR_BOUNDS, ['"5"', 'null', '3n'])
for name, start in [('zero', '0'), ('minus-zero', '-0'), ('three-below-2-to-the-31', '2147483645'), ('three-below-2-to-the-32', '4294967293'), ('three-below-2-to-the-53', '9007199254740989'), ('three-over-minus-2-to-the-31', '-2147483645'), ('a-half', '0.5')]:
    for how, change in [('counting', 's++'), ('counting-down', 's--'), ('growing-by-the-counter', 's += i'), ('growing-by-2-to-the-30', 's += 1073741824'), ('growing-by-2-to-the-52', 's += 4503599627370496'), ('shrinking-by-2-to-the-30', 's -= 1073741824'), ('doubling', 's *= 2'), ('growing-by-a-length', 's += text.length')]:
        shape(f'tally-from-{name}-{how}', f'The tally starts at a written {start}: `{change}`.', 'n', f'const text = unknown("four");\n  let s = {start};\n  for (let i = 0; i < n; i++) {change};\n  return s;', ['0', '1', '2', '3', '4', '6', '2.5', 'NaN', '70'])
shape('tally-of-a-long-run-of-large-steps', 'The tally leaves 53 bits in the middle of a long loop.', 'n', 'let s = 0;\n  for (let i = 0; i < n; i++) s += 1073741823;\n  return s;', ['1', '2', '3', '8388607', '8388608', '8388609', '8388700', '9000000.5'])
shape('tally-under-a-test-of-a-long-run', 'As a program counts what it finds.', 'n', 'let found = 0, missed = 0;\n  for (let i = 0; i < n; i++) {\n    if (i % 3) found++;\n    else missed += 2;\n  }\n  return [found, missed];', ['0', '1', '10', '1000.5', '100000'])

# ---- a compiler may take eight turns at a time, and look for an interruption once in 2 ** 20 turns: the turns on both sides of those borders
TURNS = ['6', '7', '8', '9', '15', '16', '17', '23.5', '64', '65', '1048575', '1048576', '1048577', '1048583', '1048584', '1048585', '2097151', '2097152', '2097153', '2097160.5']
shape('turns-round-eight-and-2-to-the-20', 'The tally, the sum of the counter and the counter behind the loop.', 'n', 'let s = 0, t = 0, i = 0;\n  for (; i < n; i++) {\n    s++;\n    t += i;\n  }\n  return [s, t, i];', TURNS)
shape('turns-round-eight-and-2-to-the-20-from-a-sum-that-is-no-integer', 'Numbers are not added in another order: the sum starts at a fraction, or where an integer more is lost.', 'n, start', 'let s = start;\n  for (let i = 0; i < n; i++) s += i;\n  return s;',
      [f'{n}, {s}' for n in ('7', '8', '9', '17', '1048577') for s in ('0.1', '-0', f'{I53} - 3', f'{I53}', '1e16', '-0.5', '1e-9', 'NaN', 'Infinity')])
shape('turns-round-eight-and-2-to-the-20-left-in-the-middle', 'The loop is left in the middle of eight turns.', 'n, at', 'let s = 0, i = 0;\n  for (; i < n; i++) {\n    if (i === at) break;\n    s += 2;\n  }\n  return [s, i];', [f'{n}, {at}' for n in ('20', '1048600') for at in ('0', '3', '7', '8', '9', '15', '16', '19', '20', '1048575', '1048576', '1048577', '-1', '2.5', 'NaN')])
UNEVEN = [f'Array.from({{ length: {n} }}, (_, i) => i)' for n in (6, 7, 8, 9, 15, 16, 17, 33)]
UNEVEN += [f'Array.from({{ length: 20 }}, (_, i) => (i === {k} ? {v} : i))' for k in (0, 6, 7, 8, 9, 15, 16, 19) for v in ('0.5', '"x"', 'undefined', '-0', f'{I31}', 'NaN')]
UNEVEN += [f'(() => {{ const list = Array.from({{ length: 20 }}, (_, i) => i); delete list[{k}]; return list; }})()' for k in (0, 7, 8, 9, 19)]
lists('sum-of-a-list-with-one-odd-element', 'One element among integers is of another kind, or is missing, at each place in eight turns.', 'let s = 0;\n  for (let i = 0; i < list.length; i++) s += list[i];\n  return s;', UNEVEN)
lists('count-in-a-list-with-one-odd-element', 'The same lists, and a test of each element.', 'let s = 0;\n  for (let i = 0; i < list.length; i++) if (list[i] > 4) s++;\n  return s;', UNEVEN)
TEXTS = ['""', '"a"', '"a b c d"', '"seven c"', '"eight ch"', '"nine char"', '"a text of some length, with blanks in it"', '"\\u0416 \\u0416 wide"', '"x".repeat(17) + " "', '("ab " + unknown("cd ")).repeat(5)', '"a b".slice(1)', '"\\ud83d\\ude00 \\ud83d"']
lists('code-units-of-a-text', 'A text is read one code unit at a time: narrow, wide, a rope, a piece of another.', 'let s = 0, t = 0;\n  for (let i = 0; i < list.length; i++) {\n    if (list.charCodeAt(i) === 32) s++;\n    t += list.charCodeAt(i);\n  }\n  return [s, t];', TEXTS)
lists('characters-of-a-text', '`text[i]`, one past the end too.', 'let s = "";\n  for (let i = 0; i <= list.length; i++) s = list[i] + s;\n  return s;', TEXTS)

def rows_of(rows): return '[\n' + ''.join(f'  [{row}],\n' for row in rows) + ']'
def program(s, form):
    typed = form == 'typed'
    names = [p.strip() for p in s['parameters'].split(',')]
    rows = s['numbers'] + (s['others'] if form == 'anything' else [])
    signature = ', '.join(f'{p}: number' for p in names) if typed else s['parameters']
    handed = ', '.join((f'given[{k}]' if form == 'anything' else f'+given[{k}]') for k in range(len(names)))
    more = s['more']
    text = f'// A loop that counts. {s["says"]}\n'
    text += {'anything': '// The values arrive as they are, of every kind.\n', 'numbers': '// Every operand is a number, of which the build knows nothing else.\n', 'typed': '// Every operand is declared a number.\n'}[form]
    text += (TYPED_HEAD if typed else HEAD) + more
    body = s['body'].replace('catch (error)', 'catch (error: any)').replace('catch (thrown)', 'catch (thrown: any)') if typed else s['body']
    text += f'function run({signature}){": any" if typed else ""} {{\n  {body}\n}}\n'
    text += f'for (const given of unknown({rows_of(rows)})) {{\n  let answer;\n  try {{\n    answer = show(run({handed}));\n  }} catch (error{": any" if typed else ""}) {{\n    answer = "throws " + error.name;\n  }}\n  console.log(given.map(show).join(", ") + " => " + answer);\n}}\n'
    return text
n = 0
for s in shapes:
    forms = []
    if s['others']: forms.append('anything')
    if s['numbers']: forms.append('numbers')
    if s['numbers'] and s['typed']: forms.append('typed')
    for form in forms:
        name = s['name'] + {'anything': '-of-anything.js', 'numbers': '-of-numbers.js', 'typed': '-typed.ts'}[form]
        open(os.path.join(out, name), 'w').write(program(s, form)); n += 1
print(len(shapes), 'shapes,', n, 'programs')
