#!/usr/bin/env python3
"""generate-names-read-through-stars-over-stars.py <folder>: writes the programs of parallel/names-read-through-stars-over-stars. The same bytes every time.
A leaf, a middle barrel with a star over the leaf, a top barrel with a star over the middle (TypeScript's helper text in one file). While the stars wait a read off the top goes to the object that has the name as its own.
Each program does ONE deed to the leaf or to the middle behind the stars and reads the name off the top: cold and five times while the stars wait, 300 times at one site, which carries them out, and once more. A deed is one entry of `deeds`; each is written for both helpers:
the one that takes over the accessor of a marked source (TypeScript from 4.6 on) and the one that always makes a getter (up to 4.5)."""
import os, sys
out = sys.argv[1]

newer = '''var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
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
older = newer.replace('''    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
''', '''    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
''')
assert older != newer

head = '''const leaf = { __esModule: true, first: 1, second: 2 };
const middle = { __esModule: true, ownOfMiddle: "middle" };
const top = { __esModule: true, ownOfTop: "top" };
__exportStar(leaf, middle);
__exportStar(middle, top);
function read(barrel) {
  return barrel.first;
}
function readOften(turns) {
  let found = 0;
  for (let turn = 0; turn < turns; turn++) found += read(top) === undefined ? 0 : 1;
  return found;
}
'''
# The stars wait for the first reads, are carried out in the long loop, and the listing comes last.
tail = '''console.log(String(read(top)), readOften(5), String(read(middle)), String(top.second), "first" in top);
console.log(readOften(300), String(read(top)), String(read(middle)), Object.keys(top).join(), Object.keys(middle).join());
'''
deeds = {
    'nothing-is-done': ('Nothing is done.', ''),
    'the-leaf-stores-the-name': ('The leaf stores another value under the name.', 'leaf.first = "stored later";\n'),
    'the-leaf-loses-the-name': ('The leaf loses the name.', 'delete leaf.first;\n'),
    'the-leaf-loses-the-name-and-its-prototype-has-it': ('The leaf loses the name and gets a prototype that has it.', 'delete leaf.first;\nObject.setPrototypeOf(leaf, { first: "of the prototype" });\n'),
    'the-leaf-gets-a-getter-for-the-name': ('The leaf gets a getter for the name, which counts its calls and looks at its receiver.', 'let calls = 0;\nObject.defineProperty(leaf, "first", { get() { calls++; return this === leaf ? "by the getter" : "another receiver"; }, enumerable: true, configurable: true });\n', 'console.log(calls);\n'),
    'the-leaf-loses-the-name-and-has-it-from-a-star': ('The leaf loses the name and gets it back by a star over another object.', 'delete leaf.first;\n__exportStar({ first: "of another object" }, leaf);\n'),
    'the-leaf-is-frozen': ('The leaf is frozen.', 'Object.freeze(leaf);\n'),
    'the-middle-is-listed': ('The middle is listed, which carries its star out; that of the top goes on waiting.', 'console.log(Object.keys(middle).join());\n'),
    'the-middle-is-frozen': ('The middle is frozen.', 'Object.freeze(middle);\n'),
    'the-middle-is-stored-to-under-the-name': ('A store to the middle under the name finds an accessor without a setter.', 'console.log(Reflect.set(middle, "first", "refused"));\n'),
    'the-top-is-stored-to-under-the-name': ('A store to the top under the name finds an accessor without a setter.', 'console.log(Reflect.set(top, "first", "refused"));\n'),
    'the-middle-is-asked-to-define-the-name': ('A definition of the name on the middle is refused: what a star binds cannot be configured.', 'try {\n  Object.defineProperty(middle, "first", { value: "defined" });\n} catch (error) {\n  console.log(error.constructor.name);\n}\n'),
    'the-middle-is-asked-to-delete-the-name': ('The middle does not let go of the name.', 'console.log(Reflect.deleteProperty(middle, "first"), Reflect.deleteProperty(top, "first"));\n'),
    'the-middle-gets-another-prototype': ('The middle gets a prototype that has the name too: its own goes first.', 'Object.setPrototypeOf(middle, { first: "of the prototype", third: 3 });\nconsole.log(middle.third, top.third);\n'),
    'the-name-is-read-for-another-receiver': ('The name is read off the top for another receiver.', 'console.log(Reflect.get(top, "first", { first: "of the receiver" }), Object.create(top).first);\n'),
}
os.makedirs(out, exist_ok=True)
for name, deed in deeds.items():
    what, text, last = deed if len(deed) == 3 else (*deed, '')
    for helper, helpers in (('accessors-are-taken-over', newer), ('each-star-makes-getters', older)):
        open(os.path.join(out, f'{name}-{helper}.cjs'), 'w').write(f'// {what}\n// COUNT: counter:StarsRecorded >= 2\n' + helpers + head + text + tail + last)
print(2 * len(deeds), 'files')
