#!/usr/bin/env python3
# generate-places-whose-inferred-type-lies.py <folder>: all 136; ../parallel/places-whose-inferred-type-lies/ holds 27 of them: of every value of every dimension one, and one that a fault laid into the compiler on purpose has turned red.
# A `const` or `let` without an annotation lies in a place that other functions read: a variable of the module, a variable that a closure captures.
# The checker infers its type from what is stored, and a compiler may expect that type where the place is read. An expectation is tested at each use, so a program in which the inferred type is false
# answers as `bun <file>` does. Each program stores what its inferred type does not say, through an assertion, a declaration or a generic function, and uses it as its type invites to.
import os, sys
out = sys.argv[1]; os.makedirs(out, exist_ok=True)

HEAD = '''const show = (value: any): string => {
  try {
    return Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "string" ? JSON.stringify(value) : typeof value === "function" ? "function" : String(value);
  } catch (error) {
    return "cannot be shown";
  }
};
const attempt = (run: () => unknown): string => {
  try {
    return show(run());
  } catch (error) {
    return (error as Error).constructor.name;
  }
};
// Nobody can follow a value through a property of the global object.
function taken<T>(value: unknown): T {
  (globalThis as any).handedOn = value;
  return (globalThis as any).handedOn as T;
}
class Pair {
  first = 1;
  second = 2;
  sum() { return this.first + this.second; }
}
class Turned {
  second = "two";
  first = "one";
  sum() { return this.second + this.first; }
}
class Words extends Int32Array {
  get length() { return 2; }
}
'''

# what is inferred, how it is used, and what lies there: the first is the truth
KINDS = {
    'a-view-of-int32': ('Int32Array', [
        'let total = 0; for (let at = 0; at < 5; at++) total = (Math.imul(total, 31) + (held[at]! >>> 1)) | 0; return total;',
        'return held.length;',
        'let text = ""; for (let at = 0; at < held.length; at++) text += show(held[at]) + " "; return text;',
        'held[1] = 7.5; return held[1];',
    ], {
        'the-truth': 'Int32Array.from([10, -20, 30, 40])',
        'a-list': '[10, -20.5, "thirty", undefined]',
        'a-view-of-float64': 'Float64Array.from([10.5, -20, NaN, 4294967297])',
        'a-view-of-uint8': 'Uint8Array.from([10, 200, 30, 40, 50, 60])',
        'a-view-of-bigint64': 'BigInt64Array.from([10n, -20n, 30n])',
        'a-subclass-with-a-length-of-its-own': 'Words.from([10, -20, 30, 40])',
        'a-plain-object': '{ 0: 10, 1: "one", length: 3 }',
        'a-text': '"text"',
        'a-number': '12',
        'undefined': 'undefined',
        'null': 'null',
        'a-proxy': 'new Proxy(Int32Array.from([10, -20, 30, 40]), { get: (target, key) => (key === "length" ? 2 : key === "1" ? "from the proxy" : Reflect.get(target, key)) })',
    }),
    'a-number': ('number', [
        'return held + 1;',
        'return held * 2;',
        'return held | 0;',
        'let total = 0; for (let at = 0; at < 3; at++) total += held; return total;',
        'return held < 5;',
    ], {
        'the-truth': '4',
        'a-fraction': '4.5',
        'a-text': '"4"',
        'a-big-integer': '4n',
        'undefined': 'undefined',
        'null': 'null',
        'an-object-that-converts-by-code': '{ valueOf() { return 40; } }',
        'a-symbol': 'Symbol("four")',
    }),
    'a-text': ('string', [
        'return held.length;',
        'return held + "!";',
        'return held.charCodeAt(0);',
        'let text = ""; for (let at = 0; at < 3; at++) text += held[at]; return text;',
    ], {
        'the-truth': '"four"',
        'a-number': '4',
        'a-list': '["f", "o"]',
        'undefined': 'undefined',
        'an-object-with-the-members': '{ length: 9, charCodeAt: () => -1, 0: "z" }',
    }),
    'an-object-of-a-class': ('Pair', [
        'return held.first;',
        'return held.second;',
        'return held.sum();',
        'let total: any = 0; for (let at = 0; at < 3; at++) total += held.first; return total;',
        'held.first = 5; return held.sum();',
    ], {
        'the-truth': 'new Pair()',
        'an-object-of-a-class-with-the-fields-turned-round': 'new Turned()',
        'a-plain-object': '{ second: 20, first: 10, sum() { return "own"; } }',
        'an-object-with-a-getter': '{ get first() { return "got"; }, set first(value) {}, second: 3, sum: () => 0 }',
        'an-object-whose-prototype-was-replaced': 'Object.setPrototypeOf(new Pair(), { sum() { return "replaced"; } })',
        'a-frozen-object': 'Object.freeze(new Pair())',
        'undefined': 'undefined',
        'null': 'null',
        'a-number': '3',
    }),
    'a-list-of-numbers': ('number[]', [
        'let total = 0; for (let at = 0; at < held.length; at++) total += held[at]!; return total;',
        'return held.length;',
        'return held[1]! * 2;',
        'return held.map(each => each + 1).join();',
    ], {
        'the-truth': '[1, 2, 3]',
        'a-list-of-texts': '["1", "2", "3"]',
        'a-list-with-a-hole': '[1, , 3]',
        'a-view': 'Int32Array.from([1, 2, 3])',
        'a-plain-object': '{ length: 2, 0: 5, 1: 6, map: () => ["mapped"] }',
        'undefined': 'undefined',
    }),
    'a-function': ('(value: number) => number', [
        'return held(2);',
        'let total = 0; for (let at = 0; at < 3; at++) total += held(at); return total;',
    ], {
        'the-truth': '(value: number) => value + 1',
        'a-function-that-gives-a-text': '(value: number) => "text " + value',
        'a-class': 'Pair',
        'a-number': '3',
        'undefined': 'undefined',
    }),
}

def uses(body_list, name):
    return '\n'.join(f'function use{n}(): unknown {{ {body.replace("held", name)} }}' for n, body in enumerate(body_list))

PLACES = {
    'a-variable-of-the-module': lambda ty, stored, bodies: f'''
const held = taken<{ty}>({stored});
{uses(bodies, "held")}
for (let round = 0; round < 3; round++) console.log({", ".join(f"attempt(use{n})" for n in range(len(bodies)))});
''',
    'a-variable-that-closures-capture': lambda ty, stored, bodies: f'''
function make() {{
  const held = taken<{ty}>({stored});
{chr(10).join("  " + line for line in uses(bodies, "held").split(chr(10)))}
  return [{", ".join(f"use{n}" for n in range(len(bodies)))}];
}}
const made = make();
for (let round = 0; round < 3; round++) console.log(made.map(attempt).join(", "));
''',
    'a-variable-that-is-filled-later': lambda ty, stored, bodies: f'''
let held = taken<{ty}>({stored});
{uses(bodies, "held")}
function fill(value: unknown) {{ held = taken<{ty}>(value); }}
for (let round = 0; round < 3; round++) console.log({", ".join(f"attempt(use{n})" for n in range(len(bodies)))});
fill(undefined);
console.log({", ".join(f"attempt(use{n})" for n in range(len(bodies)))});
''',
}

count = 0
for kind, (ty, bodies, lies) in KINDS.items():
    for lie, stored in lies.items():
        for place, text in PLACES.items():
            name = f'{kind}-is-inferred-for-{place}-that-holds-{lie}.ts'
            says = f'// `{ty}` is what the checker infers. The place holds {lie.replace("-", " ")}.\n'
            open(os.path.join(out, name), 'w').write(says + HEAD + text(ty, stored, bodies).lstrip('\n'))
            count += 1

# read in front of the store
open(os.path.join(out, 'a-variable-of-the-module-is-read-in-front-of-its-store.ts'), 'w').write('''// The function runs once while the variable is in its dead zone.
''' + HEAD + '''function use(): unknown { let total = 0; for (let at = 0; at < 3; at++) total += held[at]!; return total; }
console.log(attempt(use));
const held = Int32Array.from([1, 2, 3]);
console.log(attempt(use));
''')
count += 1
print(count, 'programs')
