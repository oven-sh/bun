# generate-sums-cut-to-an-int32-over-lists.py <folder>: all 127; ../parallel/sums-that-are-cut-to-an-int32-over-lists/ holds 8 of them beside 8 written by hand: of each kernel one that the fault which was tried turned red: one kernel, one kind of list, one deed a program.
import os, sys
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
kernels = {
    'a-sum-or-zero-by-index': 'function run(xs: number[], from: number): number { let s = from | 0; for (let i = 0; i < xs.length; i++) s = (s + xs[i]!) | 0; return s; }',
    'a-sum-or-zero-for-of': 'function run(xs: number[], from: number): number { let s = from | 0; for (const x of xs) s = (s + x) | 0; return s; }',
    'a-difference-shifted-by-nothing': 'function run(xs: number[], from: number): number { let s = from >>> 0; for (let i = 0; i < xs.length; i++) s = (s - xs[i]!) >>> 0; return s; }',
    'a-sum-under-a-mask': 'function run(xs: number[], from: number): number { let s = from & 65535; for (let i = 0; i < xs.length; i++) s = (s + xs[i]!) & 65535; return s; }',
    'a-hash-by-a-small-product': 'function run(xs: number[], from: number): number { let h = from | 0; for (let i = 0; i < xs.length; i++) h = (h * 31 + xs[i]!) | 0; return h; }',
    'a-read-under-a-mask': 'function run(xs: number[], from: number): number { let s = from | 0; for (let i = 0; i < 37; i++) s = (s + xs[i & 7]!) | 0; return s; }',
    'a-sum-that-is-stored-into-a-view': 'const kept = new Int32Array(40);\nfunction run(xs: number[], from: number): number { let s = from | 0; for (let i = 0; i < xs.length; i++) { s = (s + xs[i]!) | 0; kept[i] = s; } return s ^ kept[xs.length >> 1]!; }',
    'a-large-constant-beside-the-element': 'function run(xs: number[], from: number): number { let s = from | 0; for (let i = 0; i < xs.length; i++) s = (s * 1103515245 + xs[i]!) | 0; return s; }',
}
lists = {}
for n in (4, 7, 20):
    lists['%d-whole-numbers' % n] = 'const xs: number[] = []; for (let i = 0; i < %d; i++) xs.push((i * 3 + 1) & 255);' % n
    for p in sorted({0, 1, n // 2, n - 1}):
        lists['%d-places-and-a-hole-at-%d' % (n, p)] = 'const xs: number[] = new Array(%d); for (let i = 0; i < %d; i++) if (i !== %d) xs[i] = (i * 3 + 1) & 255;' % (n, n, p)
lists['20-of-the-widest-int32s'] = 'const xs: number[] = []; for (let i = 0; i < 20; i++) xs.push(i & 1 ? 2147483647 : -2147483648);'
count = 0
for k, kernel in kernels.items():
    for l, made in lists.items():
        if l.startswith('4-') and k == 'a-sum-or-zero-for-of' and 'hole-at-2' in l: continue
        open('%s/%s-over-%s.ts' % (out, k, l), 'w').write('%s\n%s\nconsole.log([0, 5, -1, 2147483647, -2147483648, 123456789].map(from => run(xs, from)).join(" "));\n' % (kernel, made)); count += 1
print(count)
