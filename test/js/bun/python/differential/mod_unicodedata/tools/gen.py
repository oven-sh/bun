#!/usr/bin/env python3
"""Generates the g_*.py tests of unicodedata in the directory above. Run it with the oracle.

The oracle has the data of Unicode 17.0.0; ours has that of the ICU it is linked with, which may be older (15.1.0 when this
was written). So the tests leave out the code points about which the two versions differ. For the properties that
Python 3.13 (Unicode 15.1.0) has, that is worked out here; CHANGED_NEW_PROPERTIES was found by comparing our output with the
oracle's, and looking at what differed.
"""
import json, os, subprocess, sys, unicodedata as u

OUT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # Where the tests go.
PY313 = '/nix/store/wzlqhfb2zkdf7mr3gp1jka25dl9glmaq-python3-3.13.15/bin/python3'
PERL = '/nix/store/w03i01kiakf4wz7jbp1l59c0bhb3pjca-perl-5.42.3/lib/perl5/5.42.3/unicore'

DUMP = """
import json, unicodedata as u
out = []
for c in range(0x110000):
    ch = chr(c)
    out.append((u.category(ch), u.combining(ch), u.mirrored(ch), u.east_asian_width(ch), u.decimal(ch, None), u.digit(ch, None),
                u.numeric(ch, None), u.normalize('NFKD', ch), u.normalize('NFC', ch), u.bidirectional(ch) if u.category(ch) != 'Cn' else None))
print(json.dumps(out))
"""

def dump(python):
    return json.loads(subprocess.run([python, '-I', '-c', DUMP], capture_output=True, text=True, check=True).stdout)

def ranges(points):
    out = []
    for c in points:
        if out and out[-1][1] == c - 1:
            out[-1][1] = c
        else:
            out.append([c, c])
    return [tuple(r) for r in out]

# Grapheme_Cluster_Break and Extended_Pictographic of characters that both versions have.
CHANGED_NEW_PROPERTIES = [(2191, 2191), (2199, 2199), (3164, 3164), (3264, 3264), (3271, 3272), (3274, 3275), (3292, 3292), (5909, 5909), (5940, 5940), (6863, 6877), (6880, 6891), (6971, 6971), (6973, 6973), (6979, 6980), (6990, 6991), (7039, 7039), (7082, 7082), (7154, 7155), (7305, 7306), (8385, 8385), (9096, 9096), (9255, 9257), (9733, 9733), (9735, 9741), (9743, 9744), (9746, 9746), (9750, 9751), (9753, 9756), (9758, 9759), (9761, 9761), (9764, 9765), (9767, 9769), (9771, 9773), (9776, 9783), (9787, 9791), (9793, 9793), (9795, 9799), (9812, 9822), (9825, 9826), (9828, 9828), (9831, 9831), (9833, 9850), (9852, 9853), (9856, 9861), (9872, 9873), (9880, 9880), (9882, 9882), (9885, 9887), (9890, 9894), (9896, 9897), (9900, 9903), (9906, 9916), (9919, 9923), (9926, 9927), (9929, 9933), (9936, 9936), (9938, 9938), (9941, 9960), (9963, 9967), (9974, 9974), (9979, 9980), (9982, 9985), (9987, 9988), (9998, 9998), (10000, 10001), (10085, 10087), (11158, 11158), (12772, 12773), (42955, 42959), (42962, 42962), (42964, 42964), (42970, 42972), (42993, 42993), (43347, 43347), (43456, 43456), (64451, 64466), (64912, 64913), (64968, 64974), (67008, 67059), (67904, 67929), (68928, 68965), (68969, 68997), (69006, 69007), (69314, 69319), (69328, 69336), (69370, 69372), (70080, 70080), (70197, 70197), (70477, 70477), (70528, 70537), (70539, 70539), (70542, 70542), (70544, 70581), (70583, 70592), (70594, 70594), (70597, 70597), (70599, 70602), (70604, 70613), (70615, 70616), (70625, 70626), (71350, 71350), (71376, 71395), (71454, 71454), (71997, 71997), (72250, 72250), (72544, 72551), (72640, 72673), (72688, 72697), (73136, 73179), (73184, 73193), (73537, 73537), (73562, 73562), (78944, 82938), (90368, 90425), (93504, 93561), (93856, 93880), (93883, 93907), (94192, 94198), (100344, 100351), (101631, 101631), (101641, 101662), (101760, 101874), (117760, 118012), (118016, 118451), (118458, 118480), (118496, 118512), (119142, 119142), (119149, 119149), (120513, 120513), (120571, 120571), (120629, 120629), (120687, 120687), (120745, 120745), (124368, 124410), (124415, 124415), (124608, 124638), (124640, 124661), (124670, 124671), (126976, 126979), (126981, 127019), (127024, 127123), (127136, 127150), (127153, 127167), (127169, 127182), (127185, 127221), (127245, 127247), (127279, 127279), (127340, 127343), (127405, 127405), (127584, 127589), (127778, 127779), (127892, 127893), (127896, 127896), (127900, 127901), (127985, 127986), (127990, 127990), (128254, 128254), (128326, 128328), (128335, 128335), (128360, 128366), (128369, 128370), (128379, 128390), (128392, 128393), (128398, 128399), (128401, 128404), (128407, 128419), (128422, 128423), (128425, 128432), (128435, 128443), (128445, 128449), (128453, 128464), (128468, 128475), (128479, 128480), (128482, 128482), (128484, 128487), (128489, 128494), (128496, 128498), (128500, 128505), (128710, 128714), (128723, 128724), (128728, 128728), (128742, 128744), (128746, 128746), (128753, 128754), (128884, 128895), (128981, 128985), (129200, 129211), (129216, 129217), (129232, 129240), (129536, 129623), (129632, 129645), (129673, 129674), (129678, 129679), (129726, 129726), (129734, 129734), (129736, 129736), (129741, 129741), (129756, 129756), (129759, 129759), (129769, 129770), (129775, 129775), (129995, 130031), (130042, 130042), (177978, 177983), (183970, 183981), (205744, 210041)]

old, new = dump(PY313), dump(sys.executable)
excluded = {c for c in range(0x110000) if old[c] != new[c]}
for a, b in CHANGED_NEW_PROPERTIES:
    excluded.update(range(a, b + 1))
EXCLUDED = ranges(sorted(excluded))
print(len(excluded), 'code points in', len(EXCLUDED), 'ranges left out', file=sys.stderr)

PRELUDE = '''# Generated by gen.py.
import unicodedata as u

# What differs between Unicode 15.1.0 and 17.0.0.
EXCLUDED = set()
for a, b in %r:
    EXCLUDED.update(range(a, b + 1))

SAMPLE = [c for c in list(range(0x3000)) + list(range(0x3000, 0x20000, 13)) + list(range(0x20000, 0x110000, 4099))
          + [0xAC00, 0xAC01, 0xD7A3, 0xD7A4, 0xD800, 0xDFFF, 0xE000, 0xF8FF, 0xFDD0, 0xFFFE, 0xFFFF, 0x1FFFE, 0xE0001, 0xE0100, 0xF0000, 0x10FFFD, 0x10FFFF]
          if c not in EXCLUDED]

def scan(name, f):
    last, start = object(), 0
    for c in SAMPLE:
        v = f(chr(c))
        if v != last:
            print(name, '%%04X' %% c, ascii(v))
            last = v

''' % (EXCLUDED,)

def emit(name, body):
    with open(os.path.join(OUT, 'g_%s.py' % name), 'w') as f:
        f.write(PRELUDE + body)

GROUPS = {
    'props1': ['category', 'bidirectional', 'combining'],
    'props2': ['mirrored', 'east_asian_width', 'decomposition'],
    'props3': ['decimal', 'digit', 'numeric'],
    'props4': ['name'],
    'props5': ['block', 'grapheme_cluster_break', 'indic_conjunct_break'],
    'props6': ['extended_pictographic', 'isxidstart', 'isxidcontinue'],
}
WITH_DEFAULT = ('decimal', 'digit', 'numeric', 'name')
for group, props in GROUPS.items():
    emit(group, ''.join("scan(%r, %s)\n" % (p, 'lambda ch: u.%s(ch, None)' % p if p in WITH_DEFAULT else 'u.' + p) for p in props))
    if group < 'props5':
        emit('old_' + group, 'o = u.ucd_3_2_0\n' + ''.join("scan(%r, %s)\n" % (p, 'lambda ch: o.%s(ch, None)' % p if p in WITH_DEFAULT else 'o.' + p) for p in props))
for form in ('NFC', 'NFD', 'NFKC', 'NFKD'):
    emit('norm_' + form.lower(), "scan(%r, lambda ch: (u.normalize(%r, ch), u.is_normalized(%r, ch)) if u.normalize(%r, ch) != ch or not u.is_normalized(%r, ch) else None)\n" % ((form,) * 5))
    emit('old_norm_' + form.lower(), "o = u.ucd_3_2_0\nscan(%r, lambda ch: (o.normalize(%r, ch), o.is_normalized(%r, ch)) if o.normalize(%r, ch) != ch or not o.is_normalized(%r, ch) else None)\n" % ((form,) * 5))

# ---- Names ----
aliases, sequences = [], []
text = open(PERL + '/Name.pl').read()
text = text[text.index("return <<'END';\n") + 16:text.index('\nEND\n')]
for entry in text.split('\n\n'):
    code, _, name = entry.partition('\n')
    points = [int(x, 16) for x in code.split()]
    if len(points) > 1 or u.name(chr(points[0]), None) != name:
        (sequences if len(points) > 1 else aliases).append(name)
emit('names', '''def look(db, name):
    try:
        return db.lookup(name)
    except KeyError as e:
        return 'KeyError: %%s' %% e

# Aliases and named sequences, and names that only Perl knows.
for name in %r:
    print(name, ascii(look(u, name)), ascii(look(u, name.lower())), ascii(look(u.ucd_3_2_0, name)))
for name in %r:
    print(name, ascii(look(u, name)), ascii(look(u.ucd_3_2_0, name)))
for c in SAMPLE[::7]:
    name = u.name(chr(c), None)
    if name is not None:
        r = (look(u, name), look(u, name.lower()), look(u, name.encode()), look(u.ucd_3_2_0, name), look(u, name + ' '), look(u, ' ' + name), look(u, name[:-1]))
        if r[:3] != (chr(c),) * 3 or not r[4].startswith('KeyError') or not r[5].startswith('KeyError'):
            print('%%04X' %% c, name, ascii(r))
        elif r[3] != chr(c) or not r[6].startswith('KeyError'):
            print('%%04X' %% c, ascii(r[3]), ascii(r[6]))
''' % (aliases, sequences))

# ---- Strings to normalize ----
tests = []
for line in open(PERL + '/TestNorm.pl', encoding='utf-8'):
    if line.startswith('Test_N(q\a'):
        source = line.split('\a')[1]
        if not excluded.intersection(map(ord, source)):
            tests.append(source)
multi = [t for t in tests if len(t) > 1]
print(len(tests), 'normalization tests,', len(multi), 'of several characters', file=sys.stderr)
for part in range(4):
    emit('normtest_%d' % part, '''for s in %s:
    r = [u.normalize(form, s) for form in ('NFC', 'NFD', 'NFKC', 'NFKD')]
    print(ascii(s), ascii(r), [u.is_normalized(form, s) for form in ('NFC', 'NFD', 'NFKC', 'NFKD')], [u.is_normalized(form, x) for form, x in zip(('NFC', 'NFD', 'NFKC', 'NFKD'), r)],
          ascii([u.ucd_3_2_0.normalize(form, s) for form in ('NFC', 'NFKD')]))
''' % ascii(multi[part::16]))

# ---- Grapheme clusters ----
interesting = {}
for c in range(0x110000):
    if c in excluded:
        continue
    ch = chr(c)
    key = (u.grapheme_cluster_break(ch), u.indic_conjunct_break(ch), u.extended_pictographic(ch))
    interesting.setdefault(key, [])
    if len(interesting[key]) < 3:
        interesting[key].append(c)
alphabet = sorted(c for v in interesting.values() for c in v)
emit('graphemes', '''ALPHABET = %r
state = 12345
def rnd(n):
    global state
    state = (state * 1103515245 + 12345) %% 2 ** 31
    return (state >> 8) %% n
for i in range(1500):
    s = ''.join(chr(ALPHABET[rnd(len(ALPHABET))]) for j in range(rnd(9)))
    segments = list(u.iter_graphemes(s))
    assert ''.join(map(str, segments)) == s
    print(ascii(s), [(g.start, g.end) for g in segments], [(g.start, g.end) for g in u.iter_graphemes(s, 1, len(s) - 1)])
''' % (alphabet,))
