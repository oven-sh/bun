#!/usr/bin/env python3
# generate-counters-that-enter-as-numbers.py <folder>: all 32; ../parallel/counters-that-enter-as-numbers/ holds 1 of them, which a fault laid into the compiler on purpose has turned red.
# The counter of a loop enters as a number that the text calls `number` and that every call hands over as a number.
# A compiler may ask it for a 32-bit integer once in front of the loop and count on integers. Each program enters its loop with small integers and then with -0, fractions, NaN, the ends of the 32-bit integers, numbers past them and infinities.
import os, sys
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
HEAD = '''const shown: string[] = [];
function show(value: unknown): void {
  shown.push(Object.is(value, -0) ? "-0" : String(value));
}
'''
count = 0
def program(name, says, text):
    global count
    open(os.path.join(out, name + '.ts'), 'w').write('// ' + says + '\n' + HEAD + text.strip('\n') + '\nconsole.log(shown.join(" "));\n')
    count += 1

ENTERING = ['0', '1', '5', '-0', '-1', '-5', '1.5', '-1.5', '0.25', 'NaN', '2147483640', '2147483646', '2147483647', '2147483648', '4294967295', '4294967296', '9007199254740991', '9007199254740992', '1e300', 'Infinity', '-Infinity', '-2147483648', '-2147483649', '-2147483640']
def calls(pattern, values=ENTERING):
    return '\n'.join('show(' + pattern.replace('@', v) + ');' for v in values)

HELD = {
    'a-text': ('text: string', 'text.length', 'text.charCodeAt(at) === 10', 'const held = "abc\\ndefgh\\nij";'),
    'bytes': ('bytes: Uint8Array', 'bytes.length', 'bytes[at] === 10', 'const held = new Uint8Array([97, 98, 99, 10, 100, 101, 102, 103, 104, 10, 105, 106]);'),
    'a-list': ('codes: number[]', 'codes.length', 'codes[at] === 10', 'const held = [97, 98, 99, 10, 100, 101, 102, 103, 104, 10, 105, 106];'),
}
for kind, (parameter, length, test, made) in HELD.items():
    program(f'a-scan-over-{kind}-goes-up-from-where-it-is-told', 'The scan returns the counter itself: -0 stays -0 only where no turn has stepped it.', f'''
function scan({parameter}, from: number): number {{
  let turns = 0;
  for (let at = from; at < {length}; at++) {{
    if (++turns > 40) return -2;
    if ({test}) return at;
  }}
  return -1;
}}
{made}
{calls('scan(held, @)')}
''')
    program(f'a-scan-over-{kind}-goes-down-from-where-it-is-told', 'The counter steps down; from past the end nothing is found until it is inside.', f'''
function scan({parameter}, from: number): number {{
  let turns = 0;
  for (let at = from; at >= 0; at--) {{
    if (++turns > 40) return -2;
    if ({test}) return at;
  }}
  return -1;
}}
{made}
{calls('scan(held, @)')}
''')
    program(f'a-scan-over-{kind}-steps-by-one-or-by-two', 'Two ways round, each by a written whole number.', f'''
function scan({parameter}, from: number): string {{
  let turns = 0, found = 0, at = from;
  while (at < {length}) {{
    if (++turns > 40) break;
    if ({test}) {{
      found++;
      at += 2;
      continue;
    }}
    at++;
  }}
  return found + ":" + (Object.is(at, -0) ? "-0" : at);
}}
{made}
{calls('scan(held, @)')}
''')

for step, name in (('at += 3', 'three-up'), ('at -= 3', 'three-down'), ('at = at + 7', 'seven-up'), ('at = 2 + at', 'two-up-written-in-front'), ('at = at - 1', 'one-down-written-out')):
    down = 'down' in name
    program(f'a-counter-steps-{name}', 'The sum of what the counter was says where it went.', f'''
function walk(from: number, to: number): string {{
  let turns = 0, sum = 0;
  for (let at = from; {'at > to' if down else 'at < to'}; {step}) {{
    if (++turns > 12) return "many:" + sum;
    sum += at;
  }}
  return "end:" + (Object.is(sum, -0) ? "-0" : sum);
}}
{calls('walk(@, ' + ('-20' if down else '20') + ')')}
{calls('walk(' + ('2147483647' if down else '2147483640') + ', @)')}
{calls('walk(' + ('-2147483640' if down else '-2147483648') + ', @)')}
''')

program('the-counter-runs-over-the-end-of-the-32-bit-integers', 'The bound lies past the largest 32-bit integer: the counter has to go on as a number.', '''
function count(from: number, to: number): string {
  let last = -1, turns = 0;
  for (let at = from; at < to; at++) {
    last = at;
    turns++;
  }
  return turns + ":" + last;
}
show(count(2147483640, 2147483660));
show(count(2147483647, 2147483649));
show(count(2147483646, 2147483647));
show(count(2147483646, 2147483648));
show(count(4294967290, 4294967300));
show(count(0, 3));
show(count(-3, 3.5));
show(count(0.5, 3));
show(count(9007199254740990, 9007199254740992));
''')
program('the-counter-runs-under-the-end-of-the-32-bit-integers', 'The bound lies below the smallest 32-bit integer.', '''
function count(from: number, to: number): string {
  let last = 1, turns = 0;
  for (let at = from; at > to; at--) {
    last = at;
    turns++;
  }
  return turns + ":" + last;
}
show(count(-2147483640, -2147483660));
show(count(-2147483648, -2147483650));
show(count(-2147483647, -2147483648));
show(count(-2147483647, -2147483649));
show(count(3, 0));
show(count(3, -3.5));
show(count(2.5, 0));
''')
program('the-counter-is-divided-into-one', 'One over the counter tells 0 from -0 in the first turn.', f'''
function first(from: number): number {{
  for (let at = from; at < 3; at++) return 1 / at;
  return 7;
}}
function second(from: number): number {{
  let turns = 0;
  for (let at = from; at < 3; at++) if (turns++) return 1 / at;
  return 7;
}}
{calls('first(@)')}
{calls('second(@)')}
''')
program('the-counter-is-kept-behind-the-loop', 'What the counter holds behind the loop is read there.', f'''
function run(from: number, to: number): string {{
  let at = from, turns = 0;
  for (; at < to; at++) if (++turns > 9) break;
  return (Object.is(at, -0) ? "-0" : at) + "/" + turns;
}}
{calls('run(@, 4)')}
{calls('run(2147483645, @)')}
''')
program('closures-made-in-the-turns-hold-the-counter', 'Each turn has a counter of its own.', f'''
function make(from: number): string {{
  const made: (() => number)[] = [];
  let turns = 0;
  for (let at = from; at < 4; at++) {{
    if (++turns > 5) break;
    made.push(() => at);
  }}
  return made.map(one => (Object.is(one(), -0) ? "-0" : String(one()))).join(",");
}}
{calls('make(@)')}
''')
program('the-counter-is-stored-in-fields-and-lists', 'The counter leaves the loop through a field, a list and a view of doubles.', f'''
class Mark {{ at = 0.5; }}
function run(from: number): string {{
  const mark = new Mark(), list: number[] = [], view = new Float64Array(3);
  let turns = 0;
  for (let at = from; at < 3; at++) {{
    if (++turns > 3) break;
    mark.at = at;
    list.push(at);
    view[turns - 1] = at;
  }}
  return [mark.at, ...list, ...view].map(one => (Object.is(one, -0) ? "-0" : String(one))).join(",");
}}
{calls('run(@)')}
''')
program('the-loop-ends-where-the-counter-is-the-bound', 'The test is an inequality: a fraction never meets the bound.', f'''
function run(from: number, to: number): string {{
  let turns = 0;
  for (let at = from; at !== to; at++) if (++turns > 9) return "many";
  return "met:" + turns;
}}
{calls('run(@, 3)')}
{calls('run(2147483645, @)')}
''')
program('two-counters-enter-as-numbers', 'One goes up and one goes down until they meet.', f'''
function meet(low: number, high: number): string {{
  let turns = 0;
  while (low < high) {{
    if (++turns > 9) return "many:" + low + ":" + high;
    low++;
    high--;
  }}
  return (Object.is(low, -0) ? "-0" : low) + ":" + (Object.is(high, -0) ? "-0" : high);
}}
{calls('meet(@, 6)')}
{calls('meet(-6, @)')}
{calls('meet(@, @)')}
''')
program('the-counter-of-a-loop-inside-enters-as-the-counter-outside', 'The loop inside begins where the loop outside stands.', f'''
function pairs(from: number, to: number): string {{
  let sum = 0, turns = 0;
  for (let a = from; a < to; a++) {{
    for (let b = a; b < to; b++) {{
      if (++turns > 30) return "many:" + sum;
      sum += a * 10 + b;
    }}
  }}
  return "sum:" + sum;
}}
{calls('pairs(@, 3)')}
{calls('pairs(2147483645, @)')}
''')
program('the-counter-comes-out-of-a-field-a-floor-and-a-division', 'What enters is computed: nothing in the text says that it is whole.', '''
class Span { constructor(public start: number, public end: number) {} }
function run(span: Span): string {
  let sum = 0, turns = 0;
  for (let at = span.start; at < span.end; at++) {
    if (++turns > 9) return "many:" + sum;
    sum += at;
  }
  return "sum:" + sum;
}
function floored(x: number): string {
  let sum = 0, turns = 0;
  for (let at = Math.floor(x); at < 4; at++) {
    if (++turns > 9) return "many:" + sum;
    sum += at;
  }
  return "sum:" + (Object.is(sum, -0) ? "-0" : sum);
}
function halved(x: number): string {
  let sum = 0, turns = 0;
  for (let at = x / 2; at < 4; at++) {
    if (++turns > 9) return "many:" + sum;
    sum += at;
  }
  return "sum:" + sum;
}
for (const [start, end] of [[0, 3], [1.5, 4], [6 / 3, 10 / 2], [-0, 2], [2147483646, 2147483650], [NaN, 3], [0, NaN], [-Infinity, 3]]) show(run(new Span(start!, end!)));
for (const x of [0, 0.9, -0.5, -0, 3.99, 4294967296.5, NaN, -Infinity, 2147483647.5]) show(floored(x));
for (const x of [0, 1, 2, 3, -0, -1, 4294967296, NaN]) show(halved(x));
''')
program('a-word-that-enters-as-a-number-comes-round-out-of-a-bit-operator', 'The first turn takes the number as it enters; every later turn takes a 32-bit integer.', f'''
function mix(seed: number, text: string): string {{
  let word = seed;
  for (let at = 0; at < text.length; at++) word = (word * 31 + text.charCodeAt(at)) | 0;
  return Object.is(word, -0) ? "-0" : String(word);
}}
function fold(seed: number, turns: number): string {{
  let word = seed, first = "none";
  for (let at = 0; at < turns; at++) {{
    if (!at) first = Object.is(word, -0) ? "-0" : String(word);
    word = (word >>> 3) ^ (word << 2);
  }}
  return first + ":" + (Object.is(word, -0) ? "-0" : word);
}}
{calls('mix(@, "ab")')}
{calls('mix(@, "")')}
{calls('fold(@, 2)')}
{calls('fold(@, 0)')}
''')
program('a-call-that-nobody-knows-stands-in-the-turns', 'The turns run other code; the counter is a local all the same.', f'''
const seen: string[] = [];
(globalThis as any).note = (value: number) => {{ seen.push(Object.is(value, -0) ? "-0" : String(value)); }};
function run(from: number): number {{
  let turns = 0;
  for (let at = from; at < 3; at++) {{
    if (++turns > 4) break;
    (globalThis as any).note(at);
  }}
  return turns;
}}
{calls('run(@)')}
show(seen.join(","));
''')
program('the-loop-stands-under-a-handler-and-throws-the-counter', 'What is thrown is the counter.', f'''
function run(from: number): string {{
  try {{
    for (let at = from; at < 9; at++) if (at > 1 || at !== at || at < -3) throw at;
    return "end";
  }} catch (thrown) {{
    return "thrown:" + (Object.is(thrown, -0) ? "-0" : thrown);
  }}
}}
{calls('run(@)')}
''')
program('the-loop-awaits-in-its-turns', 'A loop that suspends keeps its counter across the wait.', f'''
async function run(from: number): Promise<string> {{
  let sum = 0, turns = 0;
  for (let at = from; at < 3; at++) {{
    if (++turns > 4) break;
    sum += await Promise.resolve(at);
  }}
  return (Object.is(sum, -0) ? "-0" : sum) + "/" + turns;
}}
for (const from of [{', '.join(ENTERING)}]) show(await run(from));
''')
program('a-generator-yields-its-counter', 'The counter is handed out at every turn.', f'''
function* up(from: number, to: number): Generator<number> {{
  for (let at = from; at < to; at++) yield at;
}}
function take(from: number): string {{
  const taken: string[] = [];
  for (const one of up(from, 3)) {{
    taken.push(Object.is(one, -0) ? "-0" : String(one));
    if (taken.length > 3) break;
  }}
  return taken.join(",");
}}
{calls('take(@)')}
''')
program('the-counter-is-also-a-key-of-an-object', 'A fraction and -0 name other properties than the integers do.', f'''
function run(from: number): string {{
  const bag: Record<string, number> = {{ "0": 10, "1": 11, "2": 12, "1.5": 15, "-1": 9, "NaN": 1, "2147483648": 2 }};
  let sum = 0, turns = 0;
  for (let at = from; at < 3 || at === 2147483648; at++) {{
    if (++turns > 4) break;
    sum += bag[at] ?? 100;
  }}
  return sum + "/" + turns;
}}
{calls('run(@)')}
''')
program('the-bound-moves-in-the-turns', 'The list grows and shrinks while it is walked.', f'''
function run(from: number): string {{
  const list = [1, 2, 3, 4];
  let sum = 0, turns = 0;
  for (let at = from; at < list.length; at++) {{
    if (++turns > 12) break;
    sum += list[at] ?? 50;
    if (turns === 1) list.push(5, 6);
    if (turns === 3) list.length = 4;
  }}
  return sum + "/" + turns;
}}
{calls('run(@)')}
''')
program('the-counter-is-a-number-or-a-big-integer', 'The same text counts on both kinds.', '''
function run(from: number | bigint, to: number | bigint): string {
  let turns = 0, at = from;
  for (; at < to; at++) if (++turns > 5) break;
  return typeof at + ":" + at + "/" + turns;
}
show(run(0, 3)); show(run(0n, 3n)); show(run(1.5, 3n)); show(run(2147483646, 2147483649n)); show(run(2147483646n, 2147483649)); show(run(-0, 1)); show(run(NaN, 3n));
''')
print(count, 'programs')
