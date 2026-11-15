#!/usr/bin/env python3
"""generate-an-int32-that-a-typed-arm-boxes-and-what-asks-the-join-for-its-tag.py <folder>: all 575; ../parallel/an-int32-that-a-typed-arm-boxes-and-what-asks-the-join-for-its-tag/ holds 3 of them: AN int32 THAT A TYPED ARM BOXES TO MEET A CLOSED ARM, AND WHAT ASKS THE JOIN FOR ITS TAG, one shape a program.
The list comes out of JSON.parse, so every read of `.cents` is a guess; THE FIELD IS WRITTEN AS AN ENUM, so its slot holds a raw int32 and the typed arm has something to box (written `number` the slot holds the box: the first form of this family, so written, was vacuous in all 437). Real coins and impostors stand in one list: whatever is no int32 must take the closed arm's way.
Each consumer x each mix of values. Each prints a sum that depends on every answer."""
import os, sys
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
made = []
def program(name, text):
    made.append(name); open(os.path.join(out, name + ".ts"), "w").write(text.strip() + "\n")
# what stands in the field of real coins
INTS = {"small": "[0, 1, 2, 3, 42, 80, 7, 255]", "negative": "[-1, -2, -42, -80, -255, -65536, 0, 5]", "extremes": "[2147483647, -2147483648, 2147483646, -2147483647, 0, -1, 1, 1073741824]"}
# impostors: objects of another shape, out of the text
IMPOSTORS = {"none": "", "fractions": '{"cents":1.5},{"cents":-0.25},{"cents":42.0},{"cents":1e300}', "texts": '{"cents":"42"},{"cents":""},{"cents":"x"}', "missing": '{"pence":1},{}', "nulls-and-booleans": '{"cents":null},{"cents":true},{"cents":false}', "large": '{"cents":2147483648},{"cents":-2147483649},{"cents":4294967338}', "the-same-ints": '{"cents":42},{"cents":-1},{"cents":0}'}
CONSUMERS = {
  "strictly-equal": "if (c === 42) s += 1; else s += 2;",
  "strictly-unequal": "if (c !== -1) s += 1; else s += 2;",
  "loosely-equal": "if (c == 42) s += 1; else s += 2;",
  "less": "if (c < 3) s += 1; else s += 2;",
  "greater-or-equal": "if (c >= 0) s += 1; else s += 2;",
  "and": "s += (c & 5);",
  "or": "s ^= (c | 16);",
  "xor": "s ^= (c ^ 3);",
  "shift-left": "s ^= (c << 3);",
  "shift-right": "s ^= (c >> 1);",
  "shift-right-without-sign": "s = (s + (c >>> 28)) | 0;",
  "not": "s ^= ~c;",
  "truthy": "if (c) s += 1; else s += 2;",
  "switch": "switch (c) { case 0: s += 1; break; case 42: s += 2; break; case -1: s += 3; break; case 80: s += 4; break; case 2147483647: s += 5; break; default: s += 6; }",
  "index-of-a-list": "{ const e = table[c]; s += e === undefined ? 1 : e; }",
  "index-of-bytes": "{ const e = bytes[c]; s += e === undefined ? 1 : e; }",
  "index-of-a-text": "{ const e = text.charCodeAt(c); s += e === e ? e : 1; }",
  "plus-one": "s = (s + ((c + 1) | 0)) | 0;",
  "minus": "s = (s + ((-c) | 0)) | 0;",
  "times": "s = (s + ((c * 3) | 0)) | 0;",
  "typeof": 'if (typeof c === "number") s += 1; else s += 2;',
  "twice": "if (c === 42) s += 1; if (c === 80) s += 2; if (c < 0) s += 4;",
  "either-way": "{ const d = i & 1 ? c : 0; if (d === 42) s += 1; else s += 2; }",
}
HEAD = """const enum Cents {{ Zero = 0, One = 1, FortyTwo = 42, Eighty = 80 }}
class Coin {{ cents: Cents; constructor(cents: Cents) {{ this.cents = cents; }} }}
const table = [10, 20, 30, 40, 50, 60, 70, 80];
const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const text = "abcdefgh";
const list: Coin[] = JSON.parse('[{impostors}]');
for (const n of {ints}) list.push(new Coin(n));
"""
for consumer, code in CONSUMERS.items():
    for ints in INTS:
        for impostors in IMPOSTORS:
            if ints != "small" and impostors not in ("none", "fractions", "large"): continue
            for written, how in (("", "as-it-is-written"), (": any", "as-anything")):
                if how == "as-anything" and impostors not in ("none", "fractions"): continue
                program(f"{consumer}-{ints}-beside-{impostors}-{how}", HEAD.format(impostors=IMPOSTORS[impostors], ints=INTS[ints]) + f"""let s = 0;
for (let round = 0; round < 3; round++) {{
  for (let i = 0; i < list.length; i++) {{ const c{written} = list[i].cents; {code} }}
}}
console.log(s);
""")
            if impostors in ("none", "fractions"):
                program(f"{consumer}-{ints}-beside-{impostors}-in-a-function", HEAD.format(impostors=IMPOSTORS[impostors], ints=INTS[ints]) + f"""function one(coin: Coin, i: number, s: number): number {{ const c = coin.cents; {code} return s; }}
let sum = 0;
for (let round = 0; round < 3; round++) {{ for (let i = 0; i < list.length; i++) sum = one(list[i], i, sum); }}
console.log(sum);
""")
print(len(made), "programs")
