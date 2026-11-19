#!/usr/bin/env python3
"""generate-constructors-read-through-families.py <folder>: writes the programs of parallel/constructors-read-through-families. The same bytes every time.
`o.constructor` where `o` is one of several layouts below constructor functions. `Sub.prototype = Object.create(Base.prototype)` leaves the new object without the name, so the lookup goes on: it finds Base.
What is done through the value that was read (a name laid on it, a method laid on its prototype object, a construction) is then asked of the functions of the row, each by itself.
One shape a program, each printing primitives, a loop at the head of every function so that none is copied.
Each program twice: <name>: the build stays closed wherever the shape lets it . <name>-with-eval: one eval puts the whole build into the open regime."""
import os, sys
out = sys.argv[1]
os.makedirs(out, exist_ok=True)

WORK = 'let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;'

ROW = '''function Base(v) { %(w)s this.v = v; }
function Sub(v) { %(w)s this.v = v; this.s = work; }
function Sub2(v) { %(w)s this.v = v; this.t = work; }
''' % { 'w': WORK }
LINKS = '''Sub.prototype = Object.create(Base.prototype);
Sub2.prototype = Object.create(Sub.prototype);
'''
MAKER = 'function maker(o) { %s return o.constructor; }\n' % WORK
# Each function of the row is asked by a reader of its own: at one reader for all of them several functions would meet, and nothing would be proven of what it finds.
def readers(names, what='mark'):
    return ''.join('function %sOf%s() { %s return %s.%s; }\n' % (what, name, WORK, name, what) for name in names)
def ask(names, what='mark', how='typeof '):
    return 'let told = "";\nfor (let i = 0; i < 300; i++) told = [%s].join(" ");\nconsole.log(told);\n' % ', '.join('%s%sOf%s()' % (how, what, name) for name in names)
THREE = ['Base', 'Sub', 'Sub2']
MARKS = 'function markIt(C) { %s C.mark = "text"; }\n' % WORK + readers(THREE)
EITHER = 'i & 1 ? new Sub(i) : new Sub2(i)'
ASK = ask(THREE)

def program(name, text, extension='mjs'):
    for isOpen in (False, True):
        head = 'const zero = (0, eval)("0");\n' if isOpen else 'const zero = 0;\n'
        with open(os.path.join(out, name + ('-with-eval' if isOpen else '') + '.' + extension), 'w') as f:
            f.write(head + text)

def marked(name, row=ROW, links=LINKS, maker=MAKER, marks=MARKS, deed='for (let i = 0; i < 300; i++) markIt(maker(%s));\n' % EITHER, ask=ASK, front='', extension='mjs'):
    program(name, row + links + maker + marks + front + deed + ask, extension)

# A name laid through the value.
marked('name-laid-through-two-layouts-of-one-row')
marked('name-laid-through-one-layout', deed='for (let i = 0; i < 300; i++) markIt(maker(new Sub2(i)));\n')
marked('name-laid-through-a-layout-and-a-literal', deed='let other = "";\nfor (let i = 0; i < 300; i++) other = typeof maker({ tag: i });\nfor (let i = 0; i < 300; i++) markIt(maker(new Sub(i)));\nconsole.log(other);\n')
marked('name-laid-through-a-computed-key', maker='function maker(o, k) { %s return o[k]; }\nconst name = ["constructor", "v"][JSON.parse("0")];\n' % WORK, deed='for (let i = 0; i < 300; i++) markIt(maker(%s, name));\n' % EITHER)
marked('name-laid-through-a-key-that-nobody-reads', maker='function maker(o, k) { %s return o[k]; }\nconst name = JSON.parse(\'"constructor"\');\n' % WORK, deed='for (let i = 0; i < 300; i++) markIt(maker(%s, name));\n' % EITHER)
marked('name-asked-in-front-of-the-deed-and-behind-it', front='console.log(typeof markOfBase(), typeof markOfSub(), typeof markOfSub2());\n')
marked('name-laid-once', deed='for (let i = 0; i < 300; i++) { const C = maker(%s); if (i === 299) markIt(C); }\n' % EITHER)
marked('row-of-four',
       row=ROW + 'function Sub3(v) { %s this.v = v; this.u = work; }\n' % WORK, links=LINKS + 'Sub3.prototype = Object.create(Sub2.prototype);\n',
       marks=MARKS + readers(['Sub3']), deed='for (let i = 0; i < 300; i++) markIt(maker(i & 1 ? new Sub3(i) : new Sub2(i)));\n', ask=ask(THREE + ['Sub3']))
marked('two-rows-below-one-function', links='Sub.prototype = Object.create(Base.prototype);\nSub2.prototype = Object.create(Base.prototype);\n')

# Who has the name.
marked('each-function-gets-its-name-back', links=LINKS + 'Sub.prototype.constructor = Sub;\nSub2.prototype.constructor = Sub2;\n')
marked('the-middle-function-gets-its-name-back', links=LINKS + 'Sub.prototype.constructor = Sub;\n')
marked('linked-by-set-prototype-of', links='Object.setPrototypeOf(Sub.prototype, Base.prototype);\nObject.setPrototypeOf(Sub2.prototype, Sub.prototype);\n')
marked('the-top-loses-the-name', links=LINKS + 'delete Base.prototype.constructor;\n', ask=ASK + 'console.log(typeof Object.mark);\n')
marked('the-top-gets-another-function-under-the-name', row=ROW + 'function Other() { %s this.o = work; }\n' % WORK, links=LINKS + 'Base.prototype.constructor = Other;\n', marks=MARKS + readers(['Other']), ask=ask(THREE + ['Other']))
marked('a-class-below-the-row', row=ROW, links='Sub.prototype = Object.create(Base.prototype);\nclass Leaf extends Sub { constructor(v) { super(v); this.l = v; } }\n',
       marks='function markIt(C) { %s C.mark = "text"; }\n' % WORK + readers(['Base', 'Sub', 'Leaf']), deed='for (let i = 0; i < 300; i++) markIt(maker(i & 1 ? new Sub(i) : new Leaf(i)));\n', ask=ask(['Base', 'Sub', 'Leaf']))
marked('the-links-are-laid-behind-the-first-objects', links='', front='const early = [new Sub(1), new Sub2(2)];\nfor (let i = 0; i < 300; i++) markIt(maker(early[i & 1]));\nconsole.log(typeof markOfBase(), typeof markOfSub(), typeof markOfSub2());\n' + LINKS)

# What else is done through the value.
marked('count-kept-through-the-value', marks='function markIt(C) { %s C.count = (C.count | 0) + 1; }\n' % WORK + readers(THREE, 'count'), ask=ask(THREE, 'count', ''))
marked('method-laid-on-the-prototype-object',
       marks='function hello() { %(w)s return work; }\nfunction markIt(C) { %(w)s C.prototype.hello = hello; }\n' % { 'w': WORK } + ''.join('function helloOf%s(i) { %s return new %s(i).hello; }\n' % (name, WORK, name) for name in THREE),
       ask='let told = "";\nfor (let i = 0; i < 300; i++) told = typeof helloOfBase(i) + " " + typeof helloOfSub(i) + " " + typeof helloOfSub2(i);\nconsole.log(told);\n')
marked('object-made-by-the-value',
       marks='function markIt(C) { %(w)s return new C(7); }\nfunction markOf(o) { %(w)s return (o.s === undefined ? "no s" : "s") + " " + (o.t === undefined ? "no t" : "t") + " " + o.v; }\n' % { 'w': WORK },
       deed='let made = null;\nfor (let i = 0; i < 300; i++) made = markIt(maker(%s));\n' % EITHER, ask='console.log(markOf(made), made instanceof Sub, made instanceof Base);\n')
marked('value-held-against-each-function',
       marks='function markIt(C) { %s return (C === Base ? 1 : 0) + (C === Sub ? 10 : 0) + (C === Sub2 ? 100 : 0); }\n' % WORK,
       deed='let sum = 0;\nfor (let i = 0; i < 300; i++) sum = sum + markIt(maker(%s));\n' % EITHER, ask='console.log(sum);\n')
marked('name-of-the-value', marks='function markIt(C) { %s return C.name; }\n' % WORK, deed='let told = "";\nfor (let i = 0; i < 300; i++) told = markIt(maker(%s));\n' % EITHER, ask='console.log(told);\n')
marked('name-laid-by-unseen-code', marks='const markIt = [(C) => { C.mark = "text"; }][JSON.parse("0")];\n' + readers(THREE))

# Typed.
program('typed-name-laid-through-two-layouts-of-one-row', '''function Base(this: any, v: number) { %(w)s this.v = v; }
function Sub(this: any, v: number) { %(w)s this.v = v; this.s = work; }
function Sub2(this: any, v: number) { %(w)s this.v = v; this.t = work; }
Sub.prototype = Object.create(Base.prototype);
Sub2.prototype = Object.create(Sub.prototype);
function maker(o: any): any { %(w)s return o.constructor; }
function markIt(C: any): void { %(w)s C.mark = "text"; }
function markOfBase(): unknown { %(w)s return (Base as any).mark; }
function markOfSub(): unknown { %(w)s return (Sub as any).mark; }
function markOfSub2(): unknown { %(w)s return (Sub2 as any).mark; }
for (let i = 0; i < 300; i++) markIt(maker(i & 1 ? new (Sub as any)(i) : new (Sub2 as any)(i)));
let told = "";
for (let i = 0; i < 300; i++) told = [typeof markOfBase(), typeof markOfSub(), typeof markOfSub2()].join(" ");
console.log(told);
''' % { 'w': WORK }, 'ts')
