# What hash() gives for a given PYTHONHASHSEED, and the order of sets that follows from it.
import os, subprocess, sys

CHILD = r'''
import sys, datetime, re, fractions, decimal
print(sys.flags.hash_randomization, sys.hash_info)
wide = '€abc\xe9'
astral = '\U0001f600abc€\xe9'
strs = ['', 'a', 'b', 'ab', 'abc', 'abcd', 'abcdefg', 'abcdefgh', 'abcdefghi', 'x' * 15, 'x' * 16, 'x' * 17, 'x' * 63, 'x' * 64, 'x' * 65, 'x' * 1000, 'hello world',
        '\xe9', 'caf\xe9', '\xff' * 9, 'Ā', '€', 'a€', '€' * 3, '€' * 4, '€' * 5, '€' * 100, '￿', '\U00010000', '\U0001f600', 'a\U0001f600', '\U0001f600' * 2, '\U0001f600' * 3,
        '\U0010ffff', 'a\U0001f600b€c', '\ud800', '\udc00', 'a\udc80b', '\ud800a', '\udc00\ud800', '\0', '\0' * 8, 'a\0b',
        # The same text however it came about: cut out of a text with wider characters, joined, decoded, formatted.
        wide[1:4], wide[1:], wide[4:], astral[1:4], astral[1:5], astral[4:], astral[5:], ''.join(['a', 'b', 'c']), b'abc'.decode(), '%s%s' % ('ab', 'c'), 'ABC'.lower(), str(b'abc', 'utf-16-le' if False else 'ascii'),
        b'a\x00b\x00c\x00'.decode('utf-16-le'), b'\xac\x20'.decode('utf-16-le'), 'abc€'.replace('€', ''), ('x' * 100 + '€')[:100], ('x' * 100 + '\U0001f600')[:100], ('€' * 100 + '\U0001f600')[:100]]
for s in strs:
    print(ascii(s)[:40], len(s), hash(s), hash(s) == hash(s + ''), s.__hash__() == hash(s))
class S(str): pass
print(hash(S('abc')) == hash('abc'), hash(S('€')) == hash('€'))
for b in [b'', b'a', b'abc', b'abcdefg', b'abcdefgh', b'abcdefghi', bytes(range(256)), b'x' * 1000, b'\0', b'\xff' * 17]:
    print(b[:20], len(b), hash(b), hash(memoryview(b)) == hash(b), hash(bytes(bytearray(b))) == hash(b))
print(hash('abc') == hash(b'abc'), hash('\xe9') == hash(b'\xe9'), hash('€') == hash('€'.encode('utf-16-le')), hash('\U0001f600') == hash('\U0001f600'.encode('utf-32-le')))
for v in [('a',), ('a', 'b'), ('a', ('b', 'c')), ('abc', 1, 2.5, None), (b'a', 'a'), frozenset(['a']), frozenset(['a', 'b', 'c']), frozenset([('a', 'b'), 'c', 1]), (frozenset(['x', 'y']), 'z')]:
    print(sorted(map(repr, v)) if isinstance(v, frozenset) else v, hash(v))
words = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'omicron', 'pi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega']
print(list(set(words)))
print(list(frozenset(words[:7])))
print(list(set(w + str(i) for w in words for i in range(20)))[:60])
print(list({w.encode() for w in words}))
print(list({(w, len(w)) for w in words}))
s = set(words)
for w in words[::2]: s.discard(w)
for w in words[:5]: s.add(w * 2)
print(list(s), s.pop(), s.pop())
print(list(set(words) & set(words[5:15])), list(set(words[:10]) | set(words[5:15])), list(set(words[:10]) ^ set(words[5:15])), list(set(words) - set(words[::3])))
print(list(set('the quick brown fox jumps over the lazy dog')))
print(list(dict.fromkeys(set(words))), sorted(set(words)) == sorted(words))
D = datetime
for v in [D.date(1066, 10, 14), D.date(1, 1, 1), D.date(9999, 12, 31), D.time(1, 2, 3, 4), D.time(0), D.time(1, 2, 3, 4, fold=1), D.datetime(1, 2, 3, 4, 5, 6, 7), D.datetime(2024, 2, 29), D.datetime(2024, 2, 29, fold=1),
          D.timedelta(0), D.timedelta(1, 2, 3), D.timedelta(-1), D.timedelta(-1, 5), D.timedelta.max, D.timedelta.min, D.timezone.utc, D.timezone(D.timedelta(hours=-5)),
          D.datetime(2024, 2, 29, 12, tzinfo=D.timezone.utc), D.datetime(2024, 2, 29, 12, tzinfo=D.timezone(D.timedelta(hours=5, minutes=30))), D.datetime(1, 1, 1, tzinfo=D.timezone(D.timedelta(hours=10))),
          D.time(12, tzinfo=D.timezone.utc), D.time(1, tzinfo=D.timezone(D.timedelta(hours=5))), D.time(23, 0, 0, 5, tzinfo=D.timezone(D.timedelta(hours=-5, microseconds=7)))]:
    print(repr(v), hash(v))
print(list({D.date(2020, 1, d) for d in range(1, 20)}))
for v in [None, (), 0, 1, -1, -2, 2**61 - 1, 2**61, 2**64, -2**64, 10**30, 1.0, 1.5, -1.5, 0.1, 1e300, float('inf'), float('-inf'), 1j, 1 + 2j, -1j, True, False,
          fractions.Fraction(1, 3), fractions.Fraction(3, 1), fractions.Fraction(-7, 2**61 - 1), decimal.Decimal('1.5'), decimal.Decimal('1e100'), decimal.Decimal('-0.1'), decimal.Decimal('inf'), range(10), range(0), range(1, 10, 3), slice(1, 2, 3)]:
    print(repr(v), hash(v))
print(hash(1) == hash(1.0) == hash(fractions.Fraction(1)) == hash(decimal.Decimal(1)) == hash(1 + 0j) == hash(True))
print(hash(1.5) == hash(fractions.Fraction(3, 2)) == hash(decimal.Decimal('1.5')) == hash(1.5 + 0j))
print(hash(re.compile('a+b')) == hash(re.compile('a+b')), hash(re.compile('a+b')), hash(re.compile(b'a+b', re.I)))
'''

def run(seed, *options):
    env = {k: v for k, v in os.environ.items() if k != 'PYTHONHASHSEED'}
    if seed is not None:
        env['PYTHONHASHSEED'] = seed
    return subprocess.run([sys.executable, *options, '-c', CHILD], env=env, capture_output=True, text=True)

for seed in ['0', '1', '42', '123456789', '4294967295']:
    p = run(seed)
    print('=== PYTHONHASHSEED', seed, 'status', p.returncode)
    print(p.stdout, end='')
    print(p.stderr[-300:], end='')

SHORT = "import sys; print(sys.flags.hash_randomization, hash('abc'), hash(b'abc'), list({'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'}))"
def short(seed, *options):
    env = {k: v for k, v in os.environ.items() if k != 'PYTHONHASHSEED'}
    if seed is not None:
        env['PYTHONHASHSEED'] = seed
    p = subprocess.run([sys.executable, *options, '-c', SHORT], env=env, capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr
print('=== random')
for seed, options in [(None, ()), ('random', ()), ('0', ('-R',)), ('5', ('-R',)), ('0', ('-E',)), ('0', ('-I',)), ('', ())]:
    a, b = short(seed, *options), short(seed, *options)
    print(seed, options, a[0], b[0], a[1].split()[0], 'same' if a[1] == b[1] else 'different', a[2][-200:])
print('=== fixed')
for seed, options in [('0', ()), ('00', ()), ('+1', ()), (' 1', ()), ('1', ()), ('01', ()), ('1', ('-B',))]:
    a, b = short(seed, *options), short(seed, *options)
    print(repr(seed), options, a[0], a[1].strip(), 'same' if a[1] == b[1] else 'different', a[2][-200:])
print('=== mistakes')
for seed in ['-1', '4294967296', 'x', '1x', '1.0', '0x10', 'Random', '99999999999999999999999', '1 ']:
    a = short(seed)
    print(repr(seed), a[0], a[1], a[2].strip().splitlines()[:3])
