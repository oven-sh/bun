#!/usr/bin/env python3
# generate-switches-over-written-integers.py <folder>: all 189; ../parallel/switches-over-written-integers/ holds 8 of them, each of which a fault laid into the compiler on purpose has turned red.
# One program for each list of cases and each way in which the subject is held where the switch stands. A compiler may tell cases that lead to few places apart by the bits of a mask, by a byte of a table or by
# a test of a range. Each program asks about every integer round its cases, the same integers moved by 2 ** 32, the halves between them, and what is no integer.
import os, sys
out = sys.argv[1]; os.makedirs(out, exist_ok=True)

# name: [(cases, what the arm gives back)], the rest gives 0
sets = {
    'one-place-from-zero': [([0, 3, 5, 9, 63], 1)],
    'one-place-from-one': [([1, 5, 9, 12, 17, 23, 31, 40], 1)],
    'one-place-three-cases': [([4, 9, 30], 1)],
    'one-place-four-cases': [([4, 9, 30, 41], 1)],
    'one-place-span-of-63': [([81, 84, 85, 90, 97, 103, 143], 1)],
    'one-place-span-of-64': [([80, 84, 85, 90, 97, 103, 143], 1)],
    'one-place-span-of-65': [([80, 84, 85, 90, 97, 103, 144], 1)],
    'one-place-ends-at-63': [([10, 20, 30, 40, 63], 1)],
    'one-place-ends-at-64': [([10, 20, 30, 40, 64], 1)],
    'one-place-below-zero': [([-5, -3, -1, 0, 2, 7], 1)],
    'one-place-all-below-zero': [([-90, -88, -70, -61, -40], 1)],
    'one-place-at-the-greatest-int32': [([2147483640, 2147483643, 2147483645, 2147483647], 1)],
    'one-place-at-the-least-int32': [([-2147483648, -2147483646, -2147483644, -2147483641], 1)],
    'one-place-beyond-int32': [([4294967297, 4294967299, 4294967301, 4294967303], 1)],
    'one-place-without-a-gap': [(list(range(100, 110)), 1)],
    'one-place-without-a-gap-of-64': [(list(range(200, 264)), 1)],
    'one-place-without-a-gap-from-zero': [(list(range(0, 12)), 1)],
    'one-place-wide': [([81, 84, 85, 90, 168, 169, 171, 172, 174, 208, 209, 219, 226, 260, 262, 263, 264, 265, 266, 267, 271, 273, 276, 281, 303, 304, 306, 346, 348, 370], 1)],
    'one-place-wide-and-thin': [([10, 200, 400, 600, 800], 1)],
    'one-place-two-windows-and-stragglers': [([3, 10, 11, 12, 13, 70, 300, 301, 305, 309, 500], 1)],
    'two-places': [([81, 84, 85, 90, 97, 103], 1), ([104, 111, 120, 126, 133, 139], 2)],
    'two-places-without-a-gap': [([20, 22, 24, 26, 28], 1), ([21, 23, 25, 27], 2)],
    'two-places-wide': [([81, 84, 85, 90, 300, 301], 1), ([104, 111, 120, 126, 310, 311, 312, 313], 2)],
    'three-places': [([5, 8, 11, 14], 1), ([6, 9, 12, 15], 2), ([7, 10, 13, 16], 3)],
    'four-places': [([5, 9, 13, 17], 1), ([6, 10, 14, 18], 2), ([7, 11, 15, 19], 3), ([8, 12, 16, 20], 4)],
    'a-case-that-gives-what-the-rest-gives': [([5, 8, 11, 14], 1), ([6, 9], 0)],
    'many-places-beside-a-run-to-one-place': [([1, 2, 3, 4, 5, 6], 1), ([40], 2), ([41], 3), ([42], 4), ([43], 5), ([44], 6), ([45], 7)],
}

# how the subject is held where the switch stands
forms = {
    'an-int32': ('function ask(x) { return weigh(x | 0); }', 'int32'),
    'a-written-number': ('function ask(x: number) { return weigh(x); }', 'number'),
    'anything': ('function ask(x: any) { return weigh(x); }', 'any'),
    'an-element-of-a-list-of-numbers': ('const held: number[] = [0.5]; function ask(x: number) { held[0] = x; return weigh(held[0]); }', 'number'),
    'an-element-that-may-be-absent': ('const held: number[] = [1, 2, 3]; function ask(x: number, at: number) { held[1] = x; return weigh(held[at]); }', 'absent'),
    'a-field-of-a-class': ('class Leaf { kind: number; constructor(kind: number) { this.kind = kind; } } const leaf = new Leaf(0); function ask(x: number) { leaf.kind = x; return weigh(leaf.kind); }', 'number'),
    'a-length': ('function ask(x: number) { return x >= 0 && x < 700 && Math.floor(x) === x ? weigh("#".repeat(x).length) : -1; }', 'number'),
}

for name, arms in sets.items():
    every = sorted(c for cases, _ in arms for c in cases)
    body = ' '.join(' '.join('case %d:' % c for c in cases) + ' return %d;' % gives for cases, gives in arms)
    near = sorted({p for c in every for p in range(c - 2, c + 3)} | set(range(every[0] - 70, every[0])) | set(range(every[-1] + 1, every[-1] + 71)) | (set(range(every[0], every[-1] + 1)) if every[-1] - every[0] < 900 else set()))
    for form, (ask, kind) in forms.items():
        typed = 'x: any' if kind in ('any', 'absent') else 'x: number'
        span = every[-1] - every[0] + 1
        places = len({gives for _, gives in arms if gives})
        count = 'SwitchesLoweredToByteTables' if places == 1 and len(every) >= 4 and 64 < span <= 64 * len(every) else 'SwitchBitTestsEmitted'
        lines = [
            '// A switch over written integers, %s, asked of %s: every integer round its cases, the same moved by 2 ** 32, the halves between them, and what is no integer.' % (name.replace('-', ' '), form.replace('-', ' ')),
            '// STATISTIC: %s >= 1' % count,
            'function weigh(%s): number { switch (x) { %s default: return 0; } }' % (typed, body),
            ask.replace('function ask(x)', 'function ask(x: number)'),
            'const near: number[] = %s;' % near,
            'const odd: any[] = [-0, 0.5, -0.5, NaN, Infinity, -Infinity, 1e19, -1e19, 4294967296, -4294967296, 9007199254740991, -9007199254740991, 2147483648, -2147483649];',
            'const strange: any[] = [undefined, null, true, false, "5", "", 5n, {}, [], [5], { valueOf() { return 5; } }];',
            'let sum = 0, seen = 0; const tally = [0, 0, 0, 0, 0, 0, 0, 0, 0];',
            'function note(given: number, place: number) { tally[given + 1]++; sum = (Math.imul(sum, 31) + given + place) | 0; seen++; }',
            'for (let round = 0; round < 3; round++) {',
        ]
        call = 'ask(%s, 1)' if kind == 'absent' else 'ask(%s)'
        lines.append('  for (let i = 0; i < near.length; i++) { note(%s, i); note(%s, i); note(%s, i); note(%s, i); }' % (call % 'near[i]', call % '(near[i] + 4294967296)', call % '(near[i] - 4294967296)', call % '(near[i] + 0.5)'))
        lines.append('  for (let i = 0; i < odd.length; i++) note(%s, i);' % (call % 'odd[i]'))
        if kind == 'any':
            lines.append('  for (let i = 0; i < strange.length; i++) note(ask(strange[i]), i);')
        if kind == 'absent':
            lines.append('  for (let at = 0; at < 6; at++) note(ask(%d, at), at);' % every[0])
        lines += ['}', 'console.log(sum, seen, tally.join(" "));']
        open(os.path.join(out, '%s-asked-of-%s.ts' % (name, form)), 'w').write('\n'.join(lines) + '\n')
print(len(sets) * len(forms), 'programs')
