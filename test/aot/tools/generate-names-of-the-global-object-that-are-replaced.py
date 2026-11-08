#!/usr/bin/env python3
# generate-names-of-the-global-object-that-are-replaced.py <folder>: all 730; ../parallel/names-of-the-global-object-that-are-replaced/ holds 8 of them: a function or a holder that a free name finds on the global object, in a program that replaces it in one way at one time, or only might: one program each, held to `bun <file>`.
# The compiler expects the built-in under such a name and proves nothing: whatever lies there when the name is read is what is called, with the operands evaluated behind the read.
import os, sys
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
# name of the global, the call as written, what stands in for the global
subjects = [
 ('isNaN', 'isNaN(value)', '() => "mine"', ['5', 'NaN', '"27"', 'undefined', '"x"', '{ valueOf() { return NaN; } }']),
 ('isFinite', 'isFinite(value)', '() => "mine"', ['5', 'Infinity', '"27"', 'null']),
 ('parseInt', 'parseInt(value, 10)', '() => "mine"', ['"42"', '"x"', '7.9', '"0x1f"', 'null']),
 ('parseFloat', 'parseFloat(value)', '() => "mine"', ['"4.5e1"', '"x"', '7']),
 ('decodeURIComponent', 'decodeURIComponent(value)', '() => "mine"', ['"plain"', '"a%20b"', '"%"', '5', '"%E4%BD%A0"']),
 ('encodeURIComponent', 'encodeURIComponent(value)', '() => "mine"', ['"plain"', '"a b&c"', '"\\ud800"', 'undefined']),
 ('decodeURI', 'decodeURI(value)', '() => "mine"', ['"a%20b%2F"', '"plain"']),
 ('encodeURI', 'encodeURI(value)', '() => "mine"', ['"a b/c"', '"plain"']),
 ('Date', 'typeof Date.now()', '({ now: () => "mine" })', ['0']),
 ('Date', 'new Date(value).getTime()', 'function () { return { getTime: () => "mine" }; }', ['5', 'NaN', '"1970-01-01T00:00:01Z"']),
 ('Promise', 'Promise.resolve(value) instanceof Object', '({ resolve: () => "mine" })', ['1']),
 ('Promise', 'typeof new Promise(resolve => resolve(value)).then', 'function () { return { then: 5 }; }', ['1']),
 ('Buffer', 'Buffer.byteLength(value)', '({ byteLength: () => "mine" })', ['"abc"', '"\\u00e9"']),
 ('Error', 'new Error(value).message', 'function () { return { message: "mine" }; }', ['"e"', 'undefined']),
 ('TypeError', 'new TypeError(value).name', 'function () { return { name: "mine" }; }', ['"e"']),
 ('WeakMap', 'new WeakMap().has(value)', 'function () { return { has: () => "mine" }; }', ['{}']),
 ('URL', 'new URL(value).host', 'function () { return { host: "mine" }; }', ['"http://a.example/x"', '"no"']),
 ('TextEncoder', 'new TextEncoder().encode(value).length', 'function () { return { encode: () => ({ length: "mine" }) }; }', ['"abc"']),
 ('queueMicrotask', 'queueMicrotask(() => {})', '() => "mine"', ['0']),
 ('structuredClone', 'structuredClone(value).a', '() => ({ a: "mine" })', ['{ a: 1 }']),
 ('atob', 'atob(value)', '() => "mine"', ['"YWJj"', '"*"']),
 ('btoa', 'btoa(value)', '() => "mine"', ['"abc"']),
]
# how the program replaces it: the statement that `change()` runs. NAME is the name, MINE what stands in
ways = [
 ('never-but-it-might', 'mark(pick ? globalThis : Math, "mine" + pick);'),
 ('by-its-own-name', 'NAME = MINE;'),
 ('as-a-member-of-the-global-object', 'globalThis.NAME = MINE;'),
 ('under-a-computed-name', 'mark(pick ? globalThis : Math, "NAME".slice(0, pick * 100));'),
 ('by-a-definition', 'Object.defineProperty(globalThis, "NAME", { value: MINE, writable: true, configurable: true });'),
 ('by-a-getter', 'Object.defineProperty(globalThis, "NAME", { get() { reads++; return MINE; }, configurable: true });'),
 ('by-deleting-it', 'delete globalThis.NAME;'),
 ('and-put-back', 'if (kept === undefined) { kept = globalThis.NAME; globalThis.NAME = MINE; } else { globalThis.NAME = kept; kept = undefined; }'),
 ('by-reflection', 'Reflect.set(globalThis, "NAME", MINE);'),
 ('by-assigning-many', 'Object.assign(globalThis, { NAME: MINE });'),
]
times = [
 ('in-front-of-the-first-call', 0),
 ('between-the-calls', 2),
 ('while-the-operand-is-evaluated', -1),
]
count = 0
seen = {}
for name, call, mine, values in subjects:
    seen[name] = seen.get(name, 0) + 1
    subject = name if seen[name] == 1 and sum(1 for s in subjects if s[0] == name) == 1 else f'{name}-{seen[name]}'
    for way, statement in ways:
        for time, at in times:
            if way == 'never-but-it-might' and at != 0:
                continue
            body = statement.replace('NAME', name).replace('MINE', mine)
            stored = 'MINE' in statement and 'mark(' not in statement
            asked = call if at >= 0 else call.replace('value', '(change(), value)', 1)
            program = f'''// Made by test/aot/tools/generate-names-of-the-global-object-that-are-replaced.py.
let reads = 0;
let kept;
let pick = 1;
function mark(holder, name) {{
  holder[name] = {mine};
}}
function change() {{
  {body}
}}
const handlers = {{
  asked(value) {{
    return {asked};
  }},
}};
const names = ["asked"];
function safely(value) {{
  try {{
    return String(handlers[names[0]](value));
  }} catch (error) {{
    return "thrown: " + error.name;
  }}
}}
const values = [{", ".join(values)}];
for (let turn = 0; turn < 4; turn++) {{
  if (turn === {at}) change();
  for (let at = 0; at < values.length; at++) console.log(turn, safely(values[at]), reads);
}}
'''
            open(f'{out}/{subject}-{way}-{time}.js', 'w').write(program); count += 1
# A member of a holder that a free name finds: the holder stays, and what lies under the member's name is replaced. Only members that a compiled program may replace: Promise.resolve and Buffer.byteLength are refused.
members = [
 ('Date', 'now', 'typeof Date.now()', '() => 5n', ['0']),
 ('JSON', 'parse', 'JSON.parse(value).a', '() => ({ a: "mine" })', ['\'{"a":1}\'', '"{"']),
 ('JSON', 'stringify', 'JSON.stringify(value)', '() => "mine"', ['{ a: 1 }', '[1, "b"]', 'undefined']),
 ('Math', 'random', 'typeof Math.random()', '() => "mine"', ['0']),
 ('Number', 'parseFloat', 'Number.parseFloat(value)', '() => "mine"', ['"4.5"', '"x"']),
 ('URL', 'canParse', 'URL.canParse(value)', '() => "mine"', ['"http://a.example"', '"no"']),
]
waysOfMembers = [
 ('never-but-it-might', 'mark(pick ? HOLDER : Math, "mine" + pick);'),
 ('by-a-store', 'HOLDER.MEMBER = MINE;'),
 ('under-a-computed-name', 'mark(pick ? HOLDER : Reflect, "MEMBER".slice(0, pick * 100));'),
 ('by-a-definition', 'Object.defineProperty(HOLDER, "MEMBER", { value: MINE, writable: true, configurable: true });'),
 ('by-a-getter', 'Object.defineProperty(HOLDER, "MEMBER", { get() { reads++; return MINE; }, configurable: true });'),
 ('by-deleting-it', 'delete HOLDER.MEMBER;'),
 ('and-put-back', 'if (kept === undefined) { kept = HOLDER.MEMBER; HOLDER.MEMBER = MINE; } else { HOLDER.MEMBER = kept; kept = undefined; }'),
]
for holder, member, call, mine, values in members:
    for way, statement in waysOfMembers:
        for time, at in times:
            if way == 'never-but-it-might' and at != 0:
                continue
            body = statement.replace('HOLDER', holder).replace('MEMBER', member).replace('MINE', mine)
            asked = call if at >= 0 else (call.replace('value', '(change(), value)', 1) if 'value' in call else call.replace('()', '(change())', 1))
            program = f'''// Made by test/aot/tools/generate-names-of-the-global-object-that-are-replaced.py.
let reads = 0;
let kept;
let pick = 1;
function mark(holder, name) {{
  holder[name] = {mine};
}}
function change() {{
  {body}
}}
const handlers = {{
  asked(value) {{
    return {asked};
  }},
}};
const names = ["asked"];
function safely(value) {{
  try {{
    return String(handlers[names[0]](value));
  }} catch (error) {{
    return "thrown: " + error.name;
  }}
}}
const values = [{", ".join(values)}];
for (let turn = 0; turn < 4; turn++) {{
  if (turn === {at}) change();
  for (let at = 0; at < values.length; at++) console.log(turn, safely(values[at]), reads);
}}
'''
            open(f'{out}/member-{holder}-{member}-{way}-{time}.js', 'w').write(program); count += 1
print(count, 'programs')
