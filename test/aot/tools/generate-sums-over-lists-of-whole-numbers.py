# generate-sums-over-lists-of-whole-numbers.py <folder>: all 96; ../parallel/sums-over-lists-of-whole-numbers/ holds 14 of them: of each fault that was tried, programs that it turned red, and one of each kind of list: one loop, one kind of list, one deed a program.
import os, sys
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
forms = {
    'for-of': 'function sum(list: number[], from: number): number { let s = from; for (const v of list) s += v; return s; }',
    'by-index': 'function sum(list: number[], from: number): number { let s = from; for (let i = 0; i < list.length; i++) s += list[i]; return s; }',
    'in-a-nest': 'function sum(list: number[], from: number): number { let s = from; for (const r of [list, list]) for (const v of r) s += v; return s; }',
}
show = 'const show = (x: number) => Object.is(x, -0) ? "-0" : String(x);'
starts = ['0', '-0', '0.5', '-0.25', '2 ** 52', '2 ** 52 + 1', '2 ** 53 - 20', '2 ** 53 - 1', '-(2 ** 52)', '-(2 ** 53) + 3', '4503599627370495.5', 'NaN', 'Infinity', '-Infinity', '1e300']
lists = {
    'ones': 'for (let j = 0; j < 40; j++) list.push(1);',
    'zeros': 'for (let j = 0; j < 40; j++) list.push(0);',
    'the-widest-int32s': 'for (let j = 0; j < 41; j++) list.push(j & 1 ? 2147483647 : -2147483648);',
    'negative-numbers': 'for (let j = 0; j < 43; j++) list.push(-j * 1000003 | 0);',
}
def write(name, lines):
    open(os.path.join(out, name + '.ts'), 'w').write('\n'.join(lines) + '\n')
for f, text in forms.items():
    for l, fill in lists.items():
        write('%s-over-%s-from-every-start' % (f, l), [text, show, 'const list: number[] = []; ' + fill] + ['console.log(show(sum(list, %s)));' % s for s in starts])
    write('%s-over-lists-of-every-length' % f, [text, 'const make = (n: number) => { const list: number[] = []; for (let j = 0; j < n; j++) list.push(j * 3 - 7); return list; };'] + ['console.log(sum(make(%d), 1));' % n for n in range(0, 27)])
    for p in (0, 1, 3, 7, 8, 12, 15, 16, 23, 24, 25):
        write('%s-with-a-hole-at-%d' % (f, p), [text, 'const list: number[] = new Array(26); for (let j = 0; j < 26; j++) if (j !== %d) list[j] = j + 1;' % p, 'console.log(sum(list, 0), sum(list, 5));'])
    for value, name in (('2147483647', 'the-largest'), ('-2147483648', 'the-smallest')):
        for start in ('0', '2 ** 51', '-(2 ** 51)', '2 ** 52 - 5', '-(2 ** 52) + 5'):
            write('%s-over-more-than-two-stretches-of-%s-int32-from-%s' % (f, name, start.replace(' ', '').replace('**', 'to').replace('(', '').replace(')', '')), [text, 'const list: number[] = []; for (let j = 0; j < 2200003; j++) list.push(%s);' % value, 'console.log(sum(list, %s));' % start])
    write('%s-over-whole-numbers-kept-as-doubles' % f, [text, 'const list: number[] = []; for (let j = 0; j < 40; j++) list.push(1700000000000 + j);', 'console.log(sum(list, 0), sum(list, 0.5));'])
    write('%s-over-a-list-that-turns-to-doubles' % f, [text, 'const list: number[] = []; for (let j = 0; j < 40; j++) list.push(j);', 'console.log(sum(list, 0));', 'list[20] = 2 ** 31;', 'console.log(sum(list, 0));'])
counter = 'function sum(n: number, from: number): number { let s = from; for (let i = 0; i < n; i++) s += i; return s; }'
for n in (0, 1, 7, 8, 9, 100, 3000000):
    write('the-counter-itself-is-summed-up-to-%d' % n, [counter, show] + ['console.log(show(sum(%d, %s)));' % (n, s) for s in starts])
for start in ('0', '2 ** 52', '2 ** 52 - 1000000000000', '-(2 ** 52)', '2 ** 51'):
    write('the-counter-itself-is-summed-past-what-a-double-holds-from-%s' % start.replace(' ', '').replace('**', 'to').replace('(', '').replace(')', ''), [counter, 'console.log(sum(100000000, %s));' % start])
