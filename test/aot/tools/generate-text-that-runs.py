# generate-text-that-runs.py <outdir>: for LinkTables::unseenCodeCanRun = false: code that the compiler has never seen runs by one road and does ONE DEED that needs no reference from the program;
# the program then looks at what the deed changed. road x deed. ONE SHAPE A FILE. Every program prints what plain Bun prints.
import sys, os
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
# RUN(TEXT): TEXT is a JavaScript string expression.
roads = {
 'direct-eval':              'eval(TEXT);',
 'indirect-eval':            '(0, eval)(TEXT);',
 'optional-eval':            'eval?.(TEXT);',
 'eval-by-another-name':     'const run = eval; run(TEXT);',
 'eval-off-the-global':      'globalThis["ev" + "al"](TEXT);',
 'eval-by-call':             'eval.call(null, TEXT);',
 'eval-by-reflect':          'Reflect.apply(eval, null, [TEXT]);',
 'eval-as-a-callback':       '[TEXT].forEach(eval);',
 'eval-in-a-microtask':      'await Promise.resolve(TEXT).then(eval);',
 'new-function':             'new Function(TEXT)();',
 'function-called':          'Function(TEXT)();',
 'function-by-the-constructor-of-a-function': '(function () {}).constructor(TEXT)();',
 'function-by-the-constructor-of-an-arrow':   '(() => {}).constructor(TEXT)();',
 'function-by-a-made-up-name': '(() => {})[["const", "ructor"].join("")](TEXT)();',
 'function-by-reflect-construct': 'Reflect.construct(Function, [TEXT])();',
 'function-off-the-global':  'globalThis["Func" + "tion"](TEXT)();',
 'async-function-constructor': 'await (async () => {}).constructor(TEXT)();',
 'generator-function-constructor': '(function* () {}).constructor(TEXT)().next();',
 'async-generator-function-constructor': 'await (async function* () {}).constructor(TEXT)().next();',
 'function-through-the-prototype': 'Object.getPrototypeOf(function () {}).constructor(TEXT)();',
 'subclass-of-function':     'new (class extends Function {})(TEXT)();',
 'bound-function-constructor': 'Function.bind(null, TEXT)()();',
 'vm-run-in-this-context':   'vm.runInThisContext(TEXT);',
 'vm-script':                'new vm.Script(TEXT).runInThisContext();',
 'vm-compile-function':      'vm.compileFunction(TEXT)();',
 'timer-with-a-function-of-text': 'await new Promise(resolve => setTimeout(new Function("resolve", TEXT + "; resolve()"), 0, resolve));',
 'import-of-a-data-url':     'await import("data:text/javascript," + encodeURIComponent(TEXT));',
 'import-of-a-written-file': 'fs.writeFileSync(file, TEXT); await import(file);',
 'require-of-a-written-file': 'fs.writeFileSync(file.replace(".mjs", ".cjs"), TEXT); createRequire(import.meta.url)(file.replace(".mjs", ".cjs"));',
 'module-compile':           'const m = new Module("x"); m._compile(TEXT, "x.js");',
 'to-string-of-an-argument': 'new Function({ toString() { return TEXT; } })();',
 'eval-of-a-joined-text':    'eval([TEXT, ""].join(";"));',
 'eval-inside-evaluated-text': 'eval("eval(" + JSON.stringify(TEXT) + ")");',
 'getter-made-of-text':      'Object.defineProperty({}, "g", { get: new Function(TEXT) }).g;',
 'json-reviver-made-of-text': 'JSON.parse("1", new Function(TEXT));',
 'sort-comparator-made-of-text': '[1, 2].sort(new Function(TEXT + "; return 0"));',
}
# name: (the text, what stands in front, what the program looks at behind it)
deeds = {
 'defines-a-global':      ('"globalThis.lateGlobal = 7"', '', 'typeof lateGlobal + " " + typeof globalThis.lateGlobal'),
 'declares-a-var':        ('"var lateVar = 7; globalThis.lateVarToo = typeof lateVar"', '', 'typeof globalThis.lateVarToo'),
 'replaces-a-global-of-the-program': ('"globalThis.shared = \'text\'"', 'globalThis.shared = 1;', 'typeof shared + " " + shared'),
 'stores-on-what-a-global-holds':    ('"globalThis.holder.x = \'text\'"', 'const record = { x: 1 }; globalThis.holder = record;', 'typeof record.x + " " + record.x'),
 'calls-a-function-of-the-program':  ('"globalThis.entry(\'text\')"', 'let got = 1; function entry(a) { got = a; } globalThis.entry = entry;', 'typeof got + " " + got'),
 'adds-to-a-class-through-an-instance': ('"globalThis.one.constructor.prototype.extra = () => \'text\'"', 'class P { x = 1; } const p = new P(); globalThis.one = p;', 'typeof p.extra + " " + (p.extra ? p.extra() : "none")'),
 'reads-and-keeps':       ('"globalThis.seenByText = typeof globalThis.process"', '', 'String(globalThis.seenByText)'),
}
count = 0
for road, way in roads.items():
    for deed, (text, before, look) in deeds.items():
        lines = ['// Text runs by %s and %s.' % (road.replace('-', ' '), deed.replace('-', ' '))]
        if 'vm.' in way: lines.append('import vm from "node:vm";')
        if 'fs.' in way: lines += ['import fs from "node:fs";', 'import os from "node:os";', 'import path from "node:path";', 'const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "text-")), "late.mjs");']
        if 'createRequire' in way: lines.append('import { createRequire } from "node:module";')
        if 'new Module' in way: lines.append('import Module from "node:module";')
        lines += [before, 'function look() { return %s; }' % look, 'try { %s } catch (error) { console.log(error.constructor.name); }' % way.replace('TEXT', text), 'try { console.log(look()); } catch (error) { console.log(error.constructor.name); }']
        with open(os.path.join(out, '%s-%s.mjs' % (road, deed)), 'w') as f:
            f.write('\n'.join(l for l in lines if l) + '\n')
        count += 1
print(count, 'programs')
