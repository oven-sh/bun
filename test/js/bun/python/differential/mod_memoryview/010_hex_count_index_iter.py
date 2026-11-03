def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)
class I:
    def __init__(self, v): self.v = v
    def __index__(self): return self.v
d = b'\xb9\x01\xef\x00\x7f\x80'
m = memoryview(d)
for args in ((), (':',), (b':',), (':', 1), (':', 2), (':', -2), (':', 3), (':', -4), (':', 6), (':', 7), (':', -7), (':', 0), ('_', I(2)), (':', True)):
    t(lambda: m.hex(*args)); t(lambda: m.hex(*args) == d.hex(*args)); t(lambda: m[::-1].hex(*args) == d[::-1].hex(*args)); t(lambda: m[::2].hex(*args) == d[::2].hex(*args))
for args in (('',), ('ab',), (b'',), (b'ab',), ('é',), ('€',), (b'\xff',), (1,), (None,), (':', 'a'), (':', 1.0), (':', None), (':', 2 ** 70), (':', 1, 2), (bytearray(b':'),), ([1],)):
    t(lambda: m.hex(*args))
t(lambda: m.hex(sep=':', bytes_per_sep=2)); t(lambda: m.hex(bytes_per_sep=2)); t(lambda: m.hex(x=1)); t(lambda: memoryview(b'').hex()); t(lambda: memoryview(b'').hex(':')); t(lambda: memoryview(d).cast('h').hex()); t(lambda: memoryview(d).cast('B', (2, 3)).hex(':'))
class Sep:
    def __len__(self):
        t(lambda: w.release())
        return 1
w = memoryview(b'abc')
t(lambda: w.hex(Sep()))
t(lambda: w.tobytes())

s = memoryview(b'abcabcab')
for v in (97, 98, 99, 100, 97.0, True, 'a', b'a', None, 97+0j, I(97)):
    t(lambda: s.count(v))
t(lambda: s.count()); t(lambda: s.count(1, 2)); t(lambda: s.count(value=1)); t(lambda: s[::2].count(97)); t(lambda: s[::-1].count(98)); t(lambda: memoryview(b'').count(0)); t(lambda: s.cast('c').count(b'a')); t(lambda: s.cast('c').count(97)); t(lambda: s.cast('h').count(25185)); t(lambda: memoryview(bytes(16)).cast('d').count(0)); t(lambda: memoryview(bytes(16)).cast('d').count(0.0)); t(lambda: memoryview(bytes(4)).cast('?').count(False)); t(lambda: memoryview(bytes(4)).cast('?').count(0))
for args in ((97,), (98,), (99,), (100,), (97, 1), (97, 4), (97, 7), (97, 8), (97, 100), (97, -1), (97, -2), (97, -5), (97, -100), (97, 0, 0), (97, 0, 1), (97, 1, 3), (97, 1, 4), (97, 3, -1), (97, 3, -5), (97, -5, -1), (97, 5, 2), (97.0,), (True,), ('a',), (None,), (97, I(1)), (97, I(1), I(4)), (97, 2 ** 70), (97, -2 ** 70), (97, 0, 2 ** 70), (97, 0, -2 ** 70)):
    t(lambda: s.index(*args))
for args in ((), (97, None), (97, 0, None), (97, 'a'), (97, 1.0), (97, 0, 1.0), (97, 0, 1, 2)):
    t(lambda: s.index(*args))
t(lambda: s.index(value=97)); t(lambda: s.index(97, start=1)); t(lambda: s[::2].index(99)); t(lambda: s[::-1].index(99)); t(lambda: s.cast('c').index(b'c')); t(lambda: s.cast('h').index(25185)); t(lambda: memoryview(b'').index(0))
class Eq:
    def __eq__(self, o): return o == 99
t(lambda: s.index(Eq())); t(lambda: s.count(Eq()))
class Bad:
    def __eq__(self, o): raise KeyError('eq')
t(lambda: s.index(Bad())); t(lambda: s.count(Bad())); t(lambda: Bad() in s)
class Rel:
    def __eq__(self, o):
        r.release()
        return False
r = memoryview(b'abc'); t(lambda: r.index(Rel()))
r = memoryview(b'abc'); t(lambda: r.count(Rel()))
r = memoryview(b'abc'); t(lambda: Rel() in r)

it = iter(s)
print(type(it).__name__, type(it).__module__, iter(it) is it, next(it), next(it), list(it), list(it))
t(lambda: next(it))
t(lambda: type(it)())
t(lambda: len(it))
t(lambda: it.__length_hint__())
t(lambda: it.__reduce__())
t(lambda: sorted(set(dir(it)) - set(dir(object))))
import operator
t(lambda: operator.length_hint(iter(s)))
print(list(iter(s[::3])), list(s.cast('h')), list(s.cast('c')), [x for x in s[::-1]], list(zip(s, s[1:])), list(enumerate(s[:2])), list(map(chr, s)))
a, *b, c = s
print(a, b, c)
b = bytearray(b'abc'); m = memoryview(b); it = iter(m); print(next(it)); b[1] = 120; print(next(it), next(it))
