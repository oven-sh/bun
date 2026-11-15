# generate-holes-that-are-copied.py <outdir>: a list with holes is copied by a row, and ONE LOOK at the copy tells a hole from a value. For lists-1A 1.3 (lists proven to have no holes).
# maker x copier x look x (erased | typed). Every program prints what plain Bun prints.
import sys, os
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
makers = {
 'literal':            '[1, , 3]',
 'literal-hole-first': '[, 2, 3]',
 'literal-hole-last':  '[1, 2, , ]',
 'array-of-a-length':  'Array(3)',
 'new-array':          'new Array(3)',
 'deleted':            'deleted([1, 2, 3])',
 'stored-far':         'storedFar([1])',
 'lengthened':         'lengthened([1])',
 'pushed-then-deleted': 'deleted(pushed())',
 'copy-of-a-copy':     '[1, , 3].slice()',
 'mapped':             '[1, , 3].map(x => x)',
 'of-a-parameter':     'handedOn([1, , 3])',
 'one-of-two':         'oneOf([1, 2, 3], [1, , 3])',
 'dense':              '[1, 2, 3]',
 'dense-pushed':       'pushed()',
 'dense-filled':       'Array(3).fill(7)',
 'dense-from':         'Array.from({ length: 3 })',
}
copiers = {
 'itself':         'm',
 'map':            'm.map(x => x)',
 'map-twice':      'm.map(x => x).map(x => x)',
 'slice':          'm.slice()',
 'slice-from':     'm.slice(1)',
 'concat':         'm.concat()',
 'concat-a-list':  'm.concat([4])',
 'concat-to':      '[0].concat(m)',
 'splice':         'm.splice(0, 3)',
 'spliced':        '(m.splice(0, 1), m)',
 'reverse':        'm.reverse()',
 'sort':           'm.sort()',
 'copy-within':    'm.copyWithin(0, 1)',
 'shifted':        '(m.shift(), m)',
 'unshifted':      '(m.unshift(0), m)',
 'popped':         '(m.pop(), m)',
 'pushed-to':      '(m.push(4), m)',
 'clone':          'structuredClone(m)',
 'map-by-call':    'Array.prototype.map.call(m, x => x)',
 'map-of-array-like': 'Array.prototype.map.call({ length: 3, 0: m[0] }, x => x)',
 'slice-of-array-like': 'Array.prototype.slice.call({ length: 3, 0: m[0] })',
 'filter':         'm.filter(() => true)',
 'flat':           'm.flat()',
 'flat-map':       'm.flatMap(x => [x])',
 'spread':         '[...m]',
 'from':           'Array.from(m)',
 'to-sorted':      'm.toSorted()',
 'to-reversed':    'm.toReversed()',
 'to-spliced':     'm.toSpliced(0, 0)',
 'with':           'm.with(0, 9)',
 'of':             'Array.of(...m)',
}
looks = ['1 in r', 'String(r[1])', 'r[1] === undefined', 'Object.keys(r).join()', 'r.indexOf(undefined)', 'r.includes(undefined)', 'counted(r)', 'JSON.stringify(r)', 'r.hasOwnProperty(1)', 'kinds(r)',
         'r.reduce(n => n + 1, 0)', 'stepped(r)', 'r.findIndex(x => x === undefined)', 'String(r.at(1))', 'summed(r)', '0 in r', '2 in r']
helpers = {
 'erased': '''function deleted(a) { delete a[1]; return a; }
function storedFar(a) { a[2] = 3; return a; }
function lengthened(a) { a.length = 3; return a; }
function pushed() { const a = []; for (let i = 1; i < 4; i++) a.push(i); return a; }
function handedOn(a) { return a; }
function oneOf(a, b) { return Date.now() > 0 ? b : a; }
function counted(r) { let n = 0; r.forEach(() => { n++; }); return n; }
function kinds(r) { let s = ""; for (let i = 0; i < r.length; i++) s += typeof r[i]; return s; }
function stepped(r) { let s = ""; for (const x of r) s += typeof x; return s; }
function summed(r) { let t = 0; for (let i = 0; i < r.length; i++) t += r[i]; return String(t); }''',
 'typed': '''function deleted(a: number[]): number[] { delete a[1]; return a; }
function storedFar(a: number[]): number[] { a[2] = 3; return a; }
function lengthened(a: number[]): number[] { a.length = 3; return a; }
function pushed(): number[] { const a: number[] = []; for (let i = 1; i < 4; i++) a.push(i); return a; }
function handedOn(a: number[]): number[] { return a; }
function oneOf(a: number[], b: number[]): number[] { return Date.now() > 0 ? b : a; }
function counted(r: number[]): number { let n = 0; r.forEach(() => { n++; }); return n; }
function kinds(r: number[]): string { let s = ""; for (let i = 0; i < r.length; i++) s += typeof r[i]; return s; }
function stepped(r: number[]): string { let s = ""; for (const x of r) s += typeof x; return s; }
function summed(r: number[]): string { let t = 0; for (let i = 0; i < r.length; i++) t += r[i]; return String(t); }''',
}
count = 0
for maker, made in makers.items():
    for copier, copied in copiers.items():
        for number, look in enumerate(looks):
            for flavor in ('erased', 'typed'):
                typed = flavor == 'typed'
                lines = ['// A list (%s) is copied by %s, and one look tells a hole from a value (%s).' % (maker.replace('-', ' '), copier.replace('-', ' '), flavor), helpers[flavor]]
                lines.append(('function look(r: number[]) { return %s; }' if typed else 'function look(r) { return %s; }') % look)
                lines.append(('const m: number[] = %s as number[];' if typed else 'const m = %s;') % made)
                lines.append(('console.log(look(%s as number[]));' if typed else 'console.log(look(%s));') % copied)
                with open(os.path.join(out, '%s-%s-%d-%s.%s' % (maker, copier, number, flavor, 'ts' if typed else 'mjs')), 'w') as f:
                    f.write('\n'.join(lines) + '\n')
                count += 1
print(count, 'programs')
