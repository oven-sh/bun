#!/usr/bin/env python3
# generate-texts-that-lose-their-characters.py <folder>: a loop reads the characters of a text that was made flat in front of it, through a raw pointer, and in some turns something is done
# that takes the characters away from the text's cell, or the cell away from everybody: the text becomes a key for which an equal key of another buffer (and of the other width) exists,
# nobody but the loop holds the text, a collection runs, and what is freed is filled again. Held to `bun <file>`. No suspension anywhere: test/aot/parallel/flat-texts-over-suspensions has those.
import sys, os, itertools
folder = sys.argv[1]; os.makedirs(folder, exist_ok=True)
texts = {
  'a-piece-of-a-wide-text': ('("\\u0100" + "abcdefgh".repeat(n)).slice(1)', '"abcdefgh".repeat(n)'),
  'a-piece-of-a-narrow-text': ('("x" + "abcdefgh".repeat(n)).slice(1)', '"abcdefgh".repeat(n)'),
  'a-rope': ('"abcdefgh".repeat(n) + String(n) + "ijklmnop".repeat(n)', '["abcdefgh".repeat(n), String(n), "ijklmnop".repeat(n)].join("")'),
  'a-joined-list': ('Array.from({ length: n }, (_, at) => "ab" + (at % 7)).join("")', 'Array.from({ length: n }, (_, at) => "ab" + (at % 7)).join("") + ""'),
  'a-piece-whose-base-goes': ('pieceOf("abcdefgh".repeat(n) + String(n))', '("abcdefgh".repeat(n) + String(n)).split("").slice(3, -1).join("")'),
  'a-piece-of-a-piece-whose-bases-go': ('pieceOf(pieceOf("\\u0100" + "abcdefgh".repeat(n) + String(n)))', '("abcdefgh".repeat(n) + String(n)).split("").slice(5, -2).join("")'),
  'a-wide-rope': ('"ab\\u0100d".repeat(n) + String(n)', '["ab\\u0100d".repeat(n), String(n)].join("")'),
}
deeds = {
  'is-stored-under': 'seen[TEXT] = 1; return 1;',
  'is-read-under': 'return seen[TEXT] ?? 0;',
  'is-looked-for-with-in': 'return TEXT in seen ? 1 : 0;',
  'is-asked-of-has-own-property': 'return seen.hasOwnProperty(TEXT) ? 1 : 0;',
  'is-asked-of-object-has-own': 'return Object.hasOwn(seen, TEXT) ? 1 : 0;',
  'names-a-symbol': 'return Symbol.for(TEXT).description!.length & 1;',
  'is-deleted-under': 'return delete seen[TEXT] ? 1 : 0;',
  'is-a-computed-key': 'return Object.keys({ [TEXT]: 1 }).length;',
  'is-a-key-of-a-map-and-a-set': 'map.set(TEXT, 1); return set.has(TEXT) ? 1 : 0;',
  'is-left-alone': 'return 1;',
}
places = ['in-the-turn', 'in-a-copied-function', 'out-of-sight']
holders = ['held-by-the-loop-alone', 'held-by-a-variable-too']
count = 0
for (textName, (made, equal)), (deedName, deed), place, holder in itertools.product(texts.items(), deeds.items(), places, holders):
    if place == 'out-of-sight' and deedName == 'is-left-alone' and holder == 'held-by-a-variable-too':
        continue
    lines = ['// ' + ' '.join([textName, deedName, place, holder]).replace('-', ' ')]
    lines.append('const seen: Record<string, number> = {};\nconst map = new Map<string, number>();\nconst set = new Set<string>();\nconst held = { text: "" };\nlet kept = "";')
    if 'pieceOf' in made:
        lines.append('function pieceOf(base: string): string {\n  base.charCodeAt(1);\n  return base.slice(3, base.length - 1);\n}')
    lines.append(f'function made(n: number): string {{\n  return {made};\n}}')
    lines.append(f'function equalKey(n: number): string {{\n  return {equal};\n}}')
    lines.append('function churn() {\n  Bun.gc(true);\n  let sum = 0;\n  for (let i = 0; i < 300; i++) sum += ("\\u0100" + String(i % 10).repeat(700 + (i & 63))).slice(1).charCodeAt(3) + ("y" + String(i % 10).repeat(700 + (i & 63))).slice(1).charCodeAt(3);\n  return sum;\n}')
    if place == 'in-the-turn':
        body = deed.replace('TEXT', 's')
        call = '(() => { ' + body + ' })()' if False else None
        statements = body.split('; ')
        inTurn = '      ' + body.replace('return ', 'h = (h + (').replace(';', ')) | 0;') if body.count(';') == 1 else None
        if inTurn is None:
            first, last = body.split('; ', 1)
            inTurn = '      ' + first + ';\n      ' + last.replace('return ', 'h = (h + (').replace(';', ')) | 0;')
        lines.append('function digest(s: string) {\n  let h = 0;\n  for (let i = 0; i < s.length; i++) {\n    h = (h * 31 + s.charCodeAt(i)) | 0;\n    if ((i & 255) === 7) {\n' + inTurn + '\n      h = (h + churn()) | 0;\n    }\n  }\n  return h;\n}')
    elif place == 'in-a-copied-function':
        lines.append('function deed(text: string): number {\n  ' + deed.replace('TEXT', 'text') + '\n}')
        lines.append('function digest(s: string) {\n  let h = 0;\n  for (let i = 0; i < s.length; i++) {\n    h = (h * 31 + s.charCodeAt(i)) | 0;\n    if ((i & 255) === 7) h = (h + deed(s) + churn()) | 0;\n  }\n  return h;\n}')
    else:
        lines.append('(globalThis as any).hidden = function (): number {\n  const text = held.text;\n  held.text = "";\n  if (!text) return 0;\n  ' + deed.replace('TEXT', 'text') + '\n};')
        lines.append('function digest(s: string) {\n  let h = 0;\n  for (let i = 0; i < s.length; i++) {\n    h = (h * 31 + s.charCodeAt(i)) | 0;\n    if ((i & 255) === 7) h = (h + (globalThis as any).hidden() + churn()) | 0;\n  }\n  return h;\n}')
    run = ['function run(n: number) {', '  seen[equalKey(n)] = 7;']
    if place == 'out-of-sight':
        run.append('  held.text = made(n);')
        if holder == 'held-by-a-variable-too': run.append('  kept = held.text;')
        run.append('  return digest(held.text);')
    elif holder == 'held-by-a-variable-too':
        run += ['  kept = made(n);', '  return digest(kept);']
    else:
        run.append('  return digest(made(n));')
    run.append('}')
    lines.append('\n'.join(run))
    lines.append('console.log(run(100), run(101), run(150), kept.length);')
    open(os.path.join(folder, '-'.join([textName, deedName, place, holder]) + '.ts'), 'w').write('\n'.join(lines) + '\n')
    count += 1
print(count)
