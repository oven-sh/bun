# What a grid of borderline arguments found in the built-in types: each of these once came out otherwise than in CPython.
import array, collections, itertools, operator, struct, sys

def t(label, f):
    try:
        print(label, 'ok', repr(f()))
    except Exception as e:
        print(label, type(e).__name__, e)

class Index:
    def __init__(self, value): self.value = value
    def __index__(self):
        if isinstance(self.value, type): raise self.value('raised')
        return self.value
class StrSub(str): pass
class IntSub(int): pass
class SetSub(set): pass
class FrozensetSub(frozenset): pass

# Ints between 2 ** 53 and 2 ** 63 are indices like any other. (operator.mul: once CPython has specialized a `*` in the code for a str
# and an int, it words the OverflowError otherwise.)
for n in (2 ** 53, 2 ** 53 + 1, 2 ** 62, 2 ** 63 - 1, -2 ** 53 - 1, -2 ** 63, 2 ** 63, -2 ** 63 - 1):
    t('list[%d]' % n, lambda: [1, 2, 3][n])
    t('list[%d] = 0' % n, lambda: [1, 2, 3].__setitem__(n, 0))
    t('del list[%d]' % n, lambda: [1, 2, 3].__delitem__(n))
    t('list.pop(%d)' % n, lambda: [1, 2, 3].pop(n))
    t('list.insert(%d)' % n, lambda: (lambda l: (l.insert(n, 0), l))([1, 2, 3]))
    t('list.index(1, %d)' % n, lambda: [1, 2, 3].index(1, n))
    t('tuple.index(1, 0, %d)' % n, lambda: (1, 2, 3).index(1, 0, n))
    t('str[%d] = 0' % n, lambda: operator.setitem('abc', n, 0))
    t('del tuple[%d]' % n, lambda: operator.delitem((1, 2, 3), n))
    t('str.center(%d)' % n, lambda: 'abc'.center(n) if n < 100 or n >= 2 ** 62 else None)
    t('bytes.zfill(%d)' % n, lambda: b'abc'.zfill(n) if n < 100 or n >= 2 ** 62 else None)
    t('str * %d' % n, lambda: operator.mul('abc', n) if n < 100 or n >= 2 ** 62 else None)
    t('bytes(%d)' % n, lambda: bytes(n) if n < 100 or n >= 2 ** 62 else None)
    t('b"a" * %d' % n, lambda: operator.mul(b'a', n) if n < 100 or n >= 2 ** 62 else None)
    t('to_bytes(%d)' % n, lambda: (1).to_bytes(n) if n < 100 or n >= 2 ** 62 else None)
    t('deque[%d]' % n, lambda: collections.deque([1, 2, 3])[n])
    t('deque.__getitem__(%d)' % n, lambda: collections.deque([1, 2, 3]).__getitem__(n))
t('list.index(1, None)', lambda: [1].index(1, None))
t('tuple.index(1, None)', lambda: (1,).index(1, None))

# What is looked at first.
t('l[::0] = 1', lambda: [1, 2].__setitem__(slice(None, None, 0), 1))
t('l[::2] = 1', lambda: [1, 2].__setitem__(slice(None, None, 2), 1))
t('to_bytes', lambda: (-1).to_bytes(2 ** 63 - 1))
t('to_bytes', lambda: (1).to_bytes(1, 'x', signed=Index(ZeroDivisionError)))
t('to_bytes', lambda: (1).to_bytes(-1, 5))
t('from_bytes', lambda: int.from_bytes(5, 5))
t('from_bytes', lambda: int.from_bytes(b'a', None))
t('str', lambda: str(b'a', None))
t('str', lambda: str(b'a', encoding=None))
t('str', lambda: StrSub(b'a', None))
t('str', lambda: str(encoding='\0'))
t('bytes', lambda: bytes(errors='\0'))
t('int', lambda: int(bytearray(b'x')))
t('int', lambda: int(memoryview(b'1x'), 10) if False else int(memoryview(b'1x')))
t('int', lambda: IntSub(1, 2, 3))
t('fromhex', lambda: float.fromhex(5))
t('fromhex', lambda: float.fromhex('1\xa0'))
t('fromhex', lambda: float.fromhex(' 1\t\n\v\f\r'))

# x *= sequence: the right operand is asked only if the left one is nothing like a sequence.
for left in (2, 2.0, None, {}, {1}, 'ab', [1], object(), IntSub(2)):
    for right in ('ab', [1], (1,), b'ab'):
        t('%r *= %r' % (left if type(left) is not object else 'object', right), lambda: operator.imul(left, right))
t('array *= str', lambda: operator.imul(array.array('i', [1]), 'x'))
t('array.__imul__(str)', lambda: array.array('i', [1]).__imul__('x'))
t('deque *= str', lambda: operator.imul(collections.deque([1]), 'x'))
t('deque.__imul__(str)', lambda: collections.deque([1]).__imul__('x'))
t('deque[1.5]', lambda: collections.deque([1])[1.5])
t('deque.__getitem__(1.5)', lambda: collections.deque([1]).__getitem__(1.5))
t('del deque["a"]', lambda: operator.delitem(collections.deque([1]), 'a'))
t('deque.__setitem__("a")', lambda: collections.deque([1]).__setitem__('a', 1))

# A bound method goes by what it is bound to.
t('bool', lambda: getattr(True, 'bit_length')(0))
t('bool', lambda: True.bit_length(0))
t('list', lambda: [].__format__())
t('module', lambda: sys.__format__())
t('__init__', lambda: iter([]).__init__(1, 2, a=3))
t('__init__', lambda: {}.keys().__init__(1))
t('__init__', lambda: len.__init__(1))
t('__init__', lambda: object().__init__(1))
t('__eq__', lambda: (len.__eq__(str.upper), len.__eq__(len), (1).__add__.__eq__(len), [].append.__ne__(str.upper)))

# Complex powers go by what the C library reports.
inf, nan = float('inf'), float('nan')
for base, exponent in ((inf, 1j), (1 + 2j, inf), (2j, complex(inf, 1)), (0j, 1j), (0j, -1), (1e200 + 1e200j, 2), (1e200j, 2.5), (complex(inf, nan), 2), (1j, nan), (-inf, 0.5j)):
    t('%r ** %r' % (base, exponent), lambda: base ** exponent)

# Strs are compared by code point, also where a surrogate stands alone.
texts = ['퟿', '\ud800', '\udbff', '\udc00', '\udfff', '', '￿', '\U00010000', '\U0010ffff', '\ud800a', '\ud800', 'a\udc00', 'a\U00010000', '\U00010000\ud800', '\U00010000\U00010000']
print([ascii(x) for x in sorted(texts)])
print([ascii(x) for x in sorted(texts, reverse=True)])
print([[(a < b) - (a > b) for b in texts] for a in texts])
print(max(texts) == '\U0010ffff', min(texts) == 'a\udc00', sorted((x,) for x in texts) == [(x,) for x in sorted(texts)])

# A StopIteration out of the function of a map or a filter ends whatever goes through it.
def stop(x):
    if x == 2: raise StopIteration('stop')
    return x
t('map', lambda: list(map(stop, [1, 2, 3])))
t('filter', lambda: list(filter(stop, [1, 2, 3])))
t('map', lambda: [x for x in map(stop, [1, 2, 3])])
t('map', lambda: tuple(map(stop, [1, 2, 3])))
t('map', lambda: sum(map(stop, [1, 2, 3])))
t('map', lambda: list(zip(map(stop, [1, 2, 3]), 'abc')))
t('map', lambda: (lambda m: (list(m), list(m)))(map(stop, [1, 2, 3])))
t('next', lambda: (lambda m: (next(m), next(m)))(map(stop, [1, 2, 3])))
t('map next', lambda: list(map(next, [iter('a'), iter(''), iter('b')])))
t('starmap', lambda: list(itertools.starmap(stop, [(1,), (2,), (3,)])))

# An exception out of __index__ is not taken for another, or is, as in CPython.
t('expandtabs', lambda: 'a\tb'.expandtabs(Index(OverflowError)))
t('expandtabs', lambda: 'a\tb'.expandtabs(Index(2 ** 31)))
t('%c', lambda: '%c' % Index(TypeError))
t('%c', lambda: '%c' % Index('a'))
t('%c', lambda: '%c' % Index(ValueError))
for code in ('b', '<H', 'i', '<q', '>q', '>Q', 'N'):
    t('pack ' + code, lambda: struct.pack(code, Index(OverflowError)))
t('pack 0s', lambda: struct.pack('0s', 0))
t('pack 0s', lambda: struct.pack('0s0p', b'x', b'y'))

# Any TypeError from asking for the iterator is replaced.
class NoIterator:
    def __iter__(self): return 5
class Raises:
    def __init__(self, error): self.error = error
    def __iter__(self): raise self.error('raised')
for x in (NoIterator(), Raises(TypeError), Raises(ValueError), 5):
    t('join', lambda: ''.join(x))
    t('join', lambda: b''.join(x))
    t('l[:1] = x', lambda: [1, 2].__setitem__(slice(0, 1), x))
    t('l[::2] = x', lambda: [1, 2].__setitem__(slice(None, None, 2), x))

# Who asks how many items there will be, and what is made of the answer.
class Hint:
    def __init__(self, hint): self.hint = hint
    def __iter__(self): return iter((1, 2))
    def __length_hint__(self):
        if isinstance(self.hint, type): raise self.hint('raised')
        return self.hint
for hint in (0, 5, -1, 1.5, None, NotImplemented, 2 ** 63 - 1, 2 ** 63, TypeError, ValueError):
    for function in (list, tuple, bytes, bytearray, sorted, set, collections.deque, lambda x: [0] + [*x], lambda x: (lambda l: l.extend(x) or l)([0])):
        t('hint %r' % (hint,), lambda: function(Hint(hint)))

# The object itself comes back, of whatever class derived from str, where CPython has nothing to copy.
class Shows:
    def __str__(self): return StrSub('s')
    def __repr__(self): return StrSub('r')
    def __format__(self, spec): return StrSub('f')
s, x = StrSub('sub'), Shows()
one, first, last = (x,), (x, ''), ('', x)  # Not written in place: CPython compiles `'%s' % (x,)` as it does f'{x!s}'.
for label, f in (('format', lambda: format(s, 's')), ('format', lambda: format(s, '')), ('format', lambda: format(s, '5')), ('format', lambda: format(s, '.2')), ('f', lambda: f'{s:s}'), ('f', lambda: f'{s}'), ('f', lambda: f'{s:s}!'),
                 ('str.format', lambda: '{:s}'.format(s)), ('str.format', lambda: '{}'.format(s)), ('str.format', lambda: '{:s}{}'.format(s, '')), ('str.format', lambda: '{}{:s}'.format('', s)), ('str.format', lambda: '{0:{1}}'.format(s, 0)),
                 ('format', lambda: format(x)), ('f', lambda: f'{x}'), ('f', lambda: f'{x!r}'), ('f', lambda: f'{x!s}'), ('f', lambda: f'{x:>3}'), ('str.format', lambda: '{}'.format(x)), ('str.format', lambda: '{!r}'.format(x)), ('str.format', lambda: 'a{}'.format(x)),
                 ('%', lambda: '%s' % x), ('%', lambda: '%r' % x), ('%', lambda: '%a' % x), ('%', lambda: '%s' % one), ('%', lambda: '%5s' % x), ('%', lambda: '%.0s' % x), ('%', lambda: '%s ' % x), ('%', lambda: '%s%s' % last), ('%', lambda: '%s%s' % first),
                 ('str', lambda: str(x)), ('repr', lambda: repr(x)), ('ascii', lambda: ascii(x)), ('exception', lambda: str(ValueError(x))), ('exception', lambda: str(KeyError(x))), ('exception', lambda: str(ValueError(x, 1))),
                 ('split', lambda: s.split('longer')[0]), ('split', lambda: s.split('€')[0]), ('split', lambda: s.split('x')[0]), ('rsplit', lambda: s.rsplit('longer')[0]), ('rsplit', lambda: s.rsplit('x')[0]), ('split', lambda: s.split()[0]),
                 ('partition', lambda: s.partition('x')[0]), ('rpartition', lambda: s.rpartition('x')[2]), ('partition', lambda: s.partition('u')[0]), ('partition', lambda: 'a-b'.partition(StrSub('-'))[1]), ('iter', lambda: iter(s)), ('iter', lambda: iter('sub'))):
    print(label, type(f()).__name__, f() if not label == 'iter' else '')

# Odds and ends.
t('slice hash', lambda: (hash(slice(None)) == hash(slice(None)), hash(slice(1, 2)) != hash((1, 2, None)), hash(slice(1, 2, 3)) == hash(slice(1, 2, 3))))
t('slice hash', lambda: hash(slice([])))
for key in (None, (), (1,), (1, 2), 'k', []):
    t('move_to_end %r' % (key,), lambda: collections.OrderedDict().move_to_end(key))
    t('move_to_end %r' % (key,), lambda: collections.OrderedDict(a=1).move_to_end(key))
    t('pop %r' % (key,), lambda: collections.OrderedDict(a=1).pop(key))
for state in (2 ** 63, -2 ** 63 - 1, 1.5, Index(1), -1, 1):
    for make in (lambda: iter([1, 2, 3]), lambda: reversed([1, 2, 3]), lambda: iter((1, 2, 3)), lambda: iter('abc'), lambda: iter(bytearray(b'abc')), lambda: iter(range(3))):
        t('setstate', lambda: (lambda it: (it.__setstate__(state), list(it)))(make()))
t('revived', lambda: (lambda it: (list(it), it.__setstate__(1), list(it)))(reversed([1, 2, 3])))
t('not revived', lambda: (lambda it: (list(it), it.__setstate__(1), list(it)))(iter([1, 2, 3])))
t('set', lambda: SetSub().__init__(1, 2))
t('set', lambda: set().__init__(1, 2))
t('frozenset', lambda: FrozensetSub(1, 2))
t('frozenset', lambda: frozenset(1, 2))
t('getsizeof', lambda: sys.getsizeof(type('S', (), {'__sizeof__': lambda self: 2 ** 63})()))
t('read-only', lambda: setattr(array.array('i'), '__doc__', 1))
t('__module__', lambda: (lambda f: (f.__module__, setattr(f, '__module__', 'm'), f.__module__, delattr(f, '__module__'), f.__module__))([].append))
for args in ((True, 'm'), (1, 'm'), (1.0, 'm'), (IntSub(2), 'm'), (2 ** 70, 'm')):
    t('OSError', lambda: type(OSError(*args)).__name__)
for args in ((1, 'm', 5), (1, 'm', 5, 6), (1, 'm', 5, 6, 'f'), (1, 'm', 'f', 6, 'g'), (1, 'm', 2 ** 63), (1, 'm', 1.5), (1, 'm', None, 6, 'g')):
    t('BlockingIOError', lambda: (lambda e: (e.args, e.filename, e.filename2, getattr(e, 'characters_written', '-'), str(e)))(BlockingIOError(*args)))
for kind in (UnboundLocalError, ModuleNotFoundError, NameError, ImportError, AttributeError):
    t(kind.__name__, lambda: kind('m', nope=1))
for kind in (UnicodeEncodeError, UnicodeDecodeError, UnicodeTranslateError):
    e = kind.__new__(kind)
    t(kind.__name__, lambda: str(e))
    for value in (None, 'ab', b'ab'):
        e.object = value
        t(kind.__name__, lambda: str(e))
    t(kind.__name__, lambda: setattr(e, 'start', 2 ** 63))
t('UnicodeDecodeError', lambda: UnicodeDecodeError('u', b'ab', 2 ** 63, 1, 'r'))
e = SyntaxError('m'); e.lineno = 2 ** 63
t('SyntaxError', lambda: str(e))
