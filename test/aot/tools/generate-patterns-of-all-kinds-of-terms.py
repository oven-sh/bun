#!/usr/bin/env python3
"""generate-patterns-of-all-kinds-of-terms.py <seed> <patterns> <out.cjs>: a program of literal patterns MADE BY A GENERATOR from all kinds of terms, each with texts sampled from its own tree and near misses of them, laid behind and in front of fillers of many lengths, narrow and wide.
The program prints one digest a pattern group and one for all; what is right is what `bun <file>` prints. With the word `rows` as its parameter it prints a line a pattern."""
import random, sys, json
seed, count, out = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
R = random.Random(seed)
UNITS = list("abezq-:#71 Kks=/'") + ['é']
WIDE = ['│', 'K', 'ſ']
CLASSES = ['[a-z]', '[0-9]', '[ab]', '[^=]', "[^' >]", '[a-z0-9-]', '\\d', '\\w', '\\s', '\\S', '[zq]', '[Kk]', '[^a-z]', '[\\u00e0-\\u00ff]']
MEMBERS = {'[a-z]': 'abezqks', '[0-9]': '17', '[ab]': 'ab', '[^=]': 'ab-7 :', "[^' >]": 'ab-7:=', '[a-z0-9-]': 'az17-', '\\d': '17', '\\w': 'aZ7_', '\\s': ' \t', '\\S': 'a7-:', '[zq]': 'zq', '[Kk]': 'Kk', '[^a-z]': 'K7-: ', '[\\u00e0-\\u00ff]': 'éü'}
ESC = set('-/#:=.\'')
def lit(u):
    if u == '/': return '\\/'
    if u == 'é': return R.choice(['é', '\\u00e9', '\\xe9'])
    if ord(u) > 255: return '\\u%04x' % ord(u)
    return u
QUANTS = ['', '', '', '', '', '', '?', '?', '*', '+', '{0,2}', '{1,3}', '{2}', '{3}', '??', '*?', '+?', '{0,1}']
def times(q):
    return {'': (1, 1), '?': (0, 1), '*': (0, 3), '+': (1, 3), '{0,2}': (0, 2), '{1,3}': (1, 3), '{2}': (2, 2), '{3}': (3, 3), '??': (0, 1), '*?': (0, 3), '+?': (1, 3), '{0,1}': (0, 1)}[q]
class Maker:
    def __init__(self, wide): self.groups = 0; self.wide = wide; self.unbounded = 0
    def atom(self, depth):
        k = R.random()
        if k < 0.50: u = R.choice(UNITS + (WIDE if self.wide else [])); return ('unit', u)
        if k < 0.68: return ('class', R.choice(CLASSES))
        if k < 0.74: return ('dot',)
        if k < 0.90 and depth < 2:
            capture = R.random() < 0.4
            if capture: self.groups += 1; number = self.groups
            else: number = 0
            return ('group', number, [self.alternative(depth + 1, 1, 3) for _ in range(R.choice([1, 1, 2, 2, 3]))])
        if k < 0.93 and depth < 2: return ('look', R.choice(['?=', '?!', '?<=', '?<!']), [self.alternative(depth + 1, 1, 2)])
        if k < 0.95 and self.groups: return ('back', R.randint(1, self.groups))
        if k < 0.97: return ('assert', '\\b')
        return ('unit', R.choice(UNITS))
    def alternative(self, depth, least, most):
        terms = []
        for _ in range(R.randint(least, most)):
            atom = self.atom(depth); q = R.choice(QUANTS)
            if q in ('*', '+', '*?', '+?'):
                if atom[0] in ('group', 'back') or self.unbounded >= 2: q = R.choice(['?', '{0,2}', '{1,3}', ''])
                else: self.unbounded += 1
            if atom[0] == 'group' and q in ('{1,3}', '{3}', '{0,2}') and depth: q = '?'
            terms.append((atom, q))
        return terms
def text(alternative):
    s = ''
    for atom, q in alternative:
        kind = atom[0]
        if kind == 'unit': t = lit(atom[1])
        elif kind == 'class': t = atom[1]
        elif kind == 'dot': t = '.'
        elif kind == 'group': t = ('(' if atom[1] else '(?:') + '|'.join(text(a) for a in atom[2]) + ')'
        elif kind == 'look': t = '(' + atom[1] + '|'.join(text(a) for a in atom[2]) + ')'; q = ''
        elif kind == 'back': t = '(?:\\%d)' % atom[1]
        else: t = atom[1]; q = ''
        s += t + q
    return s
def sample(alternative, caught, fold):
    s = ''
    for atom, q in alternative:
        kind = atom[0]; lo, hi = times(q)
        if kind in ('look', 'assert'): continue
        for _ in range(R.randint(lo, hi)):
            if kind == 'unit': u = atom[1]; s += (u.swapcase() if fold and R.random() < 0.5 and len(u.swapcase()) == 1 else u)
            elif kind == 'class': s += R.choice(MEMBERS[atom[1]])
            elif kind == 'dot': s += R.choice('abq7-: x')
            elif kind == 'group':
                t = sample(R.choice(atom[2]), caught, fold); s += t
                if atom[1]: caught[atom[1]] = t
            elif kind == 'back': s += caught.get(atom[1], '')
    return s
rows = []
while len(rows) < count:
    wide = R.random() < 0.15
    m = Maker(wide)
    def framed():
        one = lambda: ((('unit', R.choice(UNITS + (WIDE if wide else []))), ''))
        return m.alternative(0, 0, 2) + [one()] + m.alternative(0, 0, 3) + [one()] + m.alternative(0, 1, 3)
    alternatives = [framed() if R.random() < 0.8 else m.alternative(0, 2, 7) for _ in range(R.choice([1, 1, 1, 1, 1, 2, 2, 3]))]
    source = '|'.join(text(a) for a in alternatives)
    if R.random() < 0.04: source = '^' + source
    if R.random() < 0.06: source = source + '$'
    flags = ''.join(f for f, p in (('g', 0.3), ('i', 0.3), ('m', 0.15), ('s', 0.1), ('u', 0.12), ('y', 0.04)) if R.random() < p)
    if 'u' in flags and ("\\-" in source or "\\'" in source or '\\:' in source or '\\#' in source or '\\=' in source): continue
    samples = []
    for _ in range(4):
        t = sample(R.choice(alternatives), {}, 'i' in flags); samples.append(t)
        if t:
            k = R.randrange(len(t)); samples.append(t[:k] + R.choice('abz7-:x') + t[k + 1:]); samples.append(t[:k] + t[k + 1:])
    rows.append((source, flags, sorted(set(samples))))
body = '''"use strict";
// Made by tools/generate-patterns-of-all-kinds-of-terms.py, seed %d: %d patterns from all kinds of terms. What is right is what `bun <file>` prints.
const rows = [
%s
];
const wants = process.argv[2] ?? "";
const fillers = JSON.parse(%s), lengths = JSON.parse("[0,1,2,7,8,15,16,17,31,33,40]"), tails = JSON.parse("[0,1,16,40]");
let all = 0, cells = 0, found = 0;
const fold = (h, t) => { for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) %% 1000000007; return h; };
for (let r = 0; r < rows.length; r++) {
  const [pattern, samples] = rows[r];
  let h = 7;
  for (const sample of samples) for (const filler of fillers) for (const lead of lengths) for (const tail of tails) {
    if ((lead * 7 + tail + sample.length + filler.length) %% 3 && lead > 2 && tail) continue;
    const textOf = n => { let t = ""; while (t.length < n) t += filler; return t.slice(0, n); };
    const text = textOf(lead) + sample + textOf(tail);
    for (const subject of [text, "\\u2502" + text]) {
      pattern.lastIndex = 0;
      const a = pattern.exec(subject);
      cells++; if (a) found++;
      h = fold(h, a ? a.index + ":" + a.join("|") + ":" + pattern.lastIndex : "none");
      pattern.lastIndex = Math.min(lead, 3);
      h = fold(h, String(pattern.test(subject)) + pattern.lastIndex);
      pattern.lastIndex = 0;
      h = fold(h, String(subject.search(pattern)) + subject.replace(pattern, "<>").length);
    }
  }
  all = fold(all, String(h));
  if (wants === "rows") console.log(r + " " + h);
}
console.log("SAID cells " + cells + " found " + found + " digest " + all);
'''
lines = ',\n'.join('  [/%s/%s, JSON.parse(%s)]' % (s, f, json.dumps(json.dumps(x))) for s, f, x in rows)
open(out, 'w').write(body % (seed, count, lines, json.dumps(json.dumps(['.', 'ab', 'e-', 'the quick brown fox ', 'a:b-z7#q', 'Kkés ']))))
