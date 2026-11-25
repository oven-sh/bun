# generate-kept-by-a-row.py <outdir>: for LinkedParameter::escapes = false, which for a built-in rests on the SILENCE of its row: a fresh object is handed to a built-in that KEEPS it, hands it back or hands it on.
# Whoever took the object for one that nobody else holds would keep its fields in registers: a store behind the call would not be seen through the keeper, nor one through the keeper by the maker.
# keeper x who hands it over x what is looked at. ONE SHAPE A FILE. Every program prints what plain Bun prints.
import sys, os
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
# name: (what is there beforehand, KEEP(o): a statement, TAKE: an expression that gives the object back; `await` allowed)
keepers = {
 'push':                ('const list = [];', 'list.push(o);', 'list[0]'),
 'push-by-call':        ('const list = [];', 'Array.prototype.push.call(list, o);', 'list[0]'),
 'unshift':             ('const list = [];', 'list.unshift(o);', 'list[0]'),
 'splice':              ('const list = [];', 'list.splice(0, 0, o);', 'list[0]'),
 'fill':                ('const list = [0];', 'list.fill(o);', 'list[0]'),
 'with':                ('let list = [0];', 'list = list.with(0, o);', 'list[0]'),
 'to-spliced':          ('let list = [];', 'list = list.toSpliced(0, 0, o);', 'list[0]'),
 'concat':              ('let list = [];', 'list = list.concat(o);', 'list[0]'),
 'concat-a-list':       ('let list = [];', 'list = list.concat([o]);', 'list[0]'),
 'array-of':            ('let list;', 'list = Array.of(o);', 'list[0]'),
 'array-from':          ('let list;', 'list = Array.from([o]);', 'list[0]'),
 'array-from-a-set':    ('let list;', 'list = Array.from(new Set([o]));', 'list[0]'),
 'spread':              ('let list;', 'list = [...[o]];', 'list[0]'),
 'map-callback':        ('let list;', 'list = [0].map(() => o);', 'list[0]'),
 'flat':                ('let list;', 'list = [[o]].flat();', 'list[0]'),
 'slice':               ('let list;', 'list = [o].slice();', 'list[0]'),
 'filter':              ('let list;', 'list = [o].filter(() => true);', 'list[0]'),
 'find':                ('let found;', 'found = [o].find(() => true);', 'found'),
 'at':                  ('let found;', 'found = [o].at(0);', 'found'),
 'pop':                 ('let found;', 'found = [o].pop();', 'found'),
 'reduce':              ('let found;', 'found = [o].reduce((a, b) => b, null);', 'found'),
 'map-set':             ('const map = new Map();', 'map.set("k", o);', 'map.get("k")'),
 'map-key':             ('const map = new Map();', 'map.set(o, 1);', '[...map.keys()][0]'),
 'map-of-entries':      ('let map;', 'map = new Map([["k", o]]);', 'map.get("k")'),
 'set-add':             ('const set = new Set();', 'set.add(o);', '[...set][0]'),
 'set-of-a-list':       ('let set;', 'set = new Set([o]);', '[...set][0]'),
 'weak-map-value':      ('const key = {}; const map = new WeakMap();', 'map.set(key, o);', 'map.get(key)'),
 'weak-ref':            ('let ref;', 'ref = new WeakRef(o);', 'ref.deref()'),
 'freeze-not':          ('let kept;', 'kept = Object.preventExtensions(o);', 'kept'),
 'seal':                ('let kept;', 'kept = Object.seal(o);', 'kept'),
 'assign-target':       ('let kept;', 'kept = Object.assign(o, {});', 'kept'),
 'assign-value':        ('const holder = {};', 'Object.assign(holder, { k: o });', 'holder.k'),
 'define-property':     ('const holder = {};', 'Object.defineProperty(holder, "k", { value: o });', 'holder.k'),
 'define-on-it':        ('let kept;', 'kept = Object.defineProperty(o, "extra", { value: 1 });', 'kept'),
 'from-entries':        ('let holder;', 'holder = Object.fromEntries([["k", o]]);', 'holder.k'),
 'entries':             ('let pairs;', 'pairs = Object.entries({ k: o });', 'pairs[0][1]'),
 'values':              ('let list;', 'list = Object.values({ k: o });', 'list[0]'),
 'create-below':        ('let below;', 'below = Object.create(o);', 'Object.getPrototypeOf(below)'),
 'set-prototype-of':    ('const below = {};', 'Object.setPrototypeOf(below, o);', 'Object.getPrototypeOf(below)'),
 'set-prototype-of-it': ('let kept;', 'kept = Object.setPrototypeOf(o, null);', 'kept'),
 'reflect-set':         ('const holder = {};', 'Reflect.set(holder, "k", o);', 'holder.k'),
 'reflect-apply-this':  ('let kept; function self() { return this; }', 'kept = Reflect.apply(self, o, []);', 'kept'),
 'reflect-apply-argument': ('let kept; function first(a) { return a; }', 'kept = Reflect.apply(first, null, [o]);', 'kept'),
 'call-this':           ('let kept; function self() { return this; }', 'kept = self.call(o);', 'kept'),
 'apply-argument':      ('let kept; function first(a) { return a; }', 'kept = first.apply(null, [o]);', 'kept'),
 'bind-this':           ('let bound; function self() { return this; }', 'bound = self.bind(o);', 'bound()'),
 'bind-argument':       ('let bound; function first(a) { return a; }', 'bound = first.bind(null, o);', 'bound()'),
 'proxy-target':        ('let proxy;', 'proxy = new Proxy(o, {});', 'proxy'),
 'proxy-handler':       ('let handler;', 'handler = o; new Proxy({}, o);', 'handler'),
 'promise-resolve':     ('let promise;', 'promise = Promise.resolve(o);', 'await promise'),
 'promise-reject':      ('let promise;', 'promise = Promise.reject(o); promise.catch(() => {});', 'await promise.catch(e => e)'),
 'promise-all':         ('let promise;', 'promise = Promise.all([o]);', '(await promise)[0]'),
 'resolver':            ('let promise;', 'promise = new Promise(resolve => resolve(o));', 'await promise'),
 'then-result':         ('let promise;', 'promise = Promise.resolve(0).then(() => o);', 'await promise'),
 'with-resolvers':      ('const parts = Promise.withResolvers();', 'parts.resolve(o);', 'await parts.promise'),
 'error-cause':         ('let error;', 'error = new Error("m", { cause: o });', 'error.cause'),
 'aggregate-error':     ('let error;', 'error = new AggregateError([o]);', 'error.errors[0]'),
 'generator-next':      ('function* g() { kept = yield 0; } let kept; const it = g(); it.next();', 'it.next(o);', 'kept'),
 'generator-return':    ('function* g() { yield 0; } const it = g(); it.next(); let step;', 'step = it.return(o);', 'step.value'),
 'iterator-from':       ('let it;', 'it = Iterator.from([o]);', 'it.next().value ?? again'),
 'group-by':            ('let groups;', 'groups = Object.groupBy([o], () => "k");', 'groups.k[0]'),
 'timer-argument':      ('let kept; let done;', 'done = new Promise(resolve => setTimeout(a => { kept = a; resolve(); }, 0, o));', '(await done, kept)'),
 'next-tick-argument':  ('let kept; let done;', 'done = new Promise(resolve => process.nextTick(a => { kept = a; resolve(); }, o));', '(await done, kept)'),
 'emitter':             ('const emitter = new EventEmitter(); let kept; emitter.on("x", a => { kept = a; });', 'emitter.emit("x", o);', 'kept'),
 'custom-event':        ('let event;', 'event = new CustomEvent("e", { detail: o });', 'event.detail'),
 'abort-reason':        ('let signal;', 'signal = AbortSignal.abort(o);', 'signal.reason'),
 'async-local-storage': ('const storage = new AsyncLocalStorage(); let kept;', 'storage.run(o, () => { kept = storage.getStore(); });', 'kept'),
 'json-replacer':       ('let kept;', 'JSON.stringify({ k: o }, (k, v) => { if (k === "k") kept = v; return 0; });', 'kept'),
 'sort-comparator':     ('let kept;', '[o, o].sort((a, b) => { kept = a; return 0; });', 'kept'),
 'symbol-keyed':        ('const holder = {}; const key = Symbol();', 'Reflect.defineProperty(holder, key, { value: o });', 'holder[key]'),
 'global':              ('', 'Reflect.set(globalThis, "keptByARow", o);', 'globalThis.keptByARow'),
 'structured-clone-control': ('let copy;', 'copy = structuredClone(o);', 'copy'),
}
# What the maker does: M = the statements of the maker behind the birth of `o`; the result is printed.
looks = {
 'store-behind-the-call':    ('KEEP o.x = 2; return 0;', '(TAKE).x'),
 'store-through-the-keeper': ('KEEP (TAKE).x = 5; return o.x;', '"-"'),
 'is-the-same':              ('KEEP return (TAKE) === o;', '"-"'),
 'added-behind-the-call':    ('KEEP try { o.y = 3; } catch {} return 0;', 'String((TAKE).y)'),
 'in-a-loop':                ('for (let i = 0; i < 3; i++) { if (i === 1) { KEEP } o.x += 1; } return o.x;', '(TAKE).x'),
}
hands = {
 'the-maker':   'async function make() { const o = { x: 1 }; BODY }',
 'a-callee':    'async function hand(o) { HANDED }\nasync function make() { const o = { x: 1 }; BODY }',
 'an-instance': 'class P { x = 1; }\nasync function make() { const o = new P(); BODY }',
}
count = 0
for keeper, (before, keep, take) in keepers.items():
    for look, (body, after) in looks.items():
        for hand, text in hands.items():
            kept = keep if hand != 'a-callee' else 'await hand(o);'
            lines = ['// A fresh object is handed to %s by %s: %s.' % (keeper.replace('-', ' '), hand.replace('-', ' '), look.replace('-', ' '))]
            if 'EventEmitter' in before: lines.append('import { EventEmitter } from "node:events";')
            if 'AsyncLocalStorage' in before: lines.append('import { AsyncLocalStorage } from "node:async_hooks";')
            whole = text.replace('HANDED', keep).replace('BODY', body.replace('KEEP', kept).replace('TAKE', take))
            # A coroutine keeps the defaults of Link, so whatever needs no await is written without one.
            if 'await' not in keep + take:
                whole = whole.replace('async function', 'function').replace('await hand(o);', 'hand(o);')
            lines += [before, 'const again = { x: "again" };', whole,
                      'try { const answer = await make(); console.log(String(answer), String(%s)); } catch (error) { console.log(error.constructor.name); }' % after.replace('TAKE', take)]
            with open(os.path.join(out, '%s-%s-%s.mjs' % (keeper, look, hand)), 'w') as f:
                f.write('\n'.join(l for l in lines if l) + '\n')
            count += 1
print(count, 'programs')
