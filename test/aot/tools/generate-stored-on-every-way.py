# generate-stored-on-every-way.py <outdir>: for "variables stored first" (LinkedCell::isFilled of a variable, InitializationState::StoredBeforeEveryRead): the store stands in front of the reader in the text,
# and on the way that runs it has not run yet, or never runs. THE CLAIM IS MADE OF FILES WITHOUT A TABLE OF EXPORTS: CommonJS and the library; the .mjs twins are the control. shape of the body x who reads x use. ONE SHAPE A FILE. Every program prints what plain Bun prints.
import sys, os
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
# `v` is a variable of the module. READ: a call of the reader.
shapes = {
 'branch-not-taken':          'if (no()) var v = 1;',
 'else-not-taken':            'if (yes()) {} else { var v = 1; }',
 'loop-of-no-turns':          'for (let i = 0; i < zero(); i++) { var v = 1; }',
 'while-of-no-turns':         'while (no()) { var v = 1; }',
 'do-left-early':             'do { if (yes()) break; var v = 1; } while (no());',
 'behind-a-throw':            'try { thrower(); var v = 1; } catch {}',
 'initializer-throws':        'try { var v = thrower(); } catch {}',
 'finally-branch':            'try { thrower(); } catch {} finally { if (no()) var v = 1; }',
 'case-not-taken':            'switch (two()) { case 1: var v = 1; break; default: }',
 'case-fallen-past':          'switch (two()) { case 1: var v = 1; case 2: seen.push(READ); }',
 'block-left-early':          'out: { if (yes()) break out; var v = 1; }',
 'and-not-taken':             'no() && (v = 1); var v;',
 'or-not-taken':              'yes() || (v = 1); var v;',
 'conditional-not-taken':     'yes() ? 0 : (v = 1); var v;',
 'for-in-of-nothing':         'for (var v in {}) {}',
 'for-of-of-nothing':         'for (var v of []) {}',
 'pattern-finds-nothing':     'var { v } = {};',
 'list-pattern-finds-nothing': 'var [v] = [];',
 'read-in-the-first-turn':    'for (const k of [1, 2]) { if (k === 1) { seen.push(READ); continue; } var v = 1; }',
 'read-in-the-other-arm':     'for (let i = 0; i < 2; i++) { if (i) var v = 1; else seen.push(READ); }',
 'read-at-the-head-of-a-loop': 'for (let i = 0; i < 2; i++) { seen.push(READ); var v = 1; }',
 'read-in-a-branch-in-front': 'if (yes()) { seen.push(READ); } var v = 1;',
 'read-in-the-initializer':   'var v = (seen.push(READ), 1);',
 'read-is-the-initializer':   'var v = READ;',
 'read-by-another-name':      'const early = reader; seen.push(early()); var v = 1;',
 'read-out-of-a-list':        'const held = [reader]; seen.push(held[0]()); var v = 1;',
 'read-in-a-default':         'function f(a = READ) { return a; } seen.push(f()); var v = 1;',
 'read-behind-an-await':      'const job = Promise.resolve().then(() => seen.push(READ)); await job; var v = 1;',
 'read-under-an-await':       'queueMicrotask(() => seen.push(READ)); await null; var v = 1;',
 'store-behind-an-await-in-a-branch': 'if (no()) { await null; var v = 1; }',
 'let-read-in-its-initializer':   'let v = (seen.push(READ), 1);',
 'let-read-is-its-initializer':   'let v = READ;',
 'const-read-in-an-arrow':        'const v = (() => READ)();',
 'const-read-by-a-getter':        'const v = { get g() { return READ; } }.g;',
 'const-read-in-a-pattern-default': 'const [a = READ, v = 1] = []; seen.push(a);',
 'const-read-by-a-computed-key':  'const { [(seen.push(READ), "k")]: v = 1 } = {};',
 'class-read-in-a-static-field':  'class v { static s = seen.push(READ); }',
 'class-read-in-its-heritage':    'class v extends (seen.push(READ), Object) {}',
 'class-read-in-a-computed-key':  'class v { [(seen.push(READ), "k")]() {} }',
 'class-read-in-a-static-block':  'class v { static { seen.push(READ); } }',
 'let-behind-a-read-in-a-branch': 'if (yes()) seen.push(READ); let v = 1;',
 'let-without-a-value':           'let v; seen.push(READ); v = 1;',
 'file-left-early':               'process.on("exit", () => console.log("at the exit", READ)); if (yes()) return; var v = 1;',
 'file-left-early-behind-a-read': 'if (yes()) { console.log(seen.join(), READ); return; } var v = 1;',
 'file-left-early-in-a-loop':     'globalThis.left = reader; for (const k of [1]) { if (yes()) { setTimeout(() => console.log("later", globalThis.left())); return; } } var v = 1;',
 'file-left-by-a-throw':          'process.on("uncaughtException", () => console.log("caught", READ)); thrower(); var v = 1;',
 'required-again-while-it-runs':  'if (!globalThis.again) { globalThis.again = reader; require(__filename); seen.push(globalThis.again()); } var v = 1;',
 'stored-on-both-arms':           'if (yes()) var v = 1; else v = 2;',
 'stored-at-once':                'var v = 1;',
}
readers = {
 'function':  'function reader() { try { return USE; } catch (error) { return error.constructor.name; } }',
 'arrow':     'const reader = () => { try { return USE; } catch (error) { return error.constructor.name; } };',
 'method':    'const holder = { reader() { try { return USE; } catch (error) { return error.constructor.name; } } };\nconst reader = () => holder.reader();',
 'through-another': 'function inner() { return USE; }\nfunction reader() { try { return inner(); } catch (error) { return error.constructor.name; } }',
}
uses = ['typeof v', 'v === undefined', 'String(typeof v === "function" ? "class" : v)', 'typeof v === "function" ? "class" : v + 1', 'typeof v === "function" ? "class" : v ?? "nothing"']
helpers = 'const seen = [];\nfunction yes() { return Date.now() > 0; }\nfunction no() { return Date.now() < 0; }\nfunction zero() { return Date.now() > 0 ? 0 : 1; }\nfunction two() { return Date.now() > 0 ? 2 : 1; }\nfunction thrower() { throw new Error("thrown"); }'
count = 0
for shape, text in shapes.items():
    for who, reader in readers.items():
        for number, use in enumerate(uses):
            for kind in ('mjs', 'cjs'):
                if kind == 'cjs' and 'await' in text or kind == 'mjs' and ('return;' in text or 'require(' in text):
                    continue
                with open(os.path.join(out, '%s-%s-%d.%s' % (shape, who, number, kind)), 'w') as f:
                    f.write('\n'.join(['// %s; the reader is a %s.' % (shape.replace('-', ' '), who.replace('-', ' ')), helpers, reader.replace('USE', use),
                                       text.replace('READ', 'reader()'), 'console.log(seen.join(), reader());']) + '\n')
                count += 1
print(count, 'programs')
