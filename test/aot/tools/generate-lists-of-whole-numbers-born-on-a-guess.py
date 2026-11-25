#!/usr/bin/env python3
# generate-lists-of-whole-numbers-born-on-a-guess.py <folder>: one shape a program: ONE maker of a list of a length (map, Array.from, fill + map ..) x ONE kind of number without a fraction that is no int32, at one place.
# The maker's site sees three seasons: lists of int32 alone, lists that hold the odd number, lists of int32 again: so the site's memory is empty, learns, and has learned. Every list is told whole: each element by Object.is's eyes,
# its holes, its length, and what the usual readers make of it. Every program's answer is plain Bun's.
import os, sys

out = sys.argv[1]
os.makedirs(out, exist_ok=True)

head = '''const source: number[] = [];
for (let at = 0; at < 12; at++) source.push(at);
function one(value: unknown): string { return Object.is(value, -0) ? "-0" : typeof value === "number" ? String(value) : typeof value + ":" + String(value); }
function tell(list: any[]): string {
  let said = list.length + "[";
  for (let at = 0; at < list.length; at++) said += (at in list ? one(list[at]) : "hole") + ",";
  let sum = 0;
  for (const value of list) sum += typeof value === "number" ? value : 1;
  return said + "] " + one(sum) + " " + list.indexOf(3) + " " + list.includes(NaN) + " " + list.includes(0) + " " + one(list[list.length - 1]) + " " + JSON.stringify(list.slice(2, 5)) + " " + one(source[list[1] as number]);
}
'''

odd = {
    'infinity': 'Infinity',
    'minus-infinity': '-Infinity',
    'not-a-number': 'NaN',
    'minus-zero': '-0',
    'two-to-the-31': '2147483648',
    'under-minus-two-to-the-31': '-2147483649',
    'two-to-the-53': '9007199254740992',
    'a-product-too-large': '(k + 3) * 1e300 * 1e10',
}
# `w` is a number without a fraction that is not proven an int32: a floor, or a product of whole numbers
worths = {
    'floors': 'Math.floor((k * scale) / 3)',
    'products': 'k * scale * (scale + 1)',
}
makers = {
    'from-a-length': 'Array.from({ length: 12 }, (_, k) => WORTH)',
    'filled-and-mapped': 'new Array(12).fill(0).map((_, k) => WORTH)',
}

count = 0
for maker, making in makers.items():
    for worth, computing in worths.items():
        for name, number in odd.items():
            for place in (0, 7):
                if place == 0 and worth == 'products':
                    continue
                value = f'(season === 1 && k === {place} ? {number} : {computing})'
                body = f'''function make(season: number, scale: number): any[] {{
  return {making.replace("WORTH", value)};
}}
const seen = new Map<string, number>();
for (let turn = 0; turn < 420; turn++) {{
  const said = tell(make(turn < 140 ? 0 : turn < 280 ? 1 : 2, turn % 5));
  seen.set(said, (seen.get(said) ?? 0) + 1);
}}
for (const [said, times] of seen) console.log(times, said);
const late = make(2, 4);
late[3] = 0.5;
late[4] = "text";
late.push(-0);
console.log(tell(late));
'''
                open(os.path.join(out, f'{maker}-of-{worth}-with-{name}-at-{place}.ts'), 'w').write(head + body)
                count += 1
# map's own road (TryPutByValDirect, behind it TryPutIndex), in the forms in which its list is born on the guess; and lists too long for the stub
forms = {
    'small-products': 'k * (scale & 7)',
    'floors-of-halves': 'Math.floor(k * (scale & 7) * 0.5)',
}
lists = {
    'map-of-a-literal': ('', '[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]'),
    'map-of-a-list-of-the-file': ('', 'source'),
    'map-of-a-long-list': ('const long: number[] = [];\nfor (let at = 0; at < 200; at++) long.push(at);\n', 'long'),
}
for maker, (before, mapped) in lists.items():
    for form, computing in forms.items():
        for name, number in odd.items():
            for place in (0, 7):
                body = before + f'''function make(season: number, scale: number): number[] {{
  return {mapped}.map(k => (k === {place} + season ? {number} : {computing}));
}}
const seen = new Map<string, number>();
for (let turn = 0; turn < 420; turn++) {{
  const said = tell(make(turn < 140 ? 1000 : turn < 280 ? 0 : 2000, turn % 5));
  seen.set(said, (seen.get(said) ?? 0) + 1);
}}
for (const [said, times] of seen) console.log(times, said);
'''
                open(os.path.join(out, f'{maker}-of-{form}-with-{name}-at-{place}.ts'), 'w').write(head + body)
                count += 1
# the site's lists come to hold what is no number: behind the making a text is stored into each list of the second season
for maker, (before, mapped) in lists.items():
    for form, computing in forms.items():
        body = before + f'''function make(scale: number): any[] {{
  return {mapped}.map(k => {computing});
}}
const seen = new Map<string, number>();
const kept: any[][] = [];
for (let turn = 0; turn < 420; turn++) {{
  const list = make(turn % 5);
  if (turn >= 140 && turn < 280) list[turn % 12] = "text" + (turn % 3);
  kept[turn % 7] = list;
  const said = tell(list);
  seen.set(said, (seen.get(said) ?? 0) + 1);
}}
for (const [said, times] of seen) console.log(times, said);
console.log(kept.map(tell).join(" | "));
'''
        open(os.path.join(out, f'{maker}-of-{form}-with-a-text-stored-behind-the-making.ts'), 'w').write(head + body)
        count += 1
print(count, 'programs')
