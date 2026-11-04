# generate-parsed-by-the-written-type.py <outdir>: a written type is a GUESS about a text. Whatever the text holds, what JSON.parse gives must be, observably, what plain Bun makes.
# type x how the type is written x text x what looks at the result. ONE SHAPE A FILE: one type, one way, one text. Every program prints what plain Bun prints.
import sys, os, json
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
# name: (declarations, the type's name, a text that fits, the reads that the type allows: expressions over `v`)
types = {
 'record':        ('type T = { port: number; host: string; };', '{"port":1,"host":"a"}', ['v.port', 'v.host']),
 'optional':      ('type T = { port: number; host?: string; };', '{"port":1,"host":"a"}', ['v.port', 'v.host']),
 'three':         ('type T = { a: number; b: boolean; c: string; };', '{"a":1,"b":true,"c":"x"}', ['v.a', 'v.b', 'v.c']),
 'nested':        ('type T = { user: { id: number; name: string; }; on: boolean; };', '{"user":{"id":1,"name":"n"},"on":true}', ['v.user && v.user.id', 'v.user && v.user.name', 'v.on']),
 'with-a-list':   ('type T = { tags: string[]; n: number; };', '{"tags":["x","y"],"n":1}', ['v.tags && v.tags.length', 'v.tags && v.tags[0]', 'v.n']),
 'nullable-member': ('type T = { a: number | null; b: string | null; };', '{"a":null,"b":"x"}', ['v.a', 'v.b']),
 'literals':      ('type T = { mode: "on" | "off"; yes: true; none: null; };', '{"mode":"on","yes":true,"none":null}', ['v.mode', 'v.yes', 'v.none']),
 'interface':     ('interface T { port: number; host: string; }', '{"port":1,"host":"a"}', ['v.port', 'v.host']),
 'class':         ('class T { port = 0; host = ""; both() { return this.port + this.host; } }', '{"port":1,"host":"a"}', ['v.port', 'v.host', 'typeof v.both', 'v instanceof T']),
 'with-a-method': ('type T = { port: number; show(): string; };', '{"port":1,"show":"a"}', ['v.port', 'typeof v.show']),
 'beside-a-literal': ('type T = { port: number; host: string; };\nconst made: T = { port: 7, host: "made" };', '{"port":1,"host":"a"}', ['v.port', 'v.host', 'made.port', 'made.host']),
}
listTypes = {
 'list':          ('type E = { id: number; name: string; };\ntype T = E[];', '{"id":1,"name":"n"}', ['v.length', 'v[0] && v[0].id', 'v[0] && v[0].name', 'v[1] && v[1].id']),
}
# How the type reaches the call. LOAD: the declaration of `load(text: string)`.
ways = {
 'as':            'function load(text: string) { return JSON.parse(text) as T; }',
 'declared-variable': 'function load(text: string) { const parsed: T = JSON.parse(text); return parsed; }',
 'declared-result': 'function load(text: string): T { return JSON.parse(text); }',
 'argument':      'function take(value: T) { return value; }\nfunction load(text: string) { return take(JSON.parse(text)); }',
 'angle-brackets': 'function load(text: string) { return <T>JSON.parse(text); }',
 'untyped-beside-a-typed-one': 'function typed(text: string) { return JSON.parse(text) as T; }\nfunction load(text: string): any { typed(FITS); return JSON.parse(text); }',
 'text-of-any-type': 'function load(text: any) { return JSON.parse(text) as T; }',
}
def members(text):
    return list(json.loads(text).items())
def spell(pairs):
    return '{' + ','.join(json.dumps(k) + ':' + (v if isinstance(v, Raw) else json.dumps(v, separators=(',', ':'))) for k, v in pairs) + '}'
class Raw(str):
    pass
def textsOf(fits):
    m = members(fits)
    first, last = m[0], m[-1]
    other = lambda v: 'text' if not isinstance(v, str) else 5
    t = {
     'fits': fits,
     'other-order': spell(m[::-1]),
     'blanks': fits.replace(':', ' : ').replace(',', ' ,\\n ').replace('{', '{ ', 1),
     'first-left-out': spell(m[1:]),
     'last-left-out': spell(m[:-1]),
     'empty': '{}',
     'one-more-in-front': spell([('more', 1)] + m),
     'one-more-in-the-middle': spell(m[:1] + [('more', [1, {'a': 2}])] + m[1:]),
     'one-more-at-the-end': spell(m + [('more', None)]),
     'first-twice': spell(m + [first]),
     'first-twice-with-another-value': spell([(first[0], 99)] + m),
     'first-twice-the-second-of-another-type': spell(m + [(first[0], other(first[1]))]),
     'first-twice-the-first-of-another-type': spell([(first[0], other(first[1]))] + m),
     'last-twice-side-by-side': spell(m + [last]),
     'first-of-another-type': spell([(first[0], other(first[1]))] + m[1:]),
     'last-of-another-type': spell(m[:-1] + [(last[0], other(last[1]))]),
     'first-null': spell([(first[0], None)] + m[1:]),
     'first-an-object': spell([(first[0], {'x': 1})] + m[1:]),
     'first-a-list': spell([(first[0], [1])] + m[1:]),
     'first-false': spell([(first[0], False)] + m[1:]),
     'proto-an-object-in-front': spell([('__proto__', dict(m))] + m[1:]),
     'proto-an-object-at-the-end': spell(m + [('__proto__', {'extra': 1})]),
     'proto-null': spell([('__proto__', None)] + m),
     'proto-a-number': spell(m[:1] + [('__proto__', 5)] + m[1:]),
     'proto-alone': '{"__proto__":' + fits + '}',
     'constructor': spell(m + [('constructor', 1)]),
     'to-string': spell([('toString', 1)] + m),
     'has-own-property': spell(m + [('hasOwnProperty', 'x')]),
     'value-of': spell(m + [('valueOf', None)]),
     'index-in-front': spell([('0', 'zero')] + m),
     'index-at-the-end': spell(m + [('1', 'one'), ('0', 'zero')]),
     'large-index': spell(m + [('4294967295', 1), ('4294967294', 2)]),
     'index-with-a-zero-in-front': spell(m + [('01', 1)]),
     'negative-index': spell([('-1', 1)] + m),
     'empty-name': spell([('', 1)] + m),
     'name-with-an-escape': fits.replace('"' + first[0] + '"', '"\\\\u00' + format(ord(first[0][0]), '02x') + first[0][1:] + '"', 1),
     'last-name-with-an-escape': spell(m[:-1]) [:-1] + (',' if len(m) > 1 else '') + '"\\\\u00' + format(ord(last[0][0]), '02x') + last[0][1:] + '":' + json.dumps(last[1], separators=(',', ':')) + '}',
     'name-that-begins-alike': spell([(first[0] + 's', 1)] + m),
     'name-cut-short': spell([(first[0][:-1] or 'z', 1)] + m[1:]),
     'name-in-capitals': spell([(first[0].upper(), first[1])] + m[1:]),
     'wide-name': spell(m + [('中', 1)]).replace('\\u4e2d', '中'),
     'many-more': spell(m + [('k%d' % i, i) for i in range(70)]),
     'number-negative-zero': spell([(first[0], Raw('-0'))] + m[1:]),
     'number-fraction': spell([(first[0], Raw('1.5'))] + m[1:]),
     'number-exponent': spell([(first[0], Raw('1e3'))] + m[1:]),
     'number-too-large': spell([(first[0], Raw('1e999'))] + m[1:]),
     'number-beyond-integers': spell([(first[0], Raw('9007199254740993'))] + m[1:]),
     'number-beyond-32-bits': spell([(first[0], Raw('2147483648'))] + m[1:]),
     'number-long': spell([(first[0], Raw('123456789012345678901234567890'))] + m[1:]),
     'null': 'null', 'a-number': '7', 'a-text': '"text"', 'true': 'true', 'a-list-of-it': '[' + fits + ']', 'an-empty-list': '[]',
     'bad-comma-at-the-end': fits[:-1] + ',}',
     'bad-cut-short': fits[:-1],
     'bad-cut-in-a-name': fits[:3],
     'bad-more-behind': fits + ' x',
     'bad-twice': fits + fits,
     'bad-no-colon': fits.replace(':', ' ', 1),
     'bad-single-quotes': fits.replace('"', "'"),
     'bad-number-with-a-zero-in-front': spell([(first[0], Raw('01'))] + m[1:]),
     'bad-number-with-a-plus': spell([(first[0], Raw('+1'))] + m[1:]),
     'bad-nan': spell([(first[0], Raw('NaN'))] + m[1:]),
     'bad-undefined': spell([(first[0], Raw('undefined'))] + m[1:]),
     'bad-word-cut-short': spell([(first[0], Raw('tru'))] + m[1:]),
     'bad-comment': '/* c */' + fits,
     'bad-empty': '',
     'bad-blank': ' ',
     'bad-byte-order-mark': '\\ufeff' + fits,
     'bad-line-break-in-a-text': spell([(first[0], Raw('"a\\nb"'))] + m[1:]),
     'bad-escape': spell([(first[0], Raw('"a\\\\qb"'))] + m[1:]),
     'text-with-escapes': spell([(first[0], Raw('"\\\\u0041\\\\n\\\\"\\\\\\\\\\\\/"'))] + m[1:]),
     'text-with-a-lone-surrogate': spell([(first[0], Raw('"\\\\ud800"'))] + m[1:]),
     'text-wide': spell([(first[0], Raw('"é中"'))] + m[1:]),
    }
    return t
looks = {
 'described': ['JSON.stringify(v)', 'v === null || typeof v !== "object" ? "-" : Object.keys(v).join()', 'v === null || typeof v !== "object" ? "-" : Reflect.ownKeys(v).map(String).join()',
               'v === null || typeof v !== "object" ? "-" : Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === Array.prototype',
               'v === null || typeof v !== "object" ? "-" : JSON.stringify(Object.getOwnPropertyDescriptors(v))', 'v === null || typeof v !== "object" ? "-" : (() => { const names = []; for (const name in v) names.push(name); return names.join(); })()',
               'v === null || typeof v !== "object" ? "-" : JSON.stringify({ ...v })', 'Object.prototype.toString.call(v)'],
 'read-by-the-type': None,
 'changed-behind': ['(() => { if (v === null || typeof v !== "object") return "-"; const o = v as any; o.late = 1; const name = Object.keys(o)[0]; delete o[name]; o[name] = "again"; return JSON.stringify(o) + Object.keys(o).join(); })()'],
 'held-against-the-untyped': ['(() => { const plain = (0, JSON.parse)(text); return JSON.stringify(plain) === JSON.stringify(v) && (plain === null || typeof plain !== "object" || Object.keys(plain).join() === Object.keys(v as any).join()); })()'],
}
count = 0
def quote(text):
    return "'" + text.replace("'", "\\'") + "'"
def write(name, declarations, way, fits, text, lines):
    global count
    body = [declarations, ways[way].replace('FITS', quote(fits)),
            'function tell(f: () => unknown) { try { console.log(String(f())); } catch (error) { console.log((error as Error).name + ": " + (error as Error).message); } }',
            'const texts = [%s, %s];' % (quote(fits), quote(text)),
            'for (const text of [texts[0], texts[1], texts[1]]) {', '  tell(() => { const v = load(text); return [%s].map(String).join(" | "); });' % ', '.join('(%s)' % l for l in lines), '}']
    with open(os.path.join(out, name + '.ts'), 'w') as f:
        f.write('\n'.join(body) + '\n')
    count += 1
for kind, (declarations, fits, reads) in types.items():
    for label, text in textsOf(fits).items():
        for way in ways:
            for look, lines in looks.items():
                if way not in ('as', 'declared-result', 'untyped-beside-a-typed-one') and look != 'described':
                    continue
                typed = ['v === null || typeof v !== "object" ? "-" : (%s)' % r + '' for r in reads] + ['v === null || typeof v !== "object" ? "-" : typeof (%s)' % r for r in reads]
                write('%s-%s-%s-%s' % (kind, way, label, look), declarations, way, fits, text, lines or typed)
for kind, (declarations, element, reads) in listTypes.items():
    for label, text in textsOf(element).items():
        for place, whole in (('alone', '[%s]'), ('behind-one-that-fits', '[' + element + ',%s]'), ('in-front-of-one-that-fits', '[%s,' + element + ']')):
            for way in ('as', 'declared-result'):
                for look, lines in looks.items():
                    typed = ['v === null || typeof v !== "object" ? "-" : (%s)' % r for r in reads]
                    write('%s-%s-%s-%s-%s' % (kind, way, label, place, look), declarations, way, '[' + element + ']', whole % text, lines or typed)
print(count, 'programs')
