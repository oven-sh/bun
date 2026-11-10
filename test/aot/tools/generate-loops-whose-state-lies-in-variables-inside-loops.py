# generate-loops-whose-state-lies-in-variables-inside-loops.py <folder>: all 576; ../parallel/loops-whose-state-lies-in-variables-inside-loops/ holds 8 of them: A LOOP WHOSE STATE LIES IN VARIABLES STANDS INSIDE ANOTHER LOOP THAT IS BUILT TWICE. The outer turn does a deed, the inner loop runs, and behind it (or in front, or in it) a guess fails.
# What the outer turn has done may not happen twice, and what the inner loop has moved stays moved. After the family of nested turns, with the inner loop's state in an environment or in a module.
import sys, os
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
for f in os.listdir(out): os.remove(out + '/' + f)
outers = {
 'counted': ('for (let r = 0; r < rows.length; r++) { const row = rows[r]; const extra = extras[r];', '}'),
 'counted-down': ('for (let r = rows.length - 1; r >= 0; r--) { const row = rows[r]; const extra = extras[r];', '}'),
 'for-of': ('let r = -1; for (const row of rows) { r++; const extra = extras[r];', '}'),
 'while': ('let r = 0; while (r < rows.length) { const row = rows[r]; const extra = extras[r]; r++;', '}'),
}
inners = {
 'skips-blanks': 'begin(row.text); while (at < limit && text.charCodeAt(at) === 32) at++; total += at;',
 'skips-blanks-through-a-callee': 'begin(row.text); while (at < limit && unitAt(at) === 32) at++; total += at;',
 'goes-on-where-the-last-turn-stopped': 'limit = text.length; while (at < limit && text.charCodeAt(at) === 32) at++; total += at; at = at >= limit ? 0 : at + 1;',
 'counts-beside': 'begin(row.text); let seen = 0; while (at < limit && text.charCodeAt(at) === 32) { at++; seen++; } total += seen;',
}
deeds = {
 'no-deed': ('', '', ''),
 'a-field-is-stepped-in-front': ('state.count++;', '', ''),
 'a-field-is-stepped-behind': ('', '', 'state.count++;'),
 'a-list-is-pushed-to-in-front': ('log.push(r);', '', ''),
 'a-variable-is-stepped-in-front': ('deeds++;', '', ''),
 'the-shared-variable-is-stepped-in-front': ('turns++;', '', ''),
}
misfits = { 'read-in-front-of-the-inner-loop': 0, 'read-behind-the-inner-loop': 2 }
lies = {
 'an-object-of-another-make': "extras[7] = JSON.parse('{\"value\":1}');",
 'a-text-of-another-kind': "rows[7] = { text: new String('   x') as any };",
 'the-position-is-a-fraction-once': "(globalThis as any).once = 7;",
}
homes = {
 'an-environment': '''function make() {
  let text = ""; let at = 0; let limit = 0; let turns = 0;
  function begin(next: string) { text = next; at = (globalThis as any).once === turns ? 0.5 : 0; limit = text.length; }
  function unitAt(i: number) { return text.charCodeAt(i); }
  function run(rows: Row[], extras: Box[], state: { count: number }, log: number[]): number { let total = 0; BODY return total + turns; }
  return run;
}
const run = make();
''',
 'a-module': '''let text = ""; let at = 0; let limit = 0; let turns = 0;
function begin(next: string) { text = next; at = (globalThis as any).once === turns ? 0.5 : 0; limit = text.length; }
function unitAt(i: number) { return text.charCodeAt(i); }
function run(rows: Row[], extras: Box[], state: { count: number }, log: number[]): number { let total = 0; BODY return total + turns; }
''',
}
n = 0
for h, home in homes.items():
  for o, (head, end) in outers.items():
    for i, inner in inners.items():
      for d, (front, _, behind) in deeds.items():
        for m, where in misfits.items():
          for l, lie in lies.items():
            if l != 'an-object-of-another-make' and (m != 'read-behind-the-inner-loop' or o not in ('counted', 'for-of')): continue
            read = 'total += extra.value;'
            body = head + ' ' + front + ' ' + (read if where == 0 else '') + ' ' + inner + ' ' + behind + ' ' + (read if where == 2 else '') + ' ' + end
            text = '''type Box = { value: number }; type Row = { text: string };
const unseen = (0, eval)("(x) => x");
let deeds = 0;
''' + home.replace('BODY', body) + '''const rows: Row[] = []; const extras: Box[] = []; const state = { count: 0 }; const log: number[] = [];
for (let r = 0; r < 12; r++) { rows.push({ text: " ".repeat(r % 5) + "x" }); extras.push({ value: 1 }); }
''' + lie + '''
for (let k = 0; k < 3; k++) console.log(run(unseen(rows), unseen(extras), unseen(state), unseen(log)), deeds, state.count, log.length, log.join(""));
'''
            open('%s/%s-%s-around-%s-%s-the-misfit-%s-%s.ts' % (out, h, o, i, d, m, l), 'w').write(text); n += 1
print(n, 'programs')
