#!/usr/bin/env python3
# generate-turns-of-loops-around-loops.py <folder>: all 1,560; ../parallel/turns-of-loops-around-loops/ holds 8 of them: a typed loop inside a typed loop, a deed in the outer turn, a guess that fails
# behind the inner loop: the outer turn began again and the deed was done twice. ONE SHAPE A PROGRAM, each built alone:
# THE OUTER LOOP MUST BE BUILT TWICE BY ITSELF, or every answer is right for nothing: `table.scale`, off a value from in front of the loop of which something is expected, is asked in front of it.
# 4 outer loops x 13 inner loops x (3 deeds x 3 places, and no deed) x 3 places of the object that fails the guess. Each prints the sum and every trace that a deed leaves, for three calls.
import os, sys
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
OUTER = {
    'counted': ('for (let r = 0; r < rows.length; r++) { const row = rows[r];', '}'),
    'for-of': ('let r = 0; for (const row of rows) {', 'r++; }'),
    'while': ('let r = 0; while (r < rows.length) { const row = rows[r];', 'r++; }'),
    'counted-down': ('for (let r = rows.length - 1; r >= 0; r--) { const row = rows[r];', '}'),
}
INNER = {
    'counted': 'for (let i = 0; i < row.length; i++) { sum += row[i].value; INSIDE }',
    'for-of': 'for (const box of row) { sum += box.value; INSIDE }',
    'while': 'let i = 0; while (i < row.length) { sum += row[i].value; INSIDE i++; }',
    'two-in-a-row': 'for (let i = 0; i < row.length; i++) { sum += row[i].value; INSIDE } for (let j = 0; j < row.length; j++) sum += row[j].value;',
    'a-loop-in-it': 'for (let i = 0; i < row.length; i++) { for (let j = 0; j < 2; j++) sum += row[i].value; INSIDE }',
    'left-early': 'for (let i = 0; i < row.length; i++) { if (i === 4) break; sum += row[i].value; INSIDE }',
    'no-turn-for-some': 'for (let i = 0; i < (r & 1 ? row.length : 0); i++) { sum += row[i].value; INSIDE }',
    # THE COUNTER OF THE INNER LOOP IS READ BEHIND IT: without that a fault in the turns of the outer loop does not show: with `let i` inside the `for` the answer is right.
    'counted-and-the-counter-read-behind': 'let i = 0; for (; i < row.length; i++) { sum += row[i].value; INSIDE } total += i & 7;',
    'while-and-the-counter-read-behind': 'let i = 0; while (i < row.length) { sum += row[i].value; INSIDE i++; } total += i & 7;',
    'for-of-and-a-count-read-behind': 'let seen = 0; for (const box of row) { sum += box.value; seen++; INSIDE } total += seen & 7;',
    'left-early-and-the-counter-read-behind': 'let i = 0; for (; i < row.length; i++) { if (i === 4) break; sum += row[i].value; INSIDE } total += i & 7;',
    'two-in-a-row-and-both-counters-read-behind': 'let i = 0; for (; i < row.length; i++) { sum += row[i].value; INSIDE } let j = 0; for (; j < row.length; j++) sum += row[j].value; total += (i & 7) + (j & 3);',
    'no-turn-for-some-and-the-counter-read-behind': 'let i = 0; for (; i < (r & 1 ? row.length : 0); i++) { sum += row[i].value; INSIDE } total += i & 7;',
}
DEEDS = {'a-variable-is-stepped': 'deeds++;', 'a-list-is-pushed-to': 'log.push(r);', 'a-field-is-stepped': 'state.count++;'}
PLACES = ('in-front-of-the-inner-loop', 'in-the-inner-loop', 'behind-the-inner-loop')
MISFITS = {
    'read-behind-the-inner-loop': ('extras[7] = JSON.parse(\'{"value":1}\');', '', 'extra.value'),
    'read-in-the-inner-loop': ('rows[7][2] = JSON.parse(\'{"value":1}\');', '', '1'),
    'read-in-front-of-the-inner-loop': ('extras[7] = JSON.parse(\'{"value":1}\');', 'total += extra.value;', '1'),
}
for outer, (opened, closed) in OUTER.items():
    for inner, loop in INNER.items():
        for deed, place in [(None, None)] + [(deed, place) for deed in DEEDS for place in PLACES]:
            for misfit, (laid, front, behind) in MISFITS.items():
                done = DEEDS[deed] if deed else ''
                body = ' '.join([opened, 'total += table.scale;', 'const extra = extras[r];', done if place == PLACES[0] else '', front, 'let sum = 0;', loop.replace('INSIDE', done if place == PLACES[1] else ''),
                                 done if place == PLACES[2] else '', f'total += (sum | 0) + {behind};', closed])
                name = f'{outer}-around-{inner}-{(deed + "-" + place) if deed else "no-deed"}-the-misfit-{misfit}'
                text = '\n'.join([f'// a {outer} loop around: {inner}; {(deed + " " + place).replace("-", " ") if deed else "no deed"}; the object that fails the guess is {misfit.replace("-", " ")}',
                                  'type Box = { value: number };', 'const unseen = (0, eval)("(x) => x");', 'let deeds = 0;',
                                  f'function run(rows: Box[][], extras: Box[], state: {{ count: number }}, log: number[], tables: {{ scale: number }}[]): number {{ const table = tables[0]; let total = 0; {body} return total; }}',
                                  'const rows: Box[][] = []; const extras: Box[] = []; const state = { count: 0 }; const log: number[] = [];',
                                  'for (let r = 0; r < 12; r++) { const row: Box[] = []; for (let i = 0; i < 6; i++) row.push({ value: 1 }); rows.push(row); extras.push({ value: 1 }); }',
                                  laid,
                                  'for (let k = 0; k < 3; k++) console.log(run(unseen(rows), unseen(extras), unseen(state), unseen(log), unseen([{ scale: 2 }])), deeds, state.count, log.length, log.join(""));']) + '\n'
                open(os.path.join(OUT, name + '.ts'), 'w').write(text)
print(len(os.listdir(OUT)), 'programs')
