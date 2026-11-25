#!/usr/bin/env python3
# all 60; ../parallel/dates-written-as-json/ holds 3 of them.
# generate-dates-written-as-json.py <folder>: `date.toJSON()` on one kind of date, in a program that lists the keys of Date.prototype at one point or not at all: one program each, held to `bun <file>`.
# The host's toJSON asks the date for a primitive, and a valid one for toISOString BY NAME: whatever the program has laid under those names runs, and each first read adds a member to Date.prototype.
import os, sys
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
dates = [
 ('valid', 'new Date(86400000)'),
 ('invalid', 'new Date(NaN)'),
 ('the-epoch', 'new Date(0)'),
 ('before-the-year-zero', 'new Date(-62198755200000)'),
 ('past-the-year-9999', 'new Date(253402300800000)'),
 ('the-last-of-all', 'new Date(8640000000000000)'),
 ('with-milliseconds', 'new Date(1234567890123)'),
 ('set-to-invalid-later', 'changed(new Date(0), d => d.setTime(NaN))'),
 ('set-to-valid-later', 'changed(new Date(NaN), d => d.setTime(5))'),
 ('its-own-to-iso-string', 'changed(new Date(0), d => { (d as any).toISOString = () => { calls++; return "mine"; }; })'),
 ('its-own-value-of', 'changed(new Date(0), d => { (d as any).valueOf = () => { calls++; return NaN; }; })'),
 ('its-own-to-primitive', 'changed(new Date(0), d => Object.defineProperty(d, Symbol.toPrimitive, { value: () => { calls++; return Infinity; } }))'),
 ('its-own-to-json', 'changed(new Date(0), d => { (d as any).toJSON = () => { calls++; return "own"; }; })'),
 ('to-iso-string-that-is-no-function', 'changed(new Date(0), d => { (d as any).toISOString = 5; })'),
 ('a-class-below-date', 'new Below(0)'),
 ('a-class-below-date-with-its-own-to-iso-string', 'new Speaking(0)'),
 ('another-prototype', 'changed(new Date(0), d => Object.setPrototypeOf(d, { toJSON: Date.prototype.toJSON, toISOString() { calls++; return "other"; } }))'),
 ('frozen', 'Object.freeze(new Date(7))'),
 ('no-date-at-all', '({ toJSON: Date.prototype.toJSON, toISOString() { calls++; return "plain object"; } } as any)'),
 ('out-of-a-list-of-anything', '([new Date(9)] as any[])[0]'),
]
programs = [
 ('no-keys-listed', '', ''),
 ('keys-listed-behind', '', 'console.log(Object.getOwnPropertyNames(Date.prototype).join());'),
 ('keys-listed-in-front-and-behind', 'console.log(Object.getOwnPropertyNames(Date.prototype).length);', 'console.log(Object.getOwnPropertyNames(Date.prototype).join());'),
]
n = 0
for name, made in dates:
    for how, front, behind in programs:
        text = f'''// Made by test/aot/tools/generate-dates-written-as-json.py.
let calls = 0;
class Below extends Date {{}}
class Speaking extends Date {{ toISOString(): string {{ calls++; return "speaking"; }} }}
function changed(date: Date, change: (date: Date) => unknown): Date {{ change(date); return date; }}
function write(date: Date): string | null {{ return date.toJSON(); }}
function safely(date: Date): string {{
  try {{
    return String(write(date)) + " " + calls;
  }} catch (error: any) {{
    return "thrown: " + error.name + " " + calls;
  }}
}}
{front}
for (let turn = 0; turn < 3; turn++) console.log(safely({made}));
{behind}
'''
        open(f'{out}/{name}-{how}.ts', 'w').write(text); n += 1
print(n, 'programs')
