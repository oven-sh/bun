# all 7,718; ../parallel/class-beside-a-record-of-a-row/ holds 3 of them.
# class-beside-a-record-of-a-row.py <outdir>: AN OBJECT OF A BUILT-IN CLASS (an array, a promise, a map ..) AND A RECORD THAT A ROW MAKES (a step of an iterator, a descriptor, an entry of allSettled ..) MEET AT ONE PLACE,
# so Link unites their sites into one family, of which it holds that it may hold cells of compiled layouts. A SECOND PLACE HOLDS THE OBJECT OF THE CLASS ALONE, A THIRD THE RECORD ALONE.
# LinkFlow::toTypeID(): the flag is asked of a type that names the class Object alone: what names another class has met no record (joinClasses(): two classes are Mixed).
# record x object of a class x where they meet x keeper of the one alone x observer. ONE SHAPE A FILE. Every program prints what plain Bun prints.
# THE RED CONTROL: the flag asked of nobody: the record alone is then written as a cell of the class Object, which a cell of a compiled layout is not: the observers of the record (`record-*`) catch it.
import sys, os
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
# Over `n`.
records = {
 'array-step':       '[n, 2].values().next()',
 'map-step':         'new Map([[n, 2]]).entries().next()',
 'set-step':         'new Set([n, 2]).values().next()',
 'string-step':      '"ab"[Symbol.iterator]().next()',
 'generator-step':   'numbers(n).next()',
 'helper-step':      'Iterator.from([n]).map(x => x).next()',
 'descriptor':       'Object.getOwnPropertyDescriptor({ x: n }, "x")',
 'with-resolvers':   'Promise.withResolvers()',
 'from-entries':     'Object.fromEntries([["value", n]])',
 'group-by':         'Object.groupBy([n], () => "value")',
}
# The maker over `n`, and what is asked of the object: each observer is an expression over `alone`.
classes = {
 'array': ('[n, 2]', {
   'length': 'alone.length', 'element': 'alone[0]', 'last': 'alone[alone.length - 1]', 'is-array': 'Array.isArray(alone)', 'push': 'alone.push(3) + alone.length', 'join': 'alone.join()',
   'for-of': '(() => { let sum = 0; for (const x of alone) sum += x; return sum; })()', 'spread': '[...alone].length', 'loop': '(() => { let sum = 0; for (let i = 0; i < alone.length; i++) sum += alone[i]; return sum; })()',
   'store': '(alone[1] = 7, alone[1] + alone.length)', 'grow': '(alone[5] = 1, alone.length)', 'keys': 'Object.keys(alone).join()', 'json': 'JSON.stringify(alone)', 'map': 'alone.map(x => x + 1).join()', 'value': 'String(alone.value)', 'done': 'String(alone.done)',
   'instanceof': 'alone instanceof Array', 'to-string': 'Object.prototype.toString.call(alone)', 'destructure': '(([a, b]) => a + b)(alone)' }),
 'array-by-a-row': ('[n, 2].map(x => x)', { 'length': 'alone.length', 'element': 'alone[0]', 'push': 'alone.push(3) + alone.length', 'for-of': '(() => { let sum = 0; for (const x of alone) sum += x; return sum; })()', 'is-array': 'Array.isArray(alone)', 'value': 'String(alone.value)' }),
 'pair': ('Object.entries({ x: n })[0]', { 'length': 'alone.length', 'element': 'alone[1]', 'join': 'alone.join()', 'destructure': '(([a, b]) => a + b)(alone)', 'is-array': 'Array.isArray(alone)', 'value': 'String(alone.value)' }),
 'map': ('new Map([[1, n]])', { 'get': 'alone.get(1)', 'size': 'alone.size', 'has': 'alone.has(1)', 'set': 'alone.set(2, 2).size', 'for-of': '(() => { let sum = 0; for (const [k, v] of alone) sum += v; return sum; })()', 'instanceof': 'alone instanceof Map', 'value': 'String(alone.value)', 'to-string': 'Object.prototype.toString.call(alone)' }),
 'set': ('new Set([n])', { 'has': 'alone.has(n)', 'size': 'alone.size', 'add': 'alone.add(9).size', 'spread': '[...alone].join()', 'instanceof': 'alone instanceof Set', 'value': 'String(alone.value)' }),
 'promise': ('Promise.resolve(n)', { 'then': 'typeof alone.then', 'instanceof': 'alone instanceof Promise', 'to-string': 'Object.prototype.toString.call(alone)', 'value': 'String(alone.value)', 'resolve-is-same': 'Promise.resolve(alone) === alone' }),
 'date': ('new Date(n)', { 'time': 'alone.getTime()', 'instanceof': 'alone instanceof Date', 'value': 'String(alone.value)' }),
 'regexp': ('new RegExp("a" + n)', { 'test': 'alone.test("a" + n)', 'source': 'alone.source', 'value': 'String(alone.value)' }),
 'error': ('new Error("e" + n)', { 'message': 'alone.message', 'instanceof': 'alone instanceof Error', 'value': 'String(alone.value)' }),
 'typed-array': ('new Int8Array([n, 2])', { 'length': 'alone.length', 'element': 'alone[0]', 'value': 'String(alone.value)' }),
}
# Of the record alone, and of what stands where the two meet. `record`: the one in sight. `kept`: the same, read back out of its keeper. `either`: what stands where they meet.
observersOfRecord = {
 'record-is-itself':   'kept === record',
 'record-value':       'String(kept.value) + String(record.value)',
 'record-keys':        'Object.keys(kept).join()',
 'record-stored':      '(kept.value = 9, String(record.value))',
 'record-is-array':    'Array.isArray(kept)',
 'record-to-string':   'Object.prototype.toString.call(kept)',
 'record-prototype':   'Object.getPrototypeOf(kept) === Object.prototype',
 'either-is-array':    'Array.isArray(either)',
 'either-value':       'String(either.value)',
 'either-length':      'String(either.length)',
 'either-is-record':   'either === record',
 'either-is-alone':    'either === alone',
 'either-typeof':      'typeof either',
}
# WHAT LINK SAYS OF A PLACE COUNTS ONLY WHERE THE WALK DOES NOT SEE THE STORE: fill() makes and lays down, observe() reads: another function, entered out of a loop, with a call between that the walk does not look into.
# (in front of the functions, in fill(): lays `record` and `object` at one place, in observe(): what stands there)
meetings = {
 'result':     ('function pick(first, a, b) { return first ? a : b; }\nlet picked;', 'picked = pick(n > 1, record, object);', 'picked'),
 'parameter':  ('let taken;\nfunction take(x) { taken = x; }', 'take(record); if (n > 1) take(object);', 'taken'),
 'variable':   ('let shared;', 'shared = record; if (n > 1) shared = object;', 'shared'),
 'field':      ('const meeting = { both: undefined };', 'meeting.both = record; if (n > 1) meeting.both = object;', 'meeting.both'),
 'element':    ('const both = [];', 'both[0] = record; both[1] = object;', 'both[n > 1 ? 1 : 0]'),
 'map-value':  ('const both = new Map();', 'both.set(0, record); both.set(1, object);', 'both.get(n > 1 ? 1 : 0)'),
 'captured':   ('function cellOf() { let held; return { put(v) { held = v; }, get() { return held; } }; }\nconst cell = cellOf();', 'cell.put(record); if (n > 1) cell.put(object);', 'cell.get()'),
 'set-member': ('const both = new Set();', 'both.clear(); both.add(n > 1 ? object : record);', '[...both][0]'),
}
# (in front of the functions, the store of VALUE in fill(), the read in observe()): the place that holds one of the two alone.
keepers = {
 # A key of its own: two literals with the same keys are one layout, and the two would meet in its field.
 'field':    ('const NAME = { VALUEKept: undefined };', 'NAME.VALUEKept = VALUE;', 'NAME.VALUEKept'),
 'variable': ('let NAME;', 'NAME = VALUE;', 'NAME'),
 'element':  ('const NAME = [];', 'NAME[0] = VALUE;', 'NAME[0]'),
 'captured': ('function cellForVALUE() { let held; return { put(v) { held = v; }, get() { return held; } }; }\nconst NAME = cellForVALUE();', 'NAME.put(VALUE);', 'NAME.get()'),
 'instance': ('class KeeperOfVALUE { VALUEHeld; }\nconst NAME = new KeeperOfVALUE();', 'NAME.VALUEHeld = VALUE;', 'NAME.VALUEHeld'),
}
count = 0
def write(name, record, kind, meeting, keeper, observer):
    global count
    front, meet, met = meetings[meeting]
    a = [part.replace('NAME', 'keeperOfObject').replace('VALUE', 'object') for part in keepers[keeper]]
    r = [part.replace('NAME', 'keeperOfRecord').replace('VALUE', 'record') for part in keepers[keeper]]
    lines = ['// %s.' % name.replace('-', ' '), 'function* numbers(n) { yield n; }', front, a[0], r[0], 'let recordInSight;',
             'function fill(n) {', '  const record = %s;' % records[record], '  const object = %s;' % classes[kind][0], '  %s' % meet, '  %s' % a[1], '  %s' % r[1], '  recordInSight = record;', '}',
             'function observe(n) {', '  const alone = %s;' % a[2], '  const kept = %s;' % r[2], '  const either = %s;' % met, '  const record = recordInSight;', '  return %s;' % observer, '}',
             'const printed = [];', 'for (let n = 1; n <= 3; n++) {', '  try { fill(n); printed.push(String(observe(n))); } catch (error) { printed.push(error.constructor.name); }', '}', 'console.log(printed.join(" "));']
    with open(os.path.join(out, name + '.mjs'), 'w') as f:
        f.write('\n'.join(l for l in lines if l.strip()) + '\n')
    count += 1
for kind, (maker, observers) in classes.items():
    for observer, text in observers.items():
        # Every observer of every class, with each record, where the two meet in a result; and with one record at every meeting and in every keeper.
        for record in records:
            write('%s-%s-beside-%s-result-field' % (kind, observer, record), record, kind, 'result', 'field', text)
        for meeting in meetings:
            for keeper in keepers:
                write('%s-%s-beside-array-step-%s-%s' % (kind, observer, meeting, keeper), 'array-step', kind, meeting, keeper, text)
for observer, text in observersOfRecord.items():
    for record in records:
        for kind in ('array', 'map', 'promise'):
            for meeting in ('result', 'variable', 'field', 'element'):
                for keeper in ('field', 'variable', 'captured'):
                    write('%s-of-%s-beside-%s-%s-%s' % (observer, record, kind, meeting, keeper), record, kind, meeting, keeper, text)
print(count, 'programs')
