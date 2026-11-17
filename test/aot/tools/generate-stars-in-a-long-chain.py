#!/usr/bin/env python3
"""generate-stars-in-a-long-chain.py <folder>: writes the programs of parallel/stars-in-a-long-chain. The same bytes every time.
100,000 barrels, each with a star over the one below (TypeScript's helper text in one file): longer than any stack. A deed is one entry of `cases`."""
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

chain = '''function makeBarrel(level) {
  return { __esModule: true, level: level };
}
let top = { first: 1, second: 2 };
for (let level = 1; level <= 100000; level++) {
  const barrel = makeBarrel(level);
  __exportStar(top, barrel);
  top = barrel;
}
'''
lattice = '''function makeBarrel(level) {
  return { __esModule: true, level: level };
}
let left = { first: 1 };
let right = { second: 2 };
for (let level = 1; level <= 50000; level++) {
  const a = makeBarrel(level), b = makeBarrel(level);
  __exportStar(left, a); __exportStar(right, a);
  __exportStar(left, b); __exportStar(right, b);
  left = a; right = b;
}
'''
cases = {
    'names-are-read.cjs': ('Each name is read once off the top, and one that nobody has.', ('StarsRecorded = 100000', 'StarsCarriedOutLate = 0'), helpers,
        chain + 'console.log(top.first, top.second, top.missing === undefined, top.level);\n'),
    'names-are-asked-for.cjs': ('The top is asked for names and nothing is read.', ('StarsRecorded = 100000', 'StarsCarriedOutLate = 0'), helpers,
        chain + 'console.log("first" in top, "missing" in top, Object.prototype.hasOwnProperty.call(top, "second"), "default" in top);\n'),
    'the-top-is-listed.cjs': ('The top is listed, which carries its star out: the getters come up from the bottom.', ('StarsRecorded = 100000',), helpers,
        chain + 'console.log(Object.keys(top).join(), JSON.stringify(top), typeof Object.getOwnPropertyDescriptor(top, "first").get);\n'),
    'the-top-gets-a-field.cjs': ('The top gets a name behind its star. Each star has asked whether it binds the name, which its target still lacked.', ('StarsRecorded = 100000',), helpers,
        chain + 'top.late = "late";\nconsole.log(top.late, top.first, Object.keys(top).join());\n'),
    'each-level-has-getters-of-its-own.cjs': ('By the helper as TypeScript emitted it up to 4.5 a getter calls the getter below it. Where the stack runs out that is an error like any other; where the getters are not made it does not run out.', ('StarsRecorded = 100000',), older_helpers,
        chain + 'let answer;\ntry {\n  answer = top.first;\n} catch (error) {\n  answer = error.constructor.name;\n}\nconsole.log(answer === 1 || answer === "RangeError", "second" in top, "missing" in top);\n'),
    'each-level-has-getters-of-its-own-and-they-are-made.cjs': ('The same, and the top is listed first, which makes the getters of every level.', ('StarsRecorded = 100000',), older_helpers,
        chain + 'let answer;\ntry {\n  answer = Object.keys(top).join() + " " + top.first;\n} catch (error) {\n  answer = error.constructor.name;\n}\nconsole.log(answer === "__esModule,level,first,second 1" || answer === "RangeError");\n'),
    'two-barrels-a-level.cjs': ('50,000 levels of two barrels, each with a star over both below.', ('StarsRecorded = 200000', 'StarsCarriedOutLate = 0'), helpers,
        lattice + 'console.log(left.first, left.second, right.first, left.missing === undefined, "second" in right);\n'),
}
os.makedirs(out, exist_ok=True)
for name, (head, counts, text, body) in cases.items():
    open(os.path.join(out, name), 'w').write(f'// {head}\n' + ''.join(f'// COUNT: counter:{c}\n' for c in counts) + text + body)
print(len(cases), 'files')
