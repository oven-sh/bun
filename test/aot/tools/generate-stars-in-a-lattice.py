#!/usr/bin/env python3
"""generate-stars-in-a-lattice.py <folder>: writes the programs of parallel/stars-in-a-lattice. The same bytes every time.
A lattice: two barrels a level, each with a star over both barrels of the level below. The roads from the top to a leaf double with each level; the stars do not.
A deed is one entry of `cases` (one file: TypeScript's helper text, then the deed) or one folder of files written by `files()`."""
import os, sys
out = sys.argv[1]

helpers = '''var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
'''

older_helpers = helpers.replace('''    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
''', '''    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
''')
assert older_helpers != helpers

def lattice(levels, barrel='{ __esModule: true, level: level }', between='', hide=''):
    h = (lambda x: f'{hide}({x})') if hide else (lambda x: x)
    return f'''function makeBarrel(level) {{
  return {barrel};
}}
let left = {{ first: 1 }};
let right = {{ second: 2 }};
for (let level = 1; level <= {levels}; level++) {{
  const a = makeBarrel(level), b = makeBarrel(level);
  __exportStar({h('left')}, {h('a')}); __exportStar({h('right')}, {h('a')});
{between}  __exportStar({h('left')}, {h('b')}); __exportStar({h('right')}, {h('b')});
  left = a; right = b;
}}
'''

cases = {}
def case(name, head, body, counts=()):
    cases[name] = f'// {head}\n' + ''.join(f'// COUNT: counter:{c}\n' for c in counts) + helpers + body

for levels in (40, 200):
    case(f'{levels}-levels-and-one-read-of-each-name.cjs', f'{levels} levels, and each name is read once off the top: one of the left leaf, one of the right leaf, one that nobody has.',
         lattice(levels) + 'console.log(left.first, left.second, right.first, left.missing === undefined);\n', (f'StarsRecorded = {4 * levels}', 'StarsCarriedOutLate = 0'))

case('40-levels-and-a-name-that-nobody-has.cjs', '40 levels, and the one name that is read is bound by no star: the search has nowhere to stop early.',
     lattice(40) + 'console.log(left.missing === undefined, right.missing === undefined);\n', ('StarsRecorded = 160', 'StarsCarriedOutLate = 0'))

for turns, what, counts in ((300, 'the stars go on waiting', ('StarsRecorded = 160', 'StarsCarriedOutLate = 0')), (3000, 'stars that are searched so often are carried out', ('StarsRecorded = 160', 'StarsCarriedOutLate = 4'))):
    case(f'40-levels-read-{turns}-times.cjs', f'40 levels, and one site reads the names {turns} times: {what}.',
         lattice(40) + f'''function read(barrel) {{
  return barrel.first + barrel.second * 10 + (barrel.missing === undefined ? 100 : 0);
}}
let sum = 0;
for (let turn = 0; turn < {turns}; turn++) sum += read(turn & 1 ? left : right);
console.log(sum);
''', counts)

case('40-levels-and-the-keys-of-the-top.cjs', '40 levels, and the top is listed in every way before anything is read off it.',
     lattice(40) + '''let listed = "";
for (const name in left) listed += name + " ";
console.log(Object.keys(left).join(), listed, JSON.stringify(left), Object.getOwnPropertyNames(right).join());
console.log(Object.entries(right).join(";"), Object.values(left).join());
''', ('StarsRecorded = 160',))

case('40-levels-asked-whether-they-have-a-name.cjs', '40 levels, and the top is asked for names without reading any.',
     lattice(40) + '''console.log("first" in left, "second" in left, "missing" in left, "default" in left, "level" in left);
console.log(Object.prototype.hasOwnProperty.call(right, "first"), Object.prototype.hasOwnProperty.call(right, "missing"), Reflect.has(right, "second"), Object.hasOwn(right, "toString"));
''', ('StarsRecorded = 160', 'StarsCarriedOutLate = 0'))

case('40-levels-and-the-descriptors-of-the-top.cjs', '40 levels of marked barrels hand one getter up from the bottom: the descriptor of the top holds the getter of the first level.',
     lattice(40, between='  if (level === 1) lowest = a;\n').replace('let left =', 'let lowest;\nlet left =') + '''const top = Object.getOwnPropertyDescriptor(left, "first"), bottom = Object.getOwnPropertyDescriptor(lowest, "first");
console.log(typeof top.get, top.set, top.enumerable, top.configurable, top.get === bottom.get, top.get(), Object.getOwnPropertyDescriptor(left, "missing"));
''', ('StarsRecorded = 160',))

case('40-levels-without-the-mark.cjs', '40 levels of barrels that are not marked as ES modules: each level makes getters of its own, which read the level below. A star over such a barrel does not wait.',
     lattice(40, barrel='{ level: level }') + 'console.log(left.first, left.second, right.first, left.missing === undefined, left.level, Object.keys(right).join());\n', ('StarsRecorded = 4',))

case('40-levels-by-the-helper-that-always-makes-a-getter.cjs', '40 levels by the helper as TypeScript emitted it up to 4.5: each level has getters of its own, which read the level below.',
     lattice(40) + 'console.log(left.first, left.second, right.first, left.missing === undefined, left.level, "second" in right);\n', ('StarsRecorded = 160', 'StarsCarriedOutLate = 0'))
cases['40-levels-by-the-helper-that-always-makes-a-getter.cjs'] = cases['40-levels-by-the-helper-that-always-makes-a-getter.cjs'].replace(helpers, older_helpers)

case('40-levels-of-three-barrels.cjs', '40 levels of three barrels, each with a star over all three below.',
     '''function makeBarrel(level) {
  return { __esModule: true, level: level };
}
let below = [{ first: 1 }, { second: 2 }, { third: 3 }];
for (let level = 1; level <= 40; level++) {
  const here = [makeBarrel(level), makeBarrel(level), makeBarrel(level)];
  for (let target = 0; target < 3; target++) {
    for (let source = 0; source < 3; source++) __exportStar(below[source], here[target]);
  }
  below = here;
}
console.log(below[0].first, below[1].second, below[2].third, below[0].missing === undefined, Object.keys(below[2]).join());
''', ('StarsRecorded = 360',))

case('40-levels-and-a-field-that-only-the-top-gets.cjs', '40 levels of one kind of barrel, and the top alone gets a name behind its stars. Each star asks whether it binds the name that its target still lacks, and none does.',
     lattice(40) + '''left.late = "late";
console.log(left.late, right.late === undefined, left.first, Object.keys(left).join(), Object.keys(right).join());
''', ('StarsRecorded = 160',))

case('40-levels-and-a-field-that-the-barrels-in-the-middle-get.cjs', '40 levels of one kind of barrel, and the two of level 20 get a name behind their stars, as `export { own } from` stands behind `export *`. Below them no star binds it, above them every first star does.',
     lattice(40).replace('  left = a; right = b;', '  if (level === 20) { a.own = "of the left barrel"; b.own = "of the right barrel"; }\n  left = a; right = b;') + 'console.log(left.own, right.own, left.first, right.second, left.missing === undefined, Object.keys(left).join());\n', ('StarsRecorded = 160',))

case('40-levels-and-one-name-from-both-leaves.cjs', '40 levels, and both leaves have the name: the first star wins at every level. `default` is bound by none, and what a barrel has itself stays.',
     lattice(40).replace('{ first: 1 }', '{ first: 1, shared: "of the left leaf", default: "left", level: "of the left leaf" }').replace('{ second: 2 }', '{ shared: "of the right leaf", second: 2, default: "right" }')
     + 'console.log(left.shared, right.shared, left.default === undefined, "default" in right, left.level, Object.keys(left).join());\n', ('StarsRecorded = 160',))

case('40-levels-with-the-stars-the-other-way-round.cjs', '40 levels, and the right barrel of each level takes its stars in the other order: who wins a name that both leaves have goes by the road.',
     lattice(40).replace('__exportStar(left, b); __exportStar(right, b);', '__exportStar(right, b); __exportStar(left, b);').replace('{ first: 1 }', '{ first: 1, shared: "of the left leaf" }').replace('{ second: 2 }', '{ shared: "of the right leaf", second: 2 }')
     + 'console.log(left.shared, right.shared, Object.keys(left).join(), Object.keys(right).join());\n', ('StarsRecorded = 160',))

case('40-levels-and-names-that-come-too-late.cjs', '40 levels. A leaf and a barrel in the middle get names when the stars over them have run: nobody above has them. A barrel below the top gets one between the two stars over it: the second has it. What a leaf holds under an old name is read as it is now.',
     lattice(40, between='  if (level === 40) left.between = "between";\n').replace('let left =', 'const leaf = { first: 1 };\nlet middle;\nlet left =').replace('let left = { first: 1 };', 'let left = leaf;').replace('  left = a; right = b;', '  left = a; right = b;\n  if (level === 10) middle = a;')
     + '''leaf.tooLate = 3;
middle.tooLate = 4;
leaf.first = 10;
console.log(left.tooLate === undefined, "tooLate" in right, left.first, right.first, middle.tooLate, middle.first);
console.log(left.between, right.between, Object.keys(left).join(), Object.keys(right).join());
''', ('StarsRecorded = 158',))

case('a-cycle-of-stars.cjs', 'Two barrels with stars over each other, 40 times round, and a third over both.',
     '''const one = { __esModule: true, first: 1 }, other = { __esModule: true, second: 2 }, top = { __esModule: true };
for (let turn = 0; turn < 40; turn++) {
  __exportStar(other, one); __exportStar(one, other);
  __exportStar(one, top); __exportStar(other, top);
}
__exportStar(top, top);
console.log(one.second, other.first, top.first, top.second, top.missing === undefined, Object.keys(one).join(), Object.keys(other).join(), Object.keys(top).join());
other.second = 20;
console.log(one.second, top.second);
''')

case('40-levels-of-barrels-that-unseen-code-hands-over.cjs', '40 levels, and the helper gets each barrel from a function that the compiler has not seen.',
     'const unseen = (0, eval)("(x) => x");\n' + lattice(40, hide='unseen') + 'console.log(left.first, left.second, right.first, left.missing === undefined, Object.keys(unseen(left)).join());\n')

case('40-levels-read-by-unseen-code.cjs', '40 levels, and a function that the compiler has not seen reads and lists the top.',
     lattice(40) + '''const read = (0, eval)("(barrel, name) => barrel[name]"), list = (0, eval)("(barrel) => { let names = ''; for (const name in barrel) names += name + ' '; return names; }");
console.log(read(left, "first"), read(left, "second"), read(right, "missing") === undefined, list(right));
''', ('StarsRecorded = 160',))

case('40-levels-copied.cjs', '40 levels, and the top is copied by a spread and by Object.assign: each name is read through its getter.',
     lattice(40) + '''const spread = { ...left }, assigned = Object.assign({}, right);
console.log(JSON.stringify(spread), JSON.stringify(assigned), typeof Object.getOwnPropertyDescriptor(spread, "first").get);
''', ('StarsRecorded = 160',))

case('one-level-still-waits.cjs', 'One barrel over two leaves, as most barrels are: its stars wait while names are read off it.',
     lattice(1) + 'console.log(left.first, left.second, right.first, left.missing === undefined, "second" in right);\n', ('StarsRecorded = 4', 'StarsCarriedOutLate = 0'))

case('a-chain-still-waits.cjs', '200 barrels, each with one star over the one below: no star is carried out for a read.',
     '''function makeBarrel(level) {
  return { __esModule: true, level: level };
}
let top = { first: 1, second: 2 };
for (let level = 1; level <= 200; level++) {
  const barrel = makeBarrel(level);
  __exportStar(top, barrel);
  top = barrel;
}
console.log(top.first, top.second, top.missing === undefined, top.level);
''', ('StarsRecorded = 200', 'StarsCarriedOutLate = 0'))

typed = '''// 200 levels of typed barrels.
// COUNT: counter:StarsRecorded = 800
// COUNT: counter:StarsCarriedOutLate = 0
''' + helpers + '''interface Barrel { __esModule?: boolean; level?: number; first?: number; second?: number; missing?: number }
function makeBarrel(level: number): Barrel {
  return { __esModule: true, level: level };
}
let left: Barrel = { first: 1 };
let right: Barrel = { second: 2 };
for (let level = 1; level <= 200; level++) {
  const a: Barrel = makeBarrel(level), b: Barrel = makeBarrel(level);
  __exportStar(left, a); __exportStar(right, a);
  __exportStar(left, b); __exportStar(right, b);
  left = a; right = b;
}
console.log(left.first, left.second, right.first, left.missing === undefined);
'''
cases['200-levels-of-typed-barrels.cts'] = typed

def write(path, text):
    path = os.path.join(out, path); os.makedirs(os.path.dirname(path), exist_ok=True); open(path, 'w').write(text)

for name, text in cases.items(): write(name, text)

# Files, as TypeScript emits `export * from "./x"; export * from "./y";` for CommonJS.
def commonjs_files(folder, levels, main, mainName):
    head = '"use strict";\n' + helpers + 'Object.defineProperty(exports, "__esModule", { value: true });\n'
    write(f'{folder}/left-0.cjs', '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.first = void 0;\nexports.first = 1;\n')
    write(f'{folder}/right-0.cjs', '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.second = void 0;\nexports.second = 2;\n')
    for level in range(1, levels + 1):
        for side in ('left', 'right'):
            write(f'{folder}/{side}-{level}.cjs', head + f'__exportStar(require("./left-{level - 1}.cjs"), exports);\n__exportStar(require("./right-{level - 1}.cjs"), exports);\n')
    write(f'{folder}/{mainName}', main)

commonjs_files('files-of-40-levels-required', 40, '''// 40 levels of files as TypeScript emits barrels for CommonJS, and the top is required.
// COUNT: counter:StarsRecorded = 160
// COUNT: counter:StarsCarriedOutLate = 0
"use strict";
const left = require("./left-40.cjs"), right = require("./right-40.cjs");
console.log(left.first, left.second, right.first, left.missing === undefined, left.__esModule);
''', 'main.cjs')

write('files-of-40-levels-imported-by-an-es-module/main.mjs', '''// The 40 levels of files of ../files-of-40-levels-required, and an ES module imports names and the whole of the top.
import { first, second } from "../files-of-40-levels-required/left-40.cjs";
import * as right from "../files-of-40-levels-required/right-40.cjs";
console.log(first, second, right.first, right.second, right.missing === undefined, "first" in right, "missing" in right);
''')

def es_files(folder, levels, leaves):
    if leaves == 'mjs':
        write(f'{folder}/left-0.mjs', 'export const first = 1;\n')
        write(f'{folder}/right-0.mjs', 'export const second = 2;\n')
    else:
        write(f'{folder}/left-0.cjs', 'exports.first = 1;\n')
        write(f'{folder}/right-0.cjs', 'exports.second = 2;\n')
    for level in range(1, levels + 1):
        kind = leaves if level == 1 else 'mjs'
        for side in ('left', 'right'):
            write(f'{folder}/{side}-{level}.mjs', f'export * from "./left-{level - 1}.{kind}";\nexport * from "./right-{level - 1}.{kind}";\n')
    write(f'{folder}/main.mjs', f'''// {levels} levels of ES modules, each `export *` from both below. The leaves are {"ES modules" if leaves == "mjs" else "CommonJS modules: what they export is known when they have run"}.
import {{ first, second }} from "./left-{levels}.mjs";
import * as right from "./right-{levels}.mjs";
console.log(first, second, right.first, right.missing === undefined, Object.keys(right).join());
''')
es_files('es-modules-of-40-levels', 40, 'mjs')
es_files('es-modules-of-40-levels-over-commonjs-leaves', 40, 'cjs')
print(len(cases), 'files and 4 folders')
