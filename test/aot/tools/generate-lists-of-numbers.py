#!/usr/bin/env python3
# generate-lists-of-numbers.py <folder>: one list declared `number[]`, made or changed in one way, read in one way: one program each, held to `bun <file>`.
# What lies in such a list decides how the engine stores it: int32s, doubles, any value, holes. The type says nothing of that, and now and then it lies.
import os, sys
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
deeds = [
 ('integers', 'const list: number[] = [];\n  for (let i = 0; i < 6; i++) list.push(i);'),
 ('integers-then-a-fraction', 'const list: number[] = [];\n  for (let i = 0; i < 6; i++) list.push(i);\n  list.push(0.5);'),
 ('a-fraction-then-integers', 'const list: number[] = [0.5];\n  for (let i = 0; i < 6; i++) list.push(i);'),
 ('integers-then-minus-zero', 'const list: number[] = [];\n  for (let i = 0; i < 6; i++) list.push(i);\n  list.push(-0);'),
 ('minus-zero-worked-out', 'const list: number[] = [];\n  for (let i = 0; i < 6; i++) list.push(i * minus);'),
 ('integers-then-nan', 'const list: number[] = [];\n  for (let i = 0; i < 6; i++) list.push(i);\n  list.push(NaN);'),
 ('nan-worked-out', 'const list: number[] = [];\n  for (let i = 0; i < 6; i++) list.push(i / (i & 1));'),
 ('integers-then-2-to-the-31', 'const list: number[] = [];\n  for (let i = 0; i < 6; i++) list.push(i);\n  list.push(2147483648);'),
 ('integers-that-grow-past-int32', 'const list: number[] = [];\n  for (let i = 0; i < 6; i++) list.push(2147483645 + i);'),
 ('integers-then-infinity', 'const list: number[] = [];\n  for (let i = 0; i < 6; i++) list.push(i);\n  list.push(-Infinity);'),
 ('a-store-past-the-end', 'const list: number[] = [];\n  for (let i = 0; i < 6; i++) list.push(i);\n  list[9] = 7;'),
 ('a-fraction-stored-past-the-end', 'const list: number[] = [];\n  for (let i = 0; i < 6; i++) list.push(i);\n  list[9] = 7.5;'),
 ('an-element-deleted', 'const list: number[] = [];\n  for (let i = 0; i < 6; i++) list.push(i);\n  delete list[2];'),
 ('an-element-deleted-among-fractions', 'const list: number[] = [];\n  for (let i = 0; i < 6; i++) list.push(i / 4);\n  delete list[2];'),
 ('undefined-against-the-type', 'const list: number[] = [];\n  for (let i = 0; i < 6; i++) list.push(i);\n  (list as any).push(undefined);'),
 ('undefined-among-fractions-against-the-type', 'const list: number[] = [];\n  for (let i = 0; i < 6; i++) list.push(i / 4);\n  (list as any)[3] = undefined;'),
 ('a-text-against-the-type', 'const list: number[] = [];\n  for (let i = 0; i < 6; i++) list.push(i);\n  (list as any)[3] = "7";'),
 ('an-object-against-the-type', 'const list: number[] = [];\n  for (let i = 0; i < 6; i++) list.push(i);\n  (list as any)[3] = { valueOf() { return 7; }, toJSON() { return "seven"; } };'),
 ('a-bigint-against-the-type', 'const list: number[] = [];\n  for (let i = 0; i < 6; i++) list.push(i);\n  (list as any)[3] = 7n;'),
 ('cut-short', 'const list: number[] = [];\n  for (let i = 0; i < 6; i++) list.push(i);\n  list.length = 2;'),
 ('made-longer', 'const list: number[] = [];\n  for (let i = 0; i < 6; i++) list.push(i);\n  list.length = 8;'),
 ('written-integers', 'const list: number[] = [3, 1, 4, 1, 5, 9];'),
 ('written-fractions', 'const list: number[] = [3.5, 1, 4.25, 1, 5, 9];'),
 ('written-with-a-hole', 'const list: number[] = [3, 1, , 1, 5, 9] as number[];'),
 ('written-of-values-handed-in', 'const list: number[] = [minus, minus * 2, minus / 2, 0 * minus];'),
 ('made-with-a-length', 'const list: number[] = new Array<number>(6);\n  for (let i = 0; i < 4; i++) list[i] = i;'),
 ('made-with-a-length-and-filled', 'const list: number[] = new Array<number>(6).fill(0.5);'),
 ('made-by-array-from', 'const list: number[] = Array.from({ length: 6 }, (_, i) => i / 2);'),
 ('made-by-map', 'const list: number[] = [0, 1, 2, 3, 4, 5].map(x => x / 2);'),
 ('made-by-map-of-integers', 'const list: number[] = [0, 1, 2, 3, 4, 5].map(x => x * 2);'),
 ('made-by-concat', 'const list: number[] = [0, 1, 2].concat([0.5, 3]);'),
 ('made-by-a-spread', 'const list: number[] = [...[0, 1, 2], 0.5, ...[3]];'),
 ('made-by-slice', 'const list: number[] = [0, 1, 2.5, 3, 4, 5].slice(1, 5);'),
 ('made-by-filter', 'const list: number[] = [0, 1, 2.5, 3, 4, 5].filter(x => x !== 2.5);'),
 ('sorted', 'const list: number[] = [3, 1, 4.5, 1, 5, 9];\n  list.sort((a, b) => a - b);'),
 ('reversed', 'const list: number[] = [3, 1, 4, 1, 5, 9.5];\n  list.reverse();'),
 ('spliced', 'const list: number[] = [3, 1, 4, 1, 5, 9];\n  list.splice(1, 2, 0.5, -0, 7);'),
 ('shifted-and-unshifted', 'const list: number[] = [3, 1, 4, 1, 5, 9];\n  list.shift();\n  list.unshift(0.5);'),
 ('popped-empty-and-filled-again', 'const list: number[] = [3, 1];\n  list.pop();\n  list.pop();\n  list.push(0.5, 2);'),
 ('frozen', 'const list: number[] = Object.freeze([3, 1, 4, 1, 5, 9]) as number[];'),
 ('an-accessor-under-an-index', 'const list: number[] = [3, 1, 4, 1, 5, 9];\n  Object.defineProperty(list, 2, { get() { return 0.5; }, enumerable: true, configurable: true });'),
 ('out-of-json', 'const list: number[] = JSON.parse("[3, 1.5, 4, -0, 5e300, 9]");'),
]
reads = [
 ('summed', 'let s = 0;\n  for (let i = 0; i < list.length; i++) s += list[i];\n  return show(s);'),
 ('summed-by-for-of', 'let s = 0;\n  for (const x of list) s += x;\n  return show(s);'),
 ('multiplied', 'let s = 1;\n  for (let i = 0; i < list.length; i++) s *= list[i];\n  return show(s);'),
 ('counted-over-one', 'let s = 0;\n  for (let i = 0; i < list.length; i++) if (list[i] > 1) s++;\n  return show(s);'),
 ('counted-where-it-is-one', 'let s = 0;\n  for (let i = 0; i < list.length; i++) if (list[i] === 1) s++;\n  return show(s);'),
 ('asked-for-zeros-and-nan', 'let zeros = 0, minusZeros = 0, notItself = 0, nothing = 0;\n  for (let i = 0; i < list.length; i++) {\n    const x = list[i];\n    if (Object.is(x, 0)) zeros++;\n    if (Object.is(x, -0)) minusZeros++;\n    if (x !== x) notItself++;\n    if (x === undefined) nothing++;\n  }\n  return [zeros, minusZeros, notItself, nothing].join();'),
 ('xored', 'let s = 0;\n  for (let i = 0; i < list.length; i++) s ^= list[i];\n  return show(s);'),
 ('read-at-both-ends-and-past-them', 'return [list[0], list[list.length - 1], list[list.length], list[-1], list[1.5]].map(show).join();'),
 ('doubled-in-place', 'try {\n    for (let i = 0; i < list.length; i++) list[i] = list[i] * 2;\n  } catch (error: any) {\n    return error.name + " " + list.map(show).join();\n  }\n  return list.map(show).join();'),
 ('halved-in-place', 'try {\n    for (let i = 0; i < list.length; i++) list[i] = list[i] / 2;\n  } catch (error: any) {\n    return error.name + " " + list.map(show).join();\n  }\n  return list.map(show).join();'),
 ('appended-to', 'try {\n    list.push(1);\n    list.push(0.25);\n  } catch (error: any) {\n    return error.name + " " + list.length;\n  }\n  return list.length + " " + show(list[list.length - 2]) + " " + show(list[list.length - 1]);'),
 ('searched', 'return [list.indexOf(1), list.indexOf(0.5), list.indexOf(NaN), list.includes(NaN), list.includes(-0), list.includes(undefined as any), list.lastIndexOf(1)].join();'),
 ('written-as-json', 'try {\n    return JSON.stringify(list);\n  } catch (error: any) {\n    return error.name;\n  }'),
 ('taken-apart', 'const [a, b, , c, ...rest] = list;\n  return [a, b, c, rest.length, rest[rest.length - 1]].map(show).join();'),
]
head = '''function show(x: unknown): string {
  return Object.is(x, -0) ? "-0" : typeof x === "string" ? JSON.stringify(x) : typeof x === "object" && x !== null ? "object" : String(x);
}
'''
n = 0
for deed, made in deeds:
    for read, body in reads:
        text = f'''// Made by test/aot/tools/generate-lists-of-numbers.py.
{head}function make(minus: number): number[] {{
  {made}
  return list;
}}
function read(list: number[]): string {{
  {body}
}}
function safely(): string {{
  try {{
    return read(make(-1));
  }} catch (error: any) {{
    return "thrown: " + error.name;
  }}
}}
for (let turn = 0; turn < 3; turn++) console.log(safely());
'''
        open(f'{out}/{deed}-{read}.ts', 'w').write(text); n += 1
print(len(deeds), 'ways to make a list,', len(reads), 'ways to read it,', n, 'programs')
