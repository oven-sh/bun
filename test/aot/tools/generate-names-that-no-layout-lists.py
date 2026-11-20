#!/usr/bin/env python3
"""generate-names-that-no-layout-lists.py <folder> [field]: all 706; ../parallel/names-that-no-layout-lists/ holds 8 of them; with `field`: all 706; ../parallel/fields-that-every-maker-gives/ holds 706 of them: A NAME THAT NO LAYOUT LISTS, READ OFF AN OBJECT THAT IS OUT OF SIGHT. One-shape programs in JavaScript without types, each held against `bun <file>`.
An object is made (a literal, a class, a class below a class, a constructor function), handed to unseen code, read under a name that nobody in sight ever stores; UNSEEN CODE does a deed to it; it is read again.
The deed stands in a text that is evaluated: what code in sight does to such objects keeps the form from being built (the reading of what is expected), and the family would be vacuous."""
import os, sys
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
makers = {
 'literal': ('', 'function make(i) { return { issues: i }; }'),
 'literal-of-two': ('', 'function make(i) { return { issues: i, more: "m" }; }'),
 'class': ('class Node { constructor(i) { this.issues = i; } size() { return 1; } }', 'function make(i) { return new Node(i); }'),
 'class-below': ('class Node { constructor(i) { this.issues = i; } size() { return 1; } }\nclass Below extends Node { deep() { return 2; } }', 'function make(i) { return new Below(i); }'),
 'function': ('function Old(i) { this.issues = i; }\nOld.prototype.size = function () { return 1; };', 'function make(i) { return new Old(i); }'),
}
# (text of the deed, which makers it is for: None = all). Object.prototype takes no name in a compiled executable, so nothing is laid above a literal's object.
made_by_class = ('class', 'class-below', 'function')
deeds = {
 'none': ('', None),
 'stores-the-name': ('o.aborted = 7;', None),
 'stores-true': ('o.aborted = true;', None),
 'stores-undefined': ('o.aborted = undefined;', None),
 'stores-another-name': ('o.other = 1;', None),
 'lays-a-getter': ('Object.defineProperty(o, "aborted", { get() { return 7; }, configurable: true });', None),
 'lays-a-hidden-value': ('Object.defineProperty(o, "aborted", { value: 7, enumerable: false });', None),
 'relinks-to-an-object-with-the-name': ('Object.setPrototypeOf(o, { aborted: 7 });', None),
 'relinks-to-an-object-with-a-getter': ('Object.setPrototypeOf(o, { get aborted() { return 7; } });', None),
 'relinks-to-null': ('Object.setPrototypeOf(o, null);', None),
 'relinks-to-an-object-without-the-name': ('Object.setPrototypeOf(o, {});', None),
 'freezes': ('Object.freeze(o);', None),
 'stores-and-deletes': ('o.aborted = 7; delete o.aborted;', None),
 'stores-an-element': ('o[0] = 7;', None),
 'stores-a-symbol': ('o[Symbol.for("aborted")] = 7;', None),
 'deletes-a-field': ('delete o.issues;', None),
 'makes-it-read-only': ('Object.defineProperty(o, "aborted", { value: 8, writable: false, enumerable: true, configurable: true });', None),
 'deletes-it-and-relinks-to-an-object-with-the-name': ('delete o.aborted; Object.setPrototypeOf(o, { aborted: 70 });', None),
 'deletes-it-and-the-class-gains-the-name': ('delete o.aborted; Object.getPrototypeOf(o).aborted = 71;', made_by_class),
 'the-class-gains-the-name': ('Object.getPrototypeOf(o).aborted = 7;', made_by_class),
 'the-class-gains-a-getter': ('Object.defineProperty(Object.getPrototypeOf(o), "aborted", { get() { return 7; }, configurable: true });', made_by_class),
 'the-class-is-relinked': ('Object.setPrototypeOf(Object.getPrototypeOf(o), { aborted: 7 });', made_by_class),
 'the-class-above-gains-the-name': ('Object.getPrototypeOf(Object.getPrototypeOf(o)).aborted = 7;', ('class-below',)),
 'the-class-gains-and-loses-the-name': ('Object.getPrototypeOf(o).aborted = 7; delete Object.getPrototypeOf(o).aborted;', made_by_class),
}
# Who reads. What is read is held in a variable of code in sight, so that something is expected of it; unseen code has it as well.
readers = {
 'in-a-loop': 'function read(o) { let found = 0, last; for (let k = 0; k < 3; k++) { last = o.aborted; if (last === true || last === 7) found++; } return found + ":" + String(last); }',
 'in-what-a-loop-calls': 'function probe(o, start = 0) { if (o.aborted === true) return "true"; let seen = ""; for (let i = start; i < 1; i++) seen += o.issues; return String(o.aborted) + seen; }\nfunction read(o) { let said = ""; for (let k = 0; k < 2; k++) said += probe(o) + ";"; return said; }',
 'twice-round-the-deed': 'function read(o, deed) { let said = ""; for (let k = 0; k < 2; k++) { const before = o.aborted; if (deed) deed(o); const behind = o.aborted; said += String(before) + "," + String(behind) + ";"; } return said; }',
 'beside-a-field': 'function read(o) { let said = ""; for (let k = 0; k < 2; k++) said += String(o.issues) + String(o.aborted) + String(o.signal === undefined) + ";"; return said; }',
 'outside-of-loops': 'function read(o) { return String(o.aborted) + "!"; }',
 'optional-call': 'function read(o) { let said = ""; for (let k = 0; k < 2; k++) said += String(o.aborted?.toString()) + ";"; return said; }',
}
strangers = {
 'a-proxy': 'new Proxy({}, { get(t, k) { return k === "aborted" ? 7 : 1; } })',
 'a-parsed-object': 'JSON.parse(\'{"issues":1,"aborted":7}\')',
 'an-object-of-unseen-code': '({ aborted: 7, issues: 1 })',
 'a-function': 'Object.assign(function () {}, { aborted: 7, issues: 1 })',
 'a-list': 'Object.assign([1], { aborted: 7, issues: 1 })',
 'a-text': '"text"',
 'a-number': '5',
}
# names-make.py <folder> field: THE SAME SHAPES UNDER A NAME THAT EVERY MAKER IN SIGHT GIVES (`issues`): nothing is written of any field in a program without types, and the slot is looked at because the makers fill it.
is_field = len(sys.argv) > 2 and sys.argv[2] == 'field'
n = 0
def write(name, above, maker, reader, deed, stranger=None):
    global n
    if is_field:
        name, reader, deed, stranger = name.replace('name.', 'field.', 1), reader.replace('aborted', 'issues'), deed.replace('aborted', 'issues'), stranger and stranger.replace('"aborted":7', '"other":7').replace('aborted: 7, ', '').replace('k === "aborted"', 'k === "issues"')
    text = ('const again = Number(process.argv.length > 99);\n'
            'const open = (0, eval)(`({ kept: [], keep(o) { this.kept.push(o); return o; }, deed(o) { ' + deed.replace('`', '') + ' }, stranger() { return ' + (stranger or 'null') + '; } })`);\n'
            + (above + '\n' if above else '') + maker + '\n' + reader + '\n'
            'function attempt(o, deed) { try { return read(o, deed); } catch (e) { return "throws " + e.constructor.name; } }\n'
            'function run() {\n  const said = [];\n  const first = make(1), second = make(2), third = make(3);\n  open.keep(first); open.keep(second); open.keep(third);\n'
            '  for (let i = 0; i < 4; i++) said.push(attempt(first), attempt(second));\n'
            '  said.push(attempt(first, o => open.deed(o)));\n  open.deed(second);\n'
            '  for (let i = 0; i < 3; i++) said.push(attempt(first), attempt(second), attempt(third));\n'
            + ('  said.push(attempt(open.stranger()), attempt(first), attempt(open.stranger()));\n' if stranger else '') +
            '  return said.join(" | ");\n}\nconsole.log(run());\n')
    open(os.path.join(out, name + '.js'), 'w').write(text); n += 1
for m, (above, maker) in makers.items():
    for d, (deed, only) in deeds.items():
        if only and m not in only:
            continue
        for r, reader in readers.items():
            write('name.%s.%s.%s' % (m, d, r), above, maker, reader, deed)
    for s, stranger in strangers.items():
        for r in ('in-a-loop', 'in-what-a-loop-calls'):
            write('name.%s.stranger-%s.%s' % (m, s, r), above, maker, readers[r], '', stranger)
print(n, 'programs')
