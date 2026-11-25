#!/usr/bin/env python3
# generate-counters-stepped-by-what-is-not-written.py <folder>: all 28; ../parallel/counters-stepped-by-what-is-not-written/ holds 3 of them, which a fault laid into the compiler on purpose has turned red.
# The counter of a loop is stepped by what a call gives, by another variable, by an element of a view: by a 32-bit integer that no text names.
# A compiler may count on 32-bit integers all the same, as long as it asks on the way round whether the sum still is one. Each program steps inside the 32-bit integers, and then over either end of them in the middle of its loop;
# what the turns have done by then (a log, a sum) has to go on as if nothing had happened.
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
ENTERING = ['0', '1', '3', '-0', '-1', '-4', '1.5', 'NaN', '2147483640', '2147483647', '2147483648', '4294967296', '-2147483648', '-2147483649', 'Infinity']
def calls(pattern, values=ENTERING):
    return '\n'.join('show(' + pattern.replace('@', v) + ');' for v in values)

program('a-scan-steps-by-the-width-of-what-it-finds', 'A line ends in one character or in two; the scan goes on behind it.', f'''
function widthOfBreak(text: string, at: number): number {{
  const code = text.charCodeAt(at);
  if (code === 10) return 1;
  if (code === 13) {{
    if (at + 1 >= text.length) return -1;
    return text.charCodeAt(at + 1) === 10 ? 2 : 1;
  }}
  return 0;
}}
function findGap(text: string, from: number): string {{
  let at = from, turns = 0;
  while (at < text.length) {{
    if (++turns > 60) return "many";
    const first = widthOfBreak(text, at);
    if (first === 0) {{
      at++;
      continue;
    }}
    if (first === -1) return "waits";
    const behind = at + first;
    if (behind >= text.length) return "ends";
    const second = widthOfBreak(text, behind);
    if (second === -1) return "waits";
    if (second > 0) return at + ".." + (behind + second);
    at = behind;
  }}
  return "none";
}}
for (const text of ["ab\\ncd\\n\\nef", "ab\\r\\ncd\\r\\n\\r\\nef", "ab\\rcd\\r", "\\n\\n", "abc", "", "a\\n\\rb"]) {{
{calls('findGap(text, @)')}
}}
''')

for name, limit, steps in (('up-over-the-largest', '4294967296', '[1, 5, 1073741824, 1073741824, 1073741824, 7, 1]'), ('down-under-the-smallest', '-4294967296', '[-1, -5, -1073741824, -1073741824, -1073741824, -7, -1]'), ('to-and-fro-inside', '40', '[3, -1, 4, -2, 9, 1, 2]')):
    down = limit.startswith('-')
    program(f'a-counter-stepped-by-elements-of-a-view-goes-{name}', 'The log holds every place where the counter stood.', f'''
const steps = new Int32Array({steps});
function walk(from: number): string {{
  const log: string[] = [];
  let turn = 0;
  for (let at = from; {'at > ' + limit if down else 'at < ' + limit}; at += {'steps[turn % steps.length]!' if name == 'to-and-fro-inside' else '(steps[turn % steps.length]! | 0)'}) {{
    if (++turn > 9) break;
    log.push(Object.is(at, -0) ? "-0" : String(at));
  }}
  return log.join(",");
}}
{calls('walk(@)')}
''')

program('a-counter-stepped-by-what-a-call-gives-reads-bytes', 'Each byte says how far the next one lies.', f'''
function stride(bytes: Uint8Array, at: number): number {{
  return (bytes[at] ?? 1) | 0;
}}
function hop(bytes: Uint8Array, from: number): string {{
  let sum = 0, turns = 0, at = from;
  while (at < bytes.length) {{
    if (++turns > 20) return "many:" + sum;
    sum += bytes[at] ?? 100;
    at += stride(bytes, at);
  }}
  return sum + "@" + at;
}}
const bytes = new Uint8Array([2, 9, 3, 9, 9, 1, 4, 9, 9, 9, 1, 1]);
{calls('hop(bytes, @)')}
''')

program('a-counter-stepped-by-another-variable', 'The step itself changes from turn to turn.', f'''
function grow(list: number[], from: number, first: number): string {{
  const seen: unknown[] = [];
  let step = first | 0, turns = 0;
  for (let at = from; at < 3000000000; at += step) {{
    if (++turns > 12) break;
    seen.push(list[at] ?? "-");
    step = (step * 8) | 0;
    if (step <= 0) step = 1073741823;
  }}
  return seen.join();
}}
const list = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
{calls('grow(list, @, 1)')}
{calls('grow(list, 0, @)')}
''')

program('what-the-turn-has-done-stands-when-the-counter-leaves-the-integers', 'A turn writes into a list, a field and a view and then steps over the end: no turn runs twice, none is left out.', '''
class Tally { turns = 0; last = 0.5; }
function run(from: number, step: number, limit: number): string {
  const tally = new Tally(), places: number[] = [], marks = new Float64Array(8);
  for (let at = from; at < limit; at += step | 0) {
    if (tally.turns >= 8) break;
    places.push(at);
    marks[tally.turns] = at;
    tally.turns++;
    tally.last = at;
  }
  return [tally.turns, tally.last, places.join("/"), marks.join("/")].join(" ");
}
show(run(0, 3, 10));
show(run(2147483000, 300, 2147485000));
show(run(2147483646, 1, 2147483652));
show(run(2147483647, 2147483647, 9000000000));
show(run(-2147483648, 2147483647, 5000000000));
show(run(1.5, 2, 9));
show(run(-0, 1, 2));
''')

program('two-ways-round-one-written-and-one-not', 'One way steps by one, the other by what a function gives.', f'''
function jump(at: number): number {{
  return at % 3 === 0 ? 1000000000 : 2;
}}
function run(text: string, from: number): string {{
  const log: unknown[] = [];
  let at = from, turns = 0;
  while (at < 5000000000) {{
    if (++turns > 10) break;
    log.push(at, text.charCodeAt(at));
    if (at % 2) {{
      at++;
      continue;
    }}
    at += jump(at) | 0;
  }}
  return log.join();
}}
{calls('run("abcdefgh", @)')}
''')

program('the-counter-is-read-behind-the-loop-that-it-left-as-a-number', 'Behind the loop the counter is past the 32-bit integers.', f'''
function past(from: number, step: number): number {{
  let at = from, turns = 0;
  const bytes = new Uint8Array(4);
  while (at < 6000000000 && ++turns < 9) {{
    bytes[at & 3] = at;
    at += step | 0;
  }}
  return at + bytes[0]! + bytes[1]! / 1000;
}}
{calls('past(@, 2000000000)')}
{calls('past(@, -2000000000)')}
{calls('past(5, @)')}
''')

program('a-loop-inside-steps-by-what-is-not-written', 'The loop outside hands its counter to the loop inside.', f'''
const widths = new Int32Array([1, 2, 3, 1000000000]);
function pairs(text: string, from: number): string {{
  const log: unknown[] = [];
  let turns = 0;
  for (let a = from; a < 4; a++) {{
    for (let b = a; b < 3000000000; b += widths[b & 3]! | 0) {{
      if (++turns > 24) return log.join() + "many";
      log.push(text.charCodeAt(b));
    }}
    log.push(";");
  }}
  return log.join();
}}
{calls('pairs("abcdef", @)')}
''')

program('the-counter-enters-as-anything', 'Nothing is known of what enters: a text and undefined enter as well.', '''
function width(at: number): number {
  return (at & 1) + 1;
}
function run(text: string, from: any): string {
  const log: unknown[] = [];
  let at = from, turns = 0;
  while (at < text.length) {
    if (++turns > 8) break;
    log.push(text.charCodeAt(at));
    at += width(at);
  }
  return log.join() + typeof at + ":" + at;
}
for (const from of [0, 1, -1, 1.5, "1", "x", undefined, null, true, 2147483647, -0, NaN, 3n]) {
  try {
    show(run("abcdefgh", from));
  } catch (error) {
    show(error instanceof TypeError ? "a type error" : "another error");
  }
}
''')
program('an-object-made-anew-in-each-turn-goes-round-with-the-counter', 'What the last turn made is read behind the loop.', f"""
function run(text: string, from: number, step: number): string {{
  let state = {{ sum: 0, last: -1 }}, turns = 0;
  for (let at = from; at < 5000000000; at += step | 0) {{
    if (++turns > 6) break;
    state = {{ sum: state.sum + (text.charCodeAt(at) || 0), last: at }};
  }}
  return state.sum + ":" + state.last;
}}
{calls('run("abcdefgh", @, 1)')}
{calls('run("abcdefgh", @, 1000000000)')}
{calls('run("abcdefgh", 2, @)')}
""")

program('closures-made-in-the-turns-hold-the-counter', 'Each turn has a counter of its own, and a closure keeps it.', f"""
function run(text: string, from: number, step: number): string {{
  const readers: (() => string)[] = [];
  for (let at = from; at < 5000000000; at += step | 0) {{
    if (readers.length >= 5) break;
    readers.push(() => at + "=" + text.charCodeAt(at));
  }}
  return readers.map(reader => reader()).join();
}}
{calls('run("abcdefgh", @, 2)')}
{calls('run("abcdefgh", @, 1500000000)')}
""")

program('the-loop-yields-in-the-middle-of-a-turn', 'Whoever steps the generator sees every place once.', f"""
function* places(text: string, from: number, step: number): Generator<string, string, number> {{
  let at = from, turns = 0;
  while (at < 5000000000) {{
    if (++turns > 6) return "many";
    const more = yield at + "=" + text.charCodeAt(at);
    at += (step + more) | 0;
  }}
  return "done:" + at;
}}
function run(from: number, step: number): string {{
  const log: string[] = [], steps = places("abcdefgh", from, step);
  for (let result = steps.next(0), turn = 0; ; result = steps.next(++turn & 1)) {{
    log.push(result.value);
    if (result.done) break;
  }}
  return log.join();
}}
{calls('run(@, 1)')}
{calls('run(@, 1200000000)')}
""")

program('the-loop-awaits-in-the-middle-of-a-turn', 'The counter goes over the end while the function is asleep between two turns.', f"""
async function run(text: string, from: number, step: number): Promise<string> {{
  const log: unknown[] = [];
  let at = from, turns = 0;
  while (at < 5000000000) {{
    if (++turns > 6) break;
    log.push(text.charCodeAt(at));
    at += (await Promise.resolve(step)) | 0;
    log.push(at);
  }}
  return log.join();
}}
for (const from of [{', '.join(ENTERING)}]) {{
  show(await run("abcdefgh", from, 1));
  show(await run("abcdefgh", from, 1300000000));
}}
""")

program('a-try-and-a-finally-stand-round-the-step', 'The step throws now and then; the finally runs once a turn whatever happens.', f"""
function width(at: number): number {{
  if (at % 5 === 4) throw new RangeError("at " + at);
  return at % 3 === 0 ? 1100000000 : 3;
}}
function run(text: string, from: number): string {{
  const log: unknown[] = [];
  let at = from, turns = 0;
  while (at < 5000000000) {{
    if (++turns > 9) break;
    try {{
      log.push(text.charCodeAt(at));
      at += width(at) | 0;
    }} catch (error) {{
      log.push((error as RangeError).message);
      at++;
      continue;
    }} finally {{
      log.push("f");
    }}
    log.push(at);
  }}
  return log.join();
}}
{calls('run("abcdefgh", @)')}
""")

program('a-text-grows-in-the-loop-beside-the-counter', 'The text that has grown by then goes on growing.', f"""
function run(text: string, from: number, step: number): string {{
  let log = "", turns = 0;
  for (let at = from; at < 5000000000; at += step | 0) {{
    if (++turns > 7) break;
    log += text.charCodeAt(at) + "," + at + ";";
  }}
  return log;
}}
{calls('run("abcdefgh", @, 1)')}
{calls('run("abcdefgh", @, 900000000)')}
""")

program('a-for-of-steps-a-counter-by-its-elements', 'The counter is no part of the iteration; it goes round with it.', f"""
function run(text: string, from: number, widths: Iterable<number>): string {{
  const log: unknown[] = [];
  let at = from;
  for (const width of widths) {{
    log.push(text.charCodeAt(at), at);
    at += width | 0;
  }}
  return log.join() + "|" + at;
}}
const small = [1, 2, 1, 3], large = [1, 2000000000, 2000000000, 1, 2000000000], down = new Set([-1, -2000000000, -2000000001, 5]);
{calls('run("abcdefgh", @, small)')}
{calls('run("abcdefgh", @, large)')}
{calls('run("abcdefgh", @, down)')}
""")

program('the-loop-outside-is-stepped-by-what-the-loop-inside-finds', 'A labeled continue leaves the loop inside with the step in its hand.', f"""
function run(text: string, from: number, far: number): string {{
  const log: unknown[] = [];
  let turns = 0, at = from;
  outside: while (at < 5000000000) {{
    if (++turns > 8) break;
    log.push(at);
    for (let width = 1; width < 4; width++) {{
      if (text.charCodeAt(at + width) === 32) {{
        at += (width + 1) | 0;
        continue outside;
      }}
    }}
    at += far | 0;
  }}
  return log.join();
}}
{calls('run("ab cde f  ghijk l", @, 4)')}
{calls('run("ab cde f  ghijk l", @, 1700000000)')}
""")

program('a-switch-steps-the-counter-in-several-ways', 'Some cases fall into the next one and step twice.', f"""
function run(codes: Uint8Array, from: number, far: number): string {{
  const log: unknown[] = [];
  let at = from, turns = 0;
  while (at < 5000000000) {{
    if (++turns > 9) break;
    const code = codes[at];
    log.push(at, code);
    switch (code) {{
      case 1:
        at += code | 0;
      case 2:
        at += (codes[0]! + 1) | 0;
        break;
      case 3:
        at++;
        break;
      default:
        at += far | 0;
    }}
  }}
  return log.join();
}}
const codes = new Uint8Array([1, 2, 3, 1, 0, 3, 2, 1, 1, 3]);
{calls('run(codes, @, 1)')}
{calls('run(codes, @, 1900000000)')}
""")

program('two-counters-are-stepped-so-and-one-leaves-before-the-other', 'The one that stays goes on as it did.', f"""
function run(text: string, from: number, first: number, second: number): string {{
  const log: unknown[] = [];
  let a = from, b = from, turns = 0;
  while (a < 9000000000 && b > -9000000000) {{
    if (++turns > 8) break;
    log.push(text.charCodeAt(a), text.charCodeAt(b), a, b);
    a += first | 0;
    b += second | 0;
  }}
  return log.join();
}}
{calls('run("abcdefgh", @, 1, 1)')}
{calls('run("abcdefgh", @, 1000000000, 1)')}
{calls('run("abcdefgh", @, 1, -1000000000)')}
{calls('run("abcdefgh", @, 700000000, -1100000000)')}
""")

program('a-loop-that-asks-at-its-foot', 'The first turn runs whatever enters.', f"""
function run(text: string, from: number, step: number): string {{
  const log: unknown[] = [];
  let at = from, turns = 0;
  do {{
    log.push(text.charCodeAt(at), at);
    at += step | 0;
  }} while (at < 5000000000 && ++turns < 6);
  return log.join();
}}
{calls('run("abcdefgh", @, 2)')}
{calls('run("abcdefgh", @, 1400000000)')}
""")

program('the-step-is-a-whole-number-that-need-not-be-a-32-bit-integer', 'Math.floor gives numbers without a fraction: large ones, NaN, the infinities and -0 among them.', f"""
function run(text: string, from: number, widths: Float64Array): string {{
  const log: unknown[] = [];
  let at = from, turns = 0;
  while (at < 1e300) {{
    if (turns >= widths.length) break;
    log.push(text.charCodeAt(at), Object.is(at, -0) ? "-0" : at);
    at += Math.floor(widths[turns++]!);
  }}
  return log.join() + "|" + (Object.is(at, -0) ? "-0" : at);
}}
for (const widths of [[1.5, 2.5, 1], [1, 3e9, 1, -3e9, 1], [1, -0, -1, -0, -0.5], [2, NaN, 1], [2, Infinity, 1], [1, -Infinity, 1], [2147483647, 1, -1, -2147483648, -2147483648, -1], [0.25, 0.5, -0.25]]) {{
  const view = new Float64Array(widths);
{calls('run("abcdefgh", @, view)', ['0', '1', '-0', '-1', '2147483647', '-2147483648', '1.5', 'NaN'])}
}}
""")

program('the-counter-is-the-key-of-a-store', 'What lies past the 32-bit integers is a name like any other.', f"""
function run(from: number, step: number): string {{
  const record: Record<number, number> = {{}}, list: number[] = [], view = new Int16Array(6);
  let at = from, turns = 0;
  while (at < 9000000000) {{
    if (++turns > 5) break;
    record[at] = turns;
    if (at >= 0 && at < 20) list[at] = turns;
    view[at] = turns;
    at += step | 0;
  }}
  return JSON.stringify(record) + list.join("/") + view.join("/");
}}
{calls('run(@, 1)')}
{calls('run(@, 2)')}
{calls('run(@, 2100000000)')}
""")

program('the-counter-goes-round-out-of-a-choice', 'One expression gives the next place, on either side of a question mark.', f"""
function width(code: number): number {{
  return code > 100 ? 1600000000 : 2;
}}
function run(text: string, from: number): string {{
  const log: unknown[] = [];
  let turns = 0;
  for (let at = from; at < 5000000000; at = text.charCodeAt(at) % 2 ? at + 1 : at + (width(text.charCodeAt(at)) | 0)) {{
    if (++turns > 9) break;
    log.push(at);
  }}
  return log.join();
}}
{calls('run("abcdefgh", @)')}
{calls('run("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", @)')}
""")
program('a-try-and-a-finally-stand-in-the-turn-in-front-of-the-step', 'Some turns throw and catch; each of them steps once.', f"""
function width(at: number): number {{
  return at % 3 === 0 ? 1100000000 : 3;
}}
function run(text: string, from: number): string {{
  const log: unknown[] = [];
  let at = from, turns = 0;
  while (at < 5000000000) {{
    if (++turns > 9) break;
    try {{
      log.push(text.charCodeAt(at));
      if (at % 5 === 4) throw new RangeError("at " + at);
    }} catch (error) {{
      log.push((error as RangeError).message);
    }} finally {{
      log.push("f");
    }}
    at += width(at) | 0;
  }}
  return log.join();
}}
{calls('run("abcdefgh", @)')}
""")

program('a-loop-inside-finds-the-step-of-the-loop-outside', 'The step is whatever the loop inside has left in a variable.', f"""
function run(text: string, from: number, far: number): string {{
  const log: unknown[] = [];
  let turns = 0, at = from;
  while (at < 5000000000) {{
    if (++turns > 8) break;
    log.push(at);
    let step = far;
    for (let width = 1; width < 4; width++) {{
      if (text.charCodeAt(at + width) === 32) {{
        step = width + 1;
        break;
      }}
    }}
    at += step | 0;
  }}
  return log.join();
}}
{calls('run("ab cde f  ghijk l", @, 4)')}
{calls('run("ab cde f  ghijk l", @, 1700000000)')}
""")

program('the-step-is-a-product-of-integers', 'A product of two 32-bit integers has no fraction, and it need not be a 32-bit integer: it may be -0 as well.', f"""
function times(a: number, b: number): number {{
  return (a | 0) * (b | 0);
}}
function run(text: string, from: number, scale: number): string {{
  const log: unknown[] = [];
  let at = from, turns = 0;
  while (at < 1e18 && at > -1e18) {{
    if (++turns > 7) break;
    log.push(text.charCodeAt(at), Object.is(at, -0) ? "-0" : at);
    at += times(turns - 3, scale);
  }}
  return log.join() + "|" + (Object.is(at, -0) ? "-0" : at);
}}
{calls('run("abcdefgh", @, 1)')}
{calls('run("abcdefgh", @, 0)')}
{calls('run("abcdefgh", @, 1000000000)')}
{calls('run("abcdefgh", @, -2147483648)')}
""")
print(count, 'programs')
