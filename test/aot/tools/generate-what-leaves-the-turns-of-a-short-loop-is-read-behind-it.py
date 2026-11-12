# generate-what-leaves-the-turns-of-a-short-loop-is-read-behind-it.py <folder>: all 117; ../parallel/what-leaves-the-turns-of-a-short-loop-is-read-behind-it/ holds 5 of them: the counter, or another value, of a loop of a few turns is read behind the loop, which a test on a field of an object leaves early: one shape a program; each prints what plain Bun prints.
import os, re, sys
out = sys.argv[1]
os.makedirs(out, exist_ok=True)

TEXT = '''%(regime)sconst unseen = (x: any): any => [x][JSON.parse("0")];
class Item {
  flags: number = 0;
  kind: number = 0;
  constructor(flags: number, kind: number) { this.flags = flags; this.kind = kind; }
}
let noted = 0;
function firstBad(items: Item[], j: number, limit: number, rounds: number): %(result)s {
  let work = 0;
  for (let w = 0; w < rounds; w++) work = (work + w) | 0;
%(body)s
}
const two: number = unseen(2);
const good: Item[] = [new Item(1, 5), new Item(2, 7)];
const odd: Item[] = [JSON.parse('{"flags":3}')];
const mixed: Item[] = [new Item(1, 5), JSON.parse('{"flags":3}')];
%(calls)s
'''

CALLS = '''let sum = 0;
for (let r = 0; r < 300; r++) sum += firstBad(good, r & 1, 1000, two);
console.log(sum);
console.log(firstBad(odd, 0, 1000, two), noted);
console.log(firstBad(mixed, 0, 1000, two), firstBad(mixed, 1, 1000, two), noted);'''

CALLS_TEXT = '''let sum = "";
for (let r = 0; r < 300; r++) sum = firstBad(good, r & 1, 1000, two);
console.log(sum);
console.log(firstBad(odd, 0, 1000, two), noted);
console.log(firstBad(mixed, 0, 1000, two), firstBad(mixed, 1, 1000, two), noted);'''

CALLS_STRANGER_FIRST = '''console.log(firstBad(odd, 0, 1000, two), noted);
let sum = 0;
for (let r = 0; r < 300; r++) sum += firstBad(good, r & 1, 1000, two);
console.log(sum);
console.log(firstBad(mixed, 0, 1000, two), firstBad(mixed, 1, 1000, two), noted);'''

CALLS_CAUGHT = '''let sum = 0;
for (let r = 0; r < 300; r++) sum += firstBad(good, r & 1, 1000, two);
console.log(sum);
for (const [list, at] of [[odd, 0], [mixed, 0], [mixed, 1]] as [Item[], number][]) {
  try { console.log(firstBad(list, at, 1000, two), noted); } catch (error) { console.log((error as Error).message, noted); }
}'''

def untyped(text):
    text = text.replace('(x: any): any', '(x)').replace('  flags: number = 0;\n  kind: number = 0;\n', '  flags = 0;\n  kind = 0;\n')
    text = text.replace('(flags: number, kind: number)', '(flags, kind)')
    text = re.sub(r'\(items: Item\[\], j: number, limit: number, rounds: number\): \w+', '(items, j, limit, rounds)', text)
    text = text.replace('const two: number', 'const two').replace(': Item[] =', ' =').replace(' as [Item[], number][]', '').replace('(error as Error)', 'error')
    text = re.sub(r'let (\w+): \w+ =', r'let \1 =', text)
    return text

def program(name, body, calls=CALLS, result='number', kinds=('ts', 'js', 'open')):
    body = '\n'.join('  ' + line for line in body.strip('\n').split('\n'))
    closed = TEXT % {'regime': '', 'body': body, 'calls': calls, 'result': result}
    if 'ts' in kinds:
        open(os.path.join(out, name + '.ts'), 'w').write(closed)
    if 'js' in kinds:
        open(os.path.join(out, name + '-untyped.js'), 'w').write(untyped(closed))
    if 'open' in kinds:
        open(os.path.join(out, name + '-where-unseen-code-can-run.ts'), 'w').write(TEXT % {'regime': '(0, eval)("0");\n', 'body': body, 'calls': calls, 'result': result})

NODE = 'const node = items[j];\nlet seen = 0;\nlet i = 0;\n'
TURN = '  if (node.kind === undefined) break;\n  seen = seen + node.kind;\n  if (seen === limit) seen = 0;\n'
def loop(turns): return 'for (; i < %d; i++) {\n%s}\n' % (turns, TURN)

# How many turns.
for word, turns in (('two', 2), ('three', 3), ('four', 4)):
    program(word + '-turns-left-by-break', NODE + loop(turns) + 'if (i < %d) return -1 - i;\nreturn seen + work;' % turns)
# What is read behind the loop.
program('the-sum-of-the-turns-is-read-too', NODE + loop(2) + 'if (i < 2) return -1 - i - seen;\nreturn seen + work;')
program('two-values-leave', NODE + 'let k = 10;\nfor (; i < 2; i++, k = k + 3) {\n' + TURN + '}\nif (i < 2) return -1 - i - k;\nreturn seen + work + k;')
program('three-values-leave-one-of-them-a-text', NODE + 'let k = 10;\nlet label = "none";\nfor (; i < 2; i++, k = k + 3) {\n  label = i === 0 ? "first" : "second one";\n' + TURN + '}\nif (i < 2) return -1 - i - k - label.length;\nreturn seen + work + k + label.length;')
program('read-two-blocks-behind', NODE + loop(2) + 'if (i < 2) {\n  if (limit > 5) return -1 - i;\n  return -100 - i;\n}\nreturn seen + work;')
program('read-three-blocks-behind-and-the-node-is-looked-at-again', NODE + loop(2) + 'if (i < 2) {\n  if (node.flags & 1) {\n    if (limit > 5) return -1 - i;\n    return -100 - i;\n  }\n  return -50 - i;\n}\nreturn seen + work;')
program('read-on-both-ways-behind', NODE + loop(2) + 'if (i < 2) noted = noted + 1 + i;\nelse noted = noted + 10 * i;\nreturn seen + work + i;')
program('read-where-the-ways-have-met-again', NODE + loop(2) + 'let out = 0;\nif (i < 2) out = 7;\nreturn out * 100 + i * 10 + seen + work;')
program('stored-into-a-variable-of-the-module', NODE + loop(2) + 'if (i < 2) noted = noted + 1 + i;\nreturn seen + work;')
program('read-by-a-conditional-expression', NODE + loop(2) + 'return i < 2 ? -1 - i : seen + work;')
program('read-by-a-switch', NODE + loop(2) + 'switch (i) {\n  case 0: return -1;\n  case 1: return -2;\n  default: return seen + work;\n}')
program('read-by-a-switch-and-behind-it', NODE + loop(3) + 'switch (i) {\n  case 0: noted = noted + 1; break;\n  case 1: noted = noted + 20; break;\n  case 2: noted = noted + 300; break;\n  default: return seen + work;\n}\nreturn -1 - i;')
program('made-into-a-text-behind', NODE + loop(2) + 'if (i < 2) return "left in turn " + i;\nreturn "whole " + (seen + work);', calls=CALLS_TEXT, result='string')
program('a-flag-says-that-the-loop-was-left', NODE + 'let left = false;\nfor (; i < 2; i++) {\n  if (node.kind === undefined) { left = true; break; }\n  seen = seen + node.kind;\n  if (seen === limit) seen = 0;\n}\nif (left) return -1 - i;\nreturn seen + work;')
program('the-counter-goes-down', 'const node = items[j];\nlet seen = 0;\nlet i = 2;\nfor (; i > 0; i--) {\n' + TURN + '}\nif (i > 0) return -1 - i;\nreturn seen + work;')
program('the-counter-goes-by-two', NODE + 'for (; i < 4; i = i + 2) {\n' + TURN + '}\nif (i < 4) return -1 - i;\nreturn seen + work;')
# How the turn is left.
program('left-by-return-out-of-the-turn', NODE + 'for (; i < 2; i++) {\n  if (node.kind === undefined) return -1 - i;\n  seen = seen + node.kind;\n  if (seen === limit) seen = 0;\n}\nreturn seen + work + i;')
program('the-turn-goes-on-by-continue', NODE + 'let skipped = 0;\nfor (; i < 2; i++) {\n  if (node.kind === undefined) { skipped = skipped + 1 + i; continue; }\n  seen = seen + node.kind;\n  if (seen === limit) seen = 0;\n}\nif (skipped > 0) return -10 - skipped - i;\nreturn seen + work;')
program('left-by-throw-out-of-the-function', NODE + 'for (; i < 2; i++) {\n  if (node.kind === undefined) throw new RangeError("turn " + i);\n  seen = seen + node.kind;\n  if (seen === limit) seen = 0;\n}\nreturn seen + work + i;', calls=CALLS_CAUGHT)
program('left-by-throw-into-a-handler-that-reads-the-counter', NODE + 'try {\n  for (; i < 2; i++) {\n    if (node.kind === undefined) throw new RangeError("turn " + i);\n    seen = seen + node.kind;\n    if (seen === limit) seen = 0;\n  }\n} catch (error) {\n  return -1 - i;\n}\nreturn seen + work + i;')
program('left-by-break-and-a-handler-behind-reads-the-counter', NODE + loop(2) + 'try {\n  if (i < 2) throw new RangeError("left");\n  noted = noted + 1;\n} catch (error) {\n  return -1 - i;\n}\nreturn seen + work;')
program('left-by-break-out-of-a-labeled-block', NODE + 'found: {\n  for (; i < 2; i++) {\n    if (node.kind === undefined) break found;\n    seen = seen + node.kind;\n    if (seen === limit) seen = 0;\n  }\n  return seen + work;\n}\nreturn -1 - i;')
program('two-breaks-in-one-turn', NODE + 'for (; i < 2; i++) {\n  if (node.kind === undefined) break;\n  seen = seen + node.kind;\n  if (node.flags === undefined) break;\n  if (seen === limit) seen = 0;\n}\nif (i < 2) return -1 - i;\nreturn seen + work;')
# The test that the typed arm folds.
program('the-test-is-typeof', NODE + 'for (; i < 2; i++) {\n  if (typeof node.kind !== "number") break;\n  seen = seen + node.kind;\n  if (seen === limit) seen = 0;\n}\nif (i < 2) return -1 - i;\nreturn seen + work;')
program('the-test-is-loose-null', NODE + 'for (; i < 2; i++) {\n  if (node.kind == null) break;\n  seen = seen + node.kind;\n  if (seen === limit) seen = 0;\n}\nif (i < 2) return -1 - i;\nreturn seen + work;')
# Who arrives, and when.
program('the-stranger-arrives-first', NODE + loop(2) + 'if (i < 2) return -1 - i;\nreturn seen + work;', calls=CALLS_STRANGER_FIRST)
program('each-turn-reads-its-own-node', 'let seen = 0;\nlet i = 0;\nfor (; i < 2; i++) {\n  const node = items[(j + i) % items.length];\n' + TURN + '}\nif (i < 2) return -1 - i;\nreturn seen + work;')
# Other loops.
program('while-loop', NODE + 'while (i < 2) {\n' + TURN + '  i++;\n}\nif (i < 2) return -1 - i;\nreturn seen + work;')
program('do-while-loop', NODE + 'do {\n' + TURN + '  i++;\n} while (i < 2);\nif (i < 2) return -1 - i;\nreturn seen + work;')
program('for-of-over-a-short-list-written-in-sight', 'const node = items[j];\nlet seen = 0;\nlet at = 0;\nfor (const step of [1, 2]) {\n  if (node.kind === undefined) break;\n  seen = seen + node.kind * step;\n  if (seen === limit) seen = 0;\n  at = at + 1;\n}\nif (at < 2) return -1 - at;\nreturn seen + work;')
program('for-of-and-the-element-is-read-behind', 'const node = items[j];\nlet seen = 0;\nlet last = 0;\nfor (const step of [4, 9]) {\n  last = step;\n  if (node.kind === undefined) break;\n  seen = seen + node.kind * step;\n  if (seen === limit) seen = 0;\n  last = 0;\n}\nif (last > 0) return -1 - last;\nreturn seen + work;')
program('for-in-over-a-literal-written-in-sight', 'const node = items[j];\nlet seen = 0;\nlet at = 0;\nfor (const name in { first: 1, second: 2 }) {\n  if (node.kind === undefined) break;\n  seen = seen + node.kind + name.length;\n  if (seen === limit) seen = 0;\n  at = at + 1;\n}\nif (at < 2) return -1 - at;\nreturn seen + work;')
program('a-loop-as-written-around-the-turns', 'const node = items[j];\nlet seen = 0;\nlet bad = 0;\nfor (let o = 0; o < rounds; o++) {\n  let i = 0;\n  for (; i < 2; i++) {\n  ' + TURN.replace('\n  ', '\n    ') + '  }\n  if (i < 2) bad = bad + 1 + i;\n}\nif (bad > 0) return -bad;\nreturn seen + work;')
program('turns-inside-turns', 'const node = items[j];\nlet seen = 0;\nlet a = 0;\nlet b = 0;\nouter: for (; a < 2; a++) {\n  for (b = 0; b < 2; b++) {\n    if (node.kind === undefined) break outer;\n    seen = seen + node.kind;\n    if (seen === limit) seen = 0;\n  }\n}\nif (a < 2) return -1 - a * 10 - b;\nreturn seen + work;')
program('turns-inside-turns-the-inner-loop-is-left', 'const node = items[j];\nlet seen = 0;\nlet a = 0;\nlet lefts = 0;\nfor (; a < 2; a++) {\n  let b = 0;\n  for (; b < 2; b++) {\n    if (node.kind === undefined) break;\n    seen = seen + node.kind;\n    if (seen === limit) seen = 0;\n  }\n  if (b < 2) lefts = lefts + 1 + b + a * 10;\n}\nif (lefts > 0) return -lefts;\nreturn seen + work;')
program('two-loops-one-behind-the-other', NODE + loop(2) + 'let k = 0;\nfor (; k < 2; k++) {\n  if (node.flags === undefined) break;\n  seen = seen + node.flags;\n  if (seen === limit) seen = 0;\n}\nif (i < 2) return -1 - i - k * 10;\nif (k < 2) return -500 - k;\nreturn seen + work;')
program('a-loop-that-is-built-twice', 'const node = items[j];\nlet seen = 0;\nlet i = 0;\nfor (; i < rounds; i++) {\n' + TURN + '}\nif (i < rounds) return -1 - i;\nreturn seen + work;')
