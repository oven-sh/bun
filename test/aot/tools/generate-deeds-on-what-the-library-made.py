# generate-deeds-on-what-the-library-made.py <outdir>: Link follows the layouts of the library inside the library alone. What the PROGRAM does to an object that a built-in of the library has made is booked on the row's site.
# So whoever types such an object by its layout (a body copied in line, a guess that a shape test confirms) leans on claims that do not count the caller's deeds.
# maker x deed x where the deed is done x observer. ONE SHAPE A FILE. Every program prints what plain Bun prints.
import sys, os
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
makers = {
 'array-values-next':   '[n, 2].values().next()',
 'array-entries-next':  '[n, 2].entries().next()',
 'map-values-next':     'new Map([[n, 2]]).values().next()',
 'set-values-next':     'new Set([n, 2]).values().next()',
 'string-iterator-next': '"ab"[Symbol.iterator]().next()',
 'generator-next':      'numbers(n).next()',
 'generator-return':    'numbers(n).return(n)',
 'helper-map-next':     'Iterator.from([n]).map(x => x).next()',
 'wrapped-next':        'Iterator.from({ next() { return { done: false, value: n }; } }).next()',
 'step-at-the-end':     '((it) => (it.next(), it.next()))([n].values())',
 'from-entries':        'Object.fromEntries([["value", n], ["done", false]])',
 'group-by':            'Object.groupBy([n], () => "value")',
 'with-resolvers':      'Object.assign(Promise.withResolvers(), { value: n, done: false })',
 'descriptor':          'Object.assign(Object.getOwnPropertyDescriptor({ x: n }, "x"), { done: false })',
 'literal-control':     '({ value: n, done: false })',
}
deeds = {
 'stores-a-text-in-done':      'o.done = "text";',
 'stores-an-empty-text-in-done': 'o.done = "";',
 'stores-a-number-in-done':    'o.done = 0;',
 'stores-an-object-in-value':  'o.value = { inner: 1 };',
 'stores-undefined-in-value':  'o.value = undefined;',
 'deletes-value':              'delete o.value;',
 'deletes-done':               'delete o.done;',
 'deletes-and-stores-again':   'delete o.value; o.value = "again";',
 'adds-a-name':                'o.extra = 1;',
 'freezes-and-stores':         'Object.freeze(o); try { o.value = 9; } catch (error) { seen.push(error.constructor.name); }',
 'seals-and-deletes':          'Object.seal(o); try { delete o.value; } catch (error) { seen.push(error.constructor.name); }',
 'prevents-extensions-and-adds': 'Object.preventExtensions(o); try { o.extra = 1; } catch (error) { seen.push(error.constructor.name); }',
 'lays-a-getter-over-value':   'Object.defineProperty(o, "value", { get() { return "got"; }, configurable: true });',
 'lays-a-getter-over-done':    'Object.defineProperty(o, "done", { get() { seen.push("asked"); return true; }, configurable: true });',
 'makes-value-read-only':      'Object.defineProperty(o, "value", { writable: false }); try { o.value = 9; } catch (error) { seen.push(error.constructor.name); }',
 'hides-value':                'Object.defineProperty(o, "value", { enumerable: false });',
 'links-it-below-another':     'Object.setPrototypeOf(o, { extra: "above" });',
 'links-it-below-nothing':     'Object.setPrototypeOf(o, null);',
 'links-it-by-proto':          'o.__proto__ = { extra: "above" };',
 'deletes-and-links':          'delete o.done; Object.setPrototypeOf(o, { done: "above" });',
 'assigns-over-it':            'Object.assign(o, { value: "assigned", done: 1 });',
 'stores-under-a-made-up-key': 'o[["do", "ne"].join("")] = "text";',
 'nothing-control':            '',
}
places = {
 'in-sight':        ('', 'const o = k; DEED'),
 'in-a-callee':     ('function deed(o) { DEED }', 'deed(k);'),
 'through-a-field': ('const box = { k: null };', 'box.k = k; const o = box.k; DEED'),
}
observers = {
 'reads-both':      'String(k.value) + "|" + String(k.done)',
 'branches-on-done': 'k.done ? "done" : "not done"',
 'typeof-done':     'typeof k.done + typeof k.value',
 'keys':            'Object.keys(k).join()',
 'json':            'JSON.stringify(k)',
 'in':              '("value" in k) + "|" + ("done" in k) + "|" + ("extra" in k)',
 'has-own':         'Object.hasOwn(k, "value") + "|" + Object.hasOwn(k, "done")',
 'pattern':         '(({ value, done }) => String(value) + "|" + String(done))(k)',
 'spread':          'JSON.stringify({ ...k })',
 'extra':           'String(k.extra)',
 'read-by-a-callee': 'readBoth(k)',
 'stepped-by-a-loop': '(() => { let turns = 0; for (const x of { [Symbol.iterator]() { return { next() { return turns++ < 2 ? k : { done: true, value: 0 }; } }; } }) seen.push(String(x)); return turns; })()',
 'taken-apart-by-a-pattern': '(() => { let turns = 0; const [a, b] = { [Symbol.iterator]() { return { next() { return turns++ < 1 ? k : { done: true, value: 0 }; } }; } }; return String(a) + "|" + String(b); })()',
 'is-frozen':       'Object.isFrozen(k) + "|" + Object.isSealed(k) + "|" + Object.isExtensible(k)',
}
count = 0
for maker, text in makers.items():
    for deed, act in deeds.items():
        for place, (before, done) in places.items():
            for observer, look in observers.items():
                lines = ['// %s; the program %s, %s; %s.' % (maker.replace('-', ' '), deed.replace('-', ' '), place.replace('-', ' '), observer.replace('-', ' ')),
                         'const seen = [];', 'function* numbers(n) { yield n; }', 'function readBoth(o) { return String(o.value) + "|" + String(o.done); }', before.replace('DEED', act),
                         'function run(n) {', '  const k = %s;' % text, '  %s' % done.replace('DEED', act), '  return %s;' % look, '}',
                         'try { console.log(String(run(1)), String(run(2)), seen.join()); } catch (error) { console.log(error.constructor.name, seen.join()); }']
                with open(os.path.join(out, '%s-%s-%s-%s.mjs' % (maker, deed, place, observer)), 'w') as f:
                    f.write('\n'.join(l for l in lines if l.strip()) + '\n')
                count += 1
print(count, 'programs')
