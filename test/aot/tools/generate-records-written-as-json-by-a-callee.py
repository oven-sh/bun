#!/usr/bin/env python3
# generate-records-written-as-json-by-a-callee.py <folder>: all 191; ../parallel/records-written-as-json-by-a-callee/ holds 3 of them: one shape a file: a callee that hands a parameter to JSON.stringify, called with records. Held against `bun <file>`.
import os, sys
out = sys.argv[1]
os.makedirs(out, exist_ok=True)

HEAD = '''// %s
type Inner = { x: number; y: string | null };
type A = { id: number; name: string; tags: string[]; inner: Inner };
type B = { ok: boolean; total: number };
let said = "";
let sunk = 0;
let deeds = 0;
const log: string[] = [];
function spin(n: number): number { let t = 0; for (let i = 0; i < (n & 3); i++) t += i; return t; }
function makeA(n: number)RESULT_A { const t = spin(n); return { id: n + t * 0, name: "n" + n, tags: ["a", "b" + n], inner: { x: n, y: n & 1 ? "odd" : null } }; }
function makeB(n: number)RESULT_B { const t = spin(n); return { ok: n > 1, total: n + t * 0 }; }
function head(status: number, o: { kind: string; length: number }) { sunk += status + o.length; }
function end(text: string) { said += text + "\\n"; }
'''
SEND = 'function send(status: number, value: PARAM): void { const body = JSON.stringify(value) ?? "nothing"; head(status, { kind: "application/json", length: body.length }); end(body); }\n'
TAIL = '''
async function main() {
  for (let k = 0; k < 14; k++) {
    try {
      const answer = await shape(k);
      if (answer !== undefined) said += "answer " + String(answer) + "\\n";
    } catch (error) {
      said += "threw " + (error as Error).name + "\\n";
    }
  }
  console.log(said + sunk + " " + deeds + " " + log.join(","));
}
await main();
'''

# name: (extra declarations, the callee or None for SEND, the body of shape(k))
sites = {
 'one-record': ('', None, 'send(200, makeA(k));'),
 'two-records-in-two-blocks': ('', None, 'if (k & 1) return send(200, makeA(k)); send(201, makeB(k));'),
 'in-tail-position': ('', None, 'return send(200, makeA(k));'),
 'in-a-loop': ('', None, 'for (let i = 0; i < 2; i++) send(200 + i, makeA(k + i));'),
 'under-a-try': ('', None, 'try { send(200, makeA(k)); } catch (error) { said += "caught\\n"; } finally { said += "finally\\n"; }'),
 'record-kept-in-a-const-and-read-behind': ('', None, 'const a = makeA(k); send(200, a); return a.name + a.tags.length;'),
 'field-of-the-record-read-in-front': ('', None, 'const a = makeA(k); const id = a.id; send(200, a); return id + a.inner.x;'),
 'fields-read-in-front-and-behind-in-other-blocks': ('', None, 'const a = makeA(k); const id = a.id; if (id > 3) { send(200, a); return a.name; } send(201, a); return a.tags[0];'),
 'record-changed-in-front': ('', None, 'const a = makeA(k); a.name = "changed"; a.tags.push("more"); send(200, a);'),
 'record-changed-between-two-calls': ('', None, 'const a = makeA(k); send(200, a); a.id = -1; a.inner.y = "late"; send(201, a);'),
 'the-same-record-twice-in-one-call': ('function send2(one: PARAM, other: PARAM) { end((JSON.stringify(one) ?? "n") + (JSON.stringify(other) ?? "n")); }\n', '', 'const a = makeA(k); send2(a, a); send2(makeA(k), makeB(k));'),
 'order-of-evaluation': ('function next(): number { log.push("status"); return 200; }\nfunction late(k: number) { log.push("record"); return makeA(k); }\n', None, 'send(next(), late(k));'),
 'one-of-two-records-by-a-condition': ('', None, 'send(200, k & 1 ? makeA(k) : makeB(k));'),
 'record-or-null': ('function maybe(k: number): A | null { return k % 3 ? makeA(k) : null; }\n', None, 'const a = maybe(k); return a ? send(200, a) : send(404, { error: "none" });'),
 'record-or-null-handed-over-as-it-is': ('function maybe(k: number): A | null { return k % 3 ? makeA(k) : null; }\n', None, 'send(200, maybe(k));'),
 'module-constant': ('const fixed = { error: "invalid", code: 7 };\n', None, 'send(400, fixed);'),
 'literal-at-the-site': ('', None, 'send(200, { id: k, list: [k, k + 1], text: "t" + k });'),
 'list-of-records': ('function list(k: number): A[] { const all: A[] = []; for (let i = 0; i < (k & 3); i++) all.push(makeA(i)); return all; }\n', None, 'send(200, list(k));'),
 'fewer-arguments': ('', None, '(send as any)(200); send(200, makeA(k));'),
 'more-arguments': ('', None, '(send as any)(200, makeA(k), "extra", k);'),
 'spread-call': ('', None, 'const all: [number, A] = [200, makeA(k)]; send(...all);'),
 'by-call-and-apply': ('', None, 'send.call(undefined, 200, makeA(k)); send.apply(undefined, [201, makeB(k)]);'),
 'through-a-variable': ('const through = send;\n', None, 'through(200, makeA(k));'),
 'callee-is-a-method': ('const sender = { prefix: "m", send(status: number, value: PARAM) { end(this.prefix + status + (JSON.stringify(value) ?? "n")); } };\n', '', 'sender.send(200, makeA(k));'),
 'callee-is-a-method-of-a-class': ('class Sender { count = 0; send(status: number, value: PARAM) { this.count++; end(this.count + ":" + status + (JSON.stringify(value) ?? "n")); } }\nconst sender = new Sender();\n', '', 'sender.send(200, makeA(k)); sender.send(201, makeB(k));'),
 'callee-is-a-closure': ('function sender(prefix: string) { return (value: PARAM) => { end(prefix + (JSON.stringify(value) ?? "n")); }; }\nconst sendWith = sender("c");\n', '', 'sendWith(makeA(k));'),
 'callee-returns-the-text': ('function text(value: PARAM): string { return JSON.stringify(value) ?? "n"; }\n', '', 'return text(makeA(k)).length + text(makeB(k));'),
 'callee-returns-the-record': ('function pass(value: PARAM) { end(JSON.stringify(value) ?? "n"); return value; }\n', '', 'const a = pass(makeA(k)) as A; return a.name;'),
 'callee-writes-it-twice': ('function twice(value: PARAM) { end((JSON.stringify(value) ?? "n") + "|" + (JSON.stringify(value) ?? "n")); }\n', '', 'twice(makeA(k));'),
 'callee-changes-it-between-two-writes': ('function twice(value: PARAM) { const first = JSON.stringify(value) ?? "n"; (value as any).id = "changed"; end(first + "|" + (JSON.stringify(value) ?? "n")); }\n', '', 'twice(makeA(k));'),
 'callee-assigns-the-parameter-first': ('function wrapped(value: PARAM) { value = { wrapped: value } as any; end(JSON.stringify(value) ?? "n"); }\n', '', 'wrapped(makeA(k));'),
 'callee-writes-it-on-one-way-only': ('function some(flag: boolean, value: PARAM) { if (!flag) { end("skipped"); return; } end(JSON.stringify(value) ?? "n"); }\n', '', 'some((k & 1) === 1, makeA(k));'),
 'callee-with-a-default': ('function withDefault(value: PARAM = { fallback: true } as any) { end(JSON.stringify(value) ?? "n"); }\n', '', 'withDefault(k & 1 ? makeA(k) : undefined as any);'),
 'callee-with-rest': ('function rest(status: number, ...values: PARAM[]) { end(status + (JSON.stringify(values[0]) ?? "n")); }\n', '', 'rest(200, makeA(k), makeB(k));'),
 'callee-reads-arguments': ('function viaArguments(value: PARAM) { end(arguments.length + (JSON.stringify(value) ?? "n")); }\n', '', 'viaArguments(makeA(k));'),
 'callee-with-options': ('function pretty(value: PARAM) { end(JSON.stringify(value, null, 1) ?? "n"); }\nfunction picked(value: PARAM) { end(JSON.stringify(value, ["id", "name"]) ?? "n"); }\n', '', 'pretty(makeA(k)); picked(makeA(k));'),
 'callee-catches': ('function guarded(value: PARAM) { try { end(JSON.stringify(value) ?? "n"); } catch (error) { end("inner " + (error as Error).name); } }\n', '', 'const a = makeA(k) as any; if (k === 5) a.self = a; guarded(a);'),
 'callee-calls-a-callee': ('function inner(value: PARAM) { end(JSON.stringify(value) ?? "n"); }\nfunction outer(status: number, value: PARAM) { sunk += status; inner(value); }\n', '', 'outer(200, makeA(k)); outer(201, makeB(k));'),
 'callee-calls-itself': ('function again(depth: number, value: PARAM) { end(depth + (JSON.stringify(value) ?? "n")); if (depth) again(depth - 1, value); }\n', '', 'again(k & 1, makeA(k));'),
 'callee-is-async': ('async function later(value: PARAM) { await null; end(JSON.stringify(value) ?? "n"); }\n', '', 'const a = makeA(k); const done = later(a); a.name = "changed before it ran"; return done;'),
 'stringify-read-into-a-const': ('const stringify = JSON.stringify;\nfunction by(value: PARAM) { end(stringify(value) ?? "n"); }\n', '', 'by(makeA(k));'),
 'stringify-replaced-half-way': ('const real = JSON.stringify;\n', None, 'if (k === 7) JSON.stringify = ((v: unknown) => "replaced " + real(v).length) as any; send(200, makeA(k)); if (k === 10) JSON.stringify = real;'),
}
asyncs = {
 'in-a-coroutine': ('', None, 'if (k & 1) return send(200, makeA(k)); await null; send(201, makeB(k));'),
 'record-out-of-an-await': ('async function slow(k: number): Promise<A> { return makeA(k); }\n', None, 'send(200, await slow(k));'),
 'record-made-in-front-of-an-await': ('', None, 'const a = makeA(k); await null; send(200, a); await null; return a.id;'),
}
# what arrives where A is written, on every third call. One deed a file: a deed anywhere may take the plan of the layout away from the whole program.
deeds = {
 'property-added': 'Object.assign(a, { extra: k })',
 'property-deleted': '(delete (a as any).name, a)',
 'keys-in-another-order': '({ inner: a.inner, tags: a.tags, name: a.name, id: a.id })',
 'getter-defined': 'Object.defineProperty(a, "name", { get() { deeds++; return "got"; }, enumerable: true })',
 'property-hidden': 'Object.defineProperty(a, "name", { enumerable: false })',
 'frozen': 'Object.freeze(a)',
 'tojson-of-its-own': 'Object.assign(a, { toJSON() { deeds++; return "mine"; } })',
 'prototype-with-a-tojson': 'Object.setPrototypeOf(a, { toJSON() { deeds++; return { proto: true }; } })',
 'prototype-null': 'Object.setPrototypeOf(a, null)',
 'made-of-it-by-object-create': 'Object.create(a)',
 'proxy': 'new Proxy(a, { get(target, key, receiver) { deeds++; return Reflect.get(target, key, receiver); } })',
 'instance-of-a-class-with-the-same-fields': 'new (class { id = a.id; name = a.name; tags = a.tags; inner = a.inner; get more() { return 1; } })()',
 'null': 'null', 'undefined': 'undefined', 'number': '5', 'text': '"text"', 'boolean': 'true', 'symbol': 'Symbol("s")', 'function': '(() => 1)',
 'bigint': '10n', 'list': '[a, a]', 'date': 'new Date(0)', 'map': 'new Map([[1, a]])', 'boxed-text': 'new String("boxed")',
 'member-of-another-kind': '((a as any).id = "text", (a as any).name = 7, a)',
 'member-undefined': '((a as any).name = undefined, a)',
 'member-a-function': '((a as any).name = () => 1, a)',
 'member-a-bigint': '((a as any).id = 10n, a)',
 'member-with-a-tojson': '((a as any).name = { toJSON() { deeds++; return "member"; } }, a)',
 'numbers-at-their-edges': '((a.id = [NaN, Infinity, -0, 1e21, 1e-7, 0.1 + 0.2][k % 6]!), a)',
 'texts-at-their-edges': '((a.name = ["\\"", "\\\\", "\\n\\u0000\\u001f", "\\ud800", "\\u2028", "\\u00e9\\u4f60", ""][k % 7]!), a)',
 'inner-null': '((a as any).inner = null, a)',
 'inner-of-another-layout': '((a as any).inner = { y: "first", x: 1, z: 2 }, a)',
 'it-holds-itself': '((a as any).inner = a, a)',
 'list-with-a-hole': '((a.tags = ["x", , "z"] as any), a)',
 'list-that-holds-something-else': '((a.tags = [1, null, undefined, { toJSON() { deeds++; return "el"; } }, ["n"], () => 1] as any), a)',
 'list-with-a-property': '(((a.tags as any).extra = 1), a)',
 'list-with-a-tojson': '(((a.tags as any).toJSON = () => "list"), a)',
 'list-of-a-subclass': '((a.tags = new (class extends Array<string> {})("p", "q")), a)',
 'list-that-is-long': '((a.tags = new Array(3000).fill("t")), a)',
 'list-that-is-no-list': '((a as any).tags = { length: 2, 0: "x", 1: "y" }, a)',
}
# Object.prototype and Array.prototype are locked in a compiled program, on purpose (test/aot/parallel/host-classes/locked-prototypes.ts): a toJSON laid on them differs from plain Bun with and without this unit.
worlds = {
 'string-prototype-gets-a-tojson': 'if (k === 6) (String.prototype as any).toJSON = function () { deeds++; return "texts"; }; send(200, makeA(k)); if (k === 9) delete (String.prototype as any).toJSON;',
 'number-prototype-gets-a-tojson': 'if (k === 6) (Number.prototype as any).toJSON = function () { deeds++; return "numbers"; }; send(200, makeA(k)); if (k === 9) delete (Number.prototype as any).toJSON;',
}
n = 0


def write(name, extra, callee, body, kind, param, results):
    global n
    s = HEAD % name.replace('-', ' ')
    s = s.replace('RESULT_A', ': A' if results else '').replace('RESULT_B', ': B' if results else '')
    s += (SEND if callee is None else callee).replace('PARAM', param)
    s += extra.replace('PARAM', param)
    s += '%sfunction shape(k: number)%s { %s }\n' % (kind, ': Promise<unknown>' if kind else ': unknown', body)
    s += TAIL
    open(os.path.join(out, name + '.ts'), 'w').write(s)
    n += 1


for group, kind in ((sites, ''), (asyncs, 'async ')):
    for name, (extra, callee, body) in group.items():
        for param, twin in (('unknown', ''), ('A | B', '-written-a-union'), ('any', '-written-any')):
            if twin == '-written-any' and name not in ('one-record', 'two-records-in-two-blocks', 'field-of-the-record-read-in-front', 'in-a-coroutine', 'callee-returns-the-text'):
                continue
            write(name + twin, extra, callee, body, kind, param if twin != '-written-a-union' else 'A | B | null | undefined | { [key: string]: unknown } | unknown[]' if name in ('record-or-null', 'record-or-null-handed-over-as-it-is', 'module-constant', 'literal-at-the-site', 'list-of-records', 'callee-with-a-default', 'callee-assigns-the-parameter-first') else 'A | B', True)
for name in ('one-record', 'two-records-in-two-blocks', 'field-of-the-record-read-in-front', 'record-kept-in-a-const-and-read-behind'):
    extra, callee, body = sites[name]
    write(name + '-of-makers-whose-results-are-not-written', extra, callee, body, '', 'unknown', False)
    write(name + '-written-object', extra, callee, body, '', 'object', True)
    write(name + '-written-a-type-parameter', extra, 'function send<T>(status: number, value: T): void { const body = JSON.stringify(value) ?? "nothing"; head(status, { kind: "application/json", length: body.length }); end(body); }\n', body, '', 'unknown', True)
for name, deed in deeds.items():
    for param, twin in (('unknown', ''), ('A', '-written-the-record')):
        write('arrives-' + name + twin, 'function pick(k: number): A { const a = makeA(k); const t = spin(k); return (k %% 3 === 2 + t * 0 ? %s : a) as A; }\n' % deed, None, 'send(200, pick(k));', '', param, True)
for name, body in worlds.items():
    write('world-' + name, '', None, body, '', 'unknown', True)
print(n, 'programs in', out)
