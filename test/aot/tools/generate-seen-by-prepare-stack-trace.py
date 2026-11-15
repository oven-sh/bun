# generate-seen-by-prepare-stack-trace.py <outdir>: whoever asks an error for its stack hands the error to what the program has laid under Error.prepareStackTrace, which does ONE DEED to it.
# maker x road x deed x use. Every program prints what plain Bun prints.
import sys, os
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
makers = {
 'class-below-error':       ('class E extends Error { x = 1; y = 2; m() { return "E" + this.y; } }', 'new E("m")'),
 'class-below-type-error':  ('class E extends TypeError { x = 1; y = 2; m() { return "E" + this.y; } }', 'new E("m")'),
 'class-two-below':         ('class B extends Error { y = 2; }\nclass E extends B { x = 1; m() { return "E" + this.y; } }', 'new E("m")'),
 'captured-object':         ('class E { x = 1; y = 2; m() { return "E" + this.y; } }', 'captured(new E())'),
 'captured-record':         ('', 'captured({ x: 1, y: 2, m() { return "E" + this.y; } })'),
 'error-with-fields':       ('', 'Object.assign(new Error("m"), { x: 1, y: 2, m() { return "E" + this.y; } })'),
}
roads = {
 'by-name':          'made.stack;',
 'in-a-text':        '`${made.stack}`;',
 'destructured':     'const { stack } = made;',
 'made-up-key':      'made[["st", "ack"].join("")];',
 'reflect-get':      'Reflect.get(made, "stack");',
 'descriptor':       'Object.getOwnPropertyDescriptor(made, "stack");',
 'descriptors':      'Object.getOwnPropertyDescriptors(made);',
 'own-names-mapped': 'Object.getOwnPropertyNames(made).map(k => made[k]);',
 'inspect':          'util.inspect(made);',
 'capture-again':    'Error.captureStackTrace(made);',
 'in-a-callee':      'readStack(made);',
 'caught':           'try { throw made; } catch (e) { e.stack; }',
 'caught-in-a-callee': 'try { thrower(made); } catch (e) { e.stack; }',
 'rejected':         'try { await Promise.reject(made); } catch (e) { e.stack; }',
 'optional':         'made?.stack;',
 'has':              '"stack" in made;',
 'clone':            'try { structuredClone(made); } catch {}',
 'as-a-cause':       'new Error("o", { cause: made }).cause.stack;',
}
deeds = {
 'stores':           'e.x = "s";',
 'deletes':          'delete e.x;',
 'adds':             'e.z = 1;',
 'defines-a-getter': 'Object.defineProperty(e, "x", { get() { return "g"; }, configurable: true });',
 'changes-the-prototype': 'Object.setPrototypeOf(e, Q.prototype);',
 'overrides-a-method': 'e.m = () => "own";',
 'keeps':            'kept.push(e);',
}
uses = ['p.x + 1', 'typeof p.x', 'p.m()', 'Object.keys(p).join()']
count = 0
for maker, (before, made) in makers.items():
    for road, way in roads.items():
        for deed, done in deeds.items():
            for number, use in enumerate(uses):
                lines = ['// The stack of an error (%s) is asked for %s; what lies under Error.prepareStackTrace %s.' % (maker.replace('-', ' '), road.replace('-', ' '), deed.replace('-', ' '))]
                if 'util.' in way: lines.append('import util from "node:util";')
                if before: lines.append(before)
                lines += ['class Q { m() { return "Q"; } }', 'const kept = [];', 'function captured(o) { Error.captureStackTrace(o); return o; }', 'function readStack(e) { return e.stack; }', 'function thrower(v) { throw v; }',
                          'Error.prepareStackTrace = (e, sites) => { try { %s } catch (error) { console.log(error.constructor.name); } return "t"; };' % done,
                          'function use(p) { return %s; }' % use, 'const made = %s;' % made, way, 'if (kept.length) kept[0].x = "l";',
                          'try { console.log(use(made)); } catch (error) { console.log(error.constructor.name); }']
                with open(os.path.join(out, '%s-%s-%s-%d.mjs' % (maker, road, deed, number)), 'w') as f:
                    f.write('\n'.join(lines) + '\n')
                count += 1
print(count, 'programs')
