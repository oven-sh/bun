# What a grid of borderline arguments found in the built-in types: each of these once came out otherwise than in CPython.
try: import array, collections, itertools, operator, struct, sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import array, collections, itertools, operator, struct, sys')

try:
    def t(label, f):
        try:
            print(label, 'ok', repr(f()))
        except Exception as e:
            print(label, type(e).__name__, e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(label, f):')

try:
    class Index:
        def __init__(self, value): self.value = value
        def __index__(self):
            if isinstance(self.value, type): raise self.value('raised')
            return self.value
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Index:')
try:
    class StrSub(str): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class StrSub(str): pass')
try:
    class IntSub(int): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class IntSub(int): pass')
try:
    class SetSub(set): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class SetSub(set): pass')
try:
    class FrozensetSub(frozenset): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class FrozensetSub(frozenset): pass')

# Ints between 2 ** 53 and 2 ** 63 are indices like any other. (operator.mul: once CPython has specialized a `*` in the code for a str
# and an int, it words the OverflowError otherwise.)
try:
    for n in (2 ** 53, 2 ** 53 + 1, 2 ** 62, 2 ** 63 - 1, -2 ** 53 - 1, -2 ** 63, 2 ** 63, -2 ** 63 - 1):
        try: t('list[%d]' % n, lambda: [1, 2, 3][n])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('list[%d]' % n, lambda: [1, 2, 3][n])")
        try: t('list[%d] = 0' % n, lambda: [1, 2, 3].__setitem__(n, 0))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('list[%d] = 0' % n, lambda: [1, 2, 3].__setitem__(n, 0))")
        try: t('del list[%d]' % n, lambda: [1, 2, 3].__delitem__(n))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('del list[%d]' % n, lambda: [1, 2, 3].__delitem__(n))")
        try: t('list.pop(%d)' % n, lambda: [1, 2, 3].pop(n))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('list.pop(%d)' % n, lambda: [1, 2, 3].pop(n))")
        try: t('list.insert(%d)' % n, lambda: (lambda l: (l.insert(n, 0), l))([1, 2, 3]))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('list.insert(%d)' % n, lambda: (lambda l: (l.insert(n, 0), l))([1, ...")
        try: t('list.index(1, %d)' % n, lambda: [1, 2, 3].index(1, n))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('list.index(1, %d)' % n, lambda: [1, 2, 3].index(1, n))")
        try: t('tuple.index(1, 0, %d)' % n, lambda: (1, 2, 3).index(1, 0, n))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('tuple.index(1, 0, %d)' % n, lambda: (1, 2, 3).index(1, 0, n))")
        try: t('str[%d] = 0' % n, lambda: operator.setitem('abc', n, 0))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('str[%d] = 0' % n, lambda: operator.setitem('abc', n, 0))")
        try: t('del tuple[%d]' % n, lambda: operator.delitem((1, 2, 3), n))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('del tuple[%d]' % n, lambda: operator.delitem((1, 2, 3), n))")
        try: t('str.center(%d)' % n, lambda: 'abc'.center(n) if n < 100 or n >= 2 ** 62 else None)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('str.center(%d)' % n, lambda: 'abc'.center(n) if n < 100 or n >= 2 ...")
        try: t('bytes.zfill(%d)' % n, lambda: b'abc'.zfill(n) if n < 100 or n >= 2 ** 62 else None)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('bytes.zfill(%d)' % n, lambda: b'abc'.zfill(n) if n < 100 or n >= 2...")
        try: t('str * %d' % n, lambda: operator.mul('abc', n) if n < 100 or n >= 2 ** 62 else None)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('str * %d' % n, lambda: operator.mul('abc', n) if n < 100 or n >= 2...")
        try: t('bytes(%d)' % n, lambda: bytes(n) if n < 100 or n >= 2 ** 62 else None)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('bytes(%d)' % n, lambda: bytes(n) if n < 100 or n >= 2 ** 62 else N...")
        try: t('b"a" * %d' % n, lambda: operator.mul(b'a', n) if n < 100 or n >= 2 ** 62 else None)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(\'b"a" * %d\' % n, lambda: operator.mul(b\'a\', n) if n < 100 or n >= 2...')
        try: t('to_bytes(%d)' % n, lambda: (1).to_bytes(n) if n < 100 or n >= 2 ** 62 else None)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('to_bytes(%d)' % n, lambda: (1).to_bytes(n) if n < 100 or n >= 2 **...")
        try: t('deque[%d]' % n, lambda: collections.deque([1, 2, 3])[n])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('deque[%d]' % n, lambda: collections.deque([1, 2, 3])[n])")
        try: t('deque.__getitem__(%d)' % n, lambda: collections.deque([1, 2, 3]).__getitem__(n))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('deque.__getitem__(%d)' % n, lambda: collections.deque([1, 2, 3])._...")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for n in (2 ** 53, 2 ** 53 + 1, 2 ** 62, 2 ** 63 - 1, -2 ** 53 - 1, -...')
try: t('list.index(1, None)', lambda: [1].index(1, None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('list.index(1, None)', lambda: [1].index(1, None))")
try: t('tuple.index(1, None)', lambda: (1,).index(1, None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('tuple.index(1, None)', lambda: (1,).index(1, None))")

# What is looked at first.
try: t('l[::0] = 1', lambda: [1, 2].__setitem__(slice(None, None, 0), 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('l[::0] = 1', lambda: [1, 2].__setitem__(slice(None, None, 0), 1))")
try: t('l[::2] = 1', lambda: [1, 2].__setitem__(slice(None, None, 2), 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('l[::2] = 1', lambda: [1, 2].__setitem__(slice(None, None, 2), 1))")
try: t('to_bytes', lambda: (-1).to_bytes(2 ** 63 - 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('to_bytes', lambda: (-1).to_bytes(2 ** 63 - 1))")
try: t('to_bytes', lambda: (1).to_bytes(1, 'x', signed=Index(ZeroDivisionError)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('to_bytes', lambda: (1).to_bytes(1, 'x', signed=Index(ZeroDivisionE...")
try: t('to_bytes', lambda: (1).to_bytes(-1, 5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('to_bytes', lambda: (1).to_bytes(-1, 5))")
try: t('from_bytes', lambda: int.from_bytes(5, 5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('from_bytes', lambda: int.from_bytes(5, 5))")
try: t('from_bytes', lambda: int.from_bytes(b'a', None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('from_bytes', lambda: int.from_bytes(b'a', None))")
try: t('str', lambda: str(b'a', None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('str', lambda: str(b'a', None))")
try: t('str', lambda: str(b'a', encoding=None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('str', lambda: str(b'a', encoding=None))")
try: t('str', lambda: StrSub(b'a', None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('str', lambda: StrSub(b'a', None))")
try: t('str', lambda: str(encoding='\0'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('str', lambda: str(encoding='\\0'))")
try: t('bytes', lambda: bytes(errors='\0'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('bytes', lambda: bytes(errors='\\0'))")
try: t('int', lambda: int(bytearray(b'x')))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('int', lambda: int(bytearray(b'x')))")
try: t('int', lambda: int(memoryview(b'1x'), 10) if False else int(memoryview(b'1x')))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('int', lambda: int(memoryview(b'1x'), 10) if False else int(memoryv...")
try: t('int', lambda: IntSub(1, 2, 3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('int', lambda: IntSub(1, 2, 3))")
try: t('fromhex', lambda: float.fromhex(5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('fromhex', lambda: float.fromhex(5))")
try: t('fromhex', lambda: float.fromhex('1\xa0'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('fromhex', lambda: float.fromhex('1\\xa0'))")
try: t('fromhex', lambda: float.fromhex(' 1\t\n\v\f\r'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('fromhex', lambda: float.fromhex(' 1\\t\\n\\v\\f\\r'))")

# x *= sequence: the right operand is asked only if the left one is nothing like a sequence.
try:
    for left in (2, 2.0, None, {}, {1}, 'ab', [1], object(), IntSub(2)):
        for right in ('ab', [1], (1,), b'ab'):
            try: t('%r *= %r' % (left if type(left) is not object else 'object', right), lambda: operator.imul(left, right))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('%r *= %r' % (left if type(left) is not object else 'object', right...")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for left in (2, 2.0, None, {}, {1}, 'ab', [1], object(), IntSub(2)):")
try: t('array *= str', lambda: operator.imul(array.array('i', [1]), 'x'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('array *= str', lambda: operator.imul(array.array('i', [1]), 'x'))")
try: t('array.__imul__(str)', lambda: array.array('i', [1]).__imul__('x'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('array.__imul__(str)', lambda: array.array('i', [1]).__imul__('x'))")
try: t('deque *= str', lambda: operator.imul(collections.deque([1]), 'x'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('deque *= str', lambda: operator.imul(collections.deque([1]), 'x'))")
try: t('deque.__imul__(str)', lambda: collections.deque([1]).__imul__('x'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('deque.__imul__(str)', lambda: collections.deque([1]).__imul__('x'))")
try: t('deque[1.5]', lambda: collections.deque([1])[1.5])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('deque[1.5]', lambda: collections.deque([1])[1.5])")
try: t('deque.__getitem__(1.5)', lambda: collections.deque([1]).__getitem__(1.5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('deque.__getitem__(1.5)', lambda: collections.deque([1]).__getitem_...")
try: t('del deque["a"]', lambda: operator.delitem(collections.deque([1]), 'a'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(\'del deque["a"]\', lambda: operator.delitem(collections.deque([1]), ...')
try: t('deque.__setitem__("a")', lambda: collections.deque([1]).__setitem__('a', 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(\'deque.__setitem__("a")\', lambda: collections.deque([1]).__setitem_...')

# A bound method goes by what it is bound to.
try: t('bool', lambda: getattr(True, 'bit_length')(0))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('bool', lambda: getattr(True, 'bit_length')(0))")
try: t('bool', lambda: True.bit_length(0))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('bool', lambda: True.bit_length(0))")
try: t('list', lambda: [].__format__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('list', lambda: [].__format__())")
try: t('module', lambda: sys.__format__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('module', lambda: sys.__format__())")
try: t('__init__', lambda: iter([]).__init__(1, 2, a=3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('__init__', lambda: iter([]).__init__(1, 2, a=3))")
try: t('__init__', lambda: {}.keys().__init__(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('__init__', lambda: {}.keys().__init__(1))")
try: t('__init__', lambda: len.__init__(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('__init__', lambda: len.__init__(1))")
try: t('__init__', lambda: object().__init__(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('__init__', lambda: object().__init__(1))")
try: t('__eq__', lambda: (len.__eq__(str.upper), len.__eq__(len), (1).__add__.__eq__(len), [].append.__ne__(str.upper)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('__eq__', lambda: (len.__eq__(str.upper), len.__eq__(len), (1).__ad...")

# Complex powers go by what the C library reports.
try: inf, nan = float('inf'), float('nan')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: inf, nan = float('inf'), float('nan')")
try:
    for base, exponent in ((inf, 1j), (1 + 2j, inf), (2j, complex(inf, 1)), (0j, 1j), (0j, -1), (1e200 + 1e200j, 2), (1e200j, 2.5), (complex(inf, nan), 2), (1j, nan), (-inf, 0.5j)):
        try: t('%r ** %r' % (base, exponent), lambda: base ** exponent)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('%r ** %r' % (base, exponent), lambda: base ** exponent)")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for base, exponent in ((inf, 1j), (1 + 2j, inf), (2j, complex(inf, 1)...')

# Strs are compared by code point, also where a surrogate stands alone.
try: texts = ['퟿', '\ud800', '\udbff', '\udc00', '\udfff', '', '￿', '\U00010000', '\U0010ffff', '\ud800a', '\ud800', 'a\udc00', 'a\U00010000', '\U00010000\ud800', '\U00010000\U00010000']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: texts = ['\ud7ff', '\\ud800', '\\udbff', '\\udc00', '\\udfff', '\ue000', '\uffff', '\\U00...")
try: print([ascii(x) for x in sorted(texts)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [ascii(x) for x in sorted(texts)]')
try: print([ascii(x) for x in sorted(texts, reverse=True)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [ascii(x) for x in sorted(texts, reverse=True)]')
try: print([[(a < b) - (a > b) for b in texts] for a in texts])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [[(a < b) - (a > b) for b in texts] for a in texts]')
try: print("max(texts) == '\\U0010ffff' =>", max(texts) == '\U0010ffff')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: max(texts) == '\\U0010ffff'")
try: print("min(texts) == 'a\\udc00' =>", min(texts) == 'a\udc00')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: min(texts) == 'a\\udc00'")
try: print('sorted((x,) for x in texts) == [(x,) for x in sorted(texts)] =>', sorted((x,) for x in texts) == [(x,) for x in sorted(texts)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted((x,) for x in texts) == [(x,) for x in sorted(texts)]')

# A StopIteration out of the function of a map or a filter ends whatever goes through it.
try:
    def stop(x):
        if x == 2: raise StopIteration('stop')
        return x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def stop(x):')
try: t('map', lambda: list(map(stop, [1, 2, 3])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('map', lambda: list(map(stop, [1, 2, 3])))")
try: t('filter', lambda: list(filter(stop, [1, 2, 3])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('filter', lambda: list(filter(stop, [1, 2, 3])))")
try: t('map', lambda: [x for x in map(stop, [1, 2, 3])])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('map', lambda: [x for x in map(stop, [1, 2, 3])])")
try: t('map', lambda: tuple(map(stop, [1, 2, 3])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('map', lambda: tuple(map(stop, [1, 2, 3])))")
try: t('map', lambda: sum(map(stop, [1, 2, 3])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('map', lambda: sum(map(stop, [1, 2, 3])))")
try: t('map', lambda: list(zip(map(stop, [1, 2, 3]), 'abc')))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('map', lambda: list(zip(map(stop, [1, 2, 3]), 'abc')))")
try: t('map', lambda: (lambda m: (list(m), list(m)))(map(stop, [1, 2, 3])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('map', lambda: (lambda m: (list(m), list(m)))(map(stop, [1, 2, 3])))")
try: t('next', lambda: (lambda m: (next(m), next(m)))(map(stop, [1, 2, 3])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('next', lambda: (lambda m: (next(m), next(m)))(map(stop, [1, 2, 3])))")
try: t('map next', lambda: list(map(next, [iter('a'), iter(''), iter('b')])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('map next', lambda: list(map(next, [iter('a'), iter(''), iter('b')])))")
try: t('starmap', lambda: list(itertools.starmap(stop, [(1,), (2,), (3,)])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('starmap', lambda: list(itertools.starmap(stop, [(1,), (2,), (3,)])))")

# An exception out of __index__ is not taken for another, or is, as in CPython.
try: t('expandtabs', lambda: 'a\tb'.expandtabs(Index(OverflowError)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('expandtabs', lambda: 'a\\tb'.expandtabs(Index(OverflowError)))")
try: t('expandtabs', lambda: 'a\tb'.expandtabs(Index(2 ** 31)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('expandtabs', lambda: 'a\\tb'.expandtabs(Index(2 ** 31)))")
try: t('%c', lambda: '%c' % Index(TypeError))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('%c', lambda: '%c' % Index(TypeError))")
try: t('%c', lambda: '%c' % Index('a'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('%c', lambda: '%c' % Index('a'))")
try: t('%c', lambda: '%c' % Index(ValueError))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('%c', lambda: '%c' % Index(ValueError))")
try:
    for code in ('b', '<H', 'i', '<q', '>q', '>Q', 'N'):
        try: t('pack ' + code, lambda: struct.pack(code, Index(OverflowError)))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('pack ' + code, lambda: struct.pack(code, Index(OverflowError)))")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for code in ('b', '<H', 'i', '<q', '>q', '>Q', 'N'):")
try: t('pack 0s', lambda: struct.pack('0s', 0))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('pack 0s', lambda: struct.pack('0s', 0))")
try: t('pack 0s', lambda: struct.pack('0s0p', b'x', b'y'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('pack 0s', lambda: struct.pack('0s0p', b'x', b'y'))")

# Any TypeError from asking for the iterator is replaced.
try:
    class NoIterator:
        def __iter__(self): return 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NoIterator:')
try:
    class Raises:
        def __init__(self, error): self.error = error
        def __iter__(self): raise self.error('raised')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Raises:')
try:
    for x in (NoIterator(), Raises(TypeError), Raises(ValueError), 5):
        try: t('join', lambda: ''.join(x))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('join', lambda: ''.join(x))")
        try: t('join', lambda: b''.join(x))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('join', lambda: b''.join(x))")
        try: t('l[:1] = x', lambda: [1, 2].__setitem__(slice(0, 1), x))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('l[:1] = x', lambda: [1, 2].__setitem__(slice(0, 1), x))")
        try: t('l[::2] = x', lambda: [1, 2].__setitem__(slice(None, None, 2), x))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('l[::2] = x', lambda: [1, 2].__setitem__(slice(None, None, 2), x))")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for x in (NoIterator(), Raises(TypeError), Raises(ValueError), 5):')

# Who asks how many items there will be, and what is made of the answer.
try:
    class Hint:
        def __init__(self, hint): self.hint = hint
        def __iter__(self): return iter((1, 2))
        def __length_hint__(self):
            if isinstance(self.hint, type): raise self.hint('raised')
            return self.hint
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Hint:')
try:
    for hint in (0, 5, -1, 1.5, None, NotImplemented, 2 ** 63 - 1, 2 ** 63, TypeError, ValueError):
        for function in (list, tuple, bytes, bytearray, sorted, set, collections.deque, lambda x: [0] + [*x], lambda x: (lambda l: l.extend(x) or l)([0])):
            try: t('hint %r' % (hint,), lambda: function(Hint(hint)))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('hint %r' % (hint,), lambda: function(Hint(hint)))")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for hint in (0, 5, -1, 1.5, None, NotImplemented, 2 ** 63 - 1, 2 ** 6...')

# The object itself comes back, of whatever class derived from str, where CPython has nothing to copy.
try:
    class Shows:
        def __str__(self): return StrSub('s')
        def __repr__(self): return StrSub('r')
        def __format__(self, spec): return StrSub('f')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Shows:')
try: s, x = StrSub('sub'), Shows()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: s, x = StrSub('sub'), Shows()")
try: one, first, last = (x,), (x, ''), ('', x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: one, first, last = (x,), (x, ''), ('', x)")
try:
    for label, f in (('format', lambda: format(s, 's')), ('format', lambda: format(s, '')), ('format', lambda: format(s, '5')), ('format', lambda: format(s, '.2')), ('f', lambda: f'{s:s}'), ('f', lambda: f'{s}'), ('f', lambda: f'{s:s}!'),
                     ('str.format', lambda: '{:s}'.format(s)), ('str.format', lambda: '{}'.format(s)), ('str.format', lambda: '{:s}{}'.format(s, '')), ('str.format', lambda: '{}{:s}'.format('', s)), ('str.format', lambda: '{0:{1}}'.format(s, 0)),
                     ('format', lambda: format(x)), ('f', lambda: f'{x}'), ('f', lambda: f'{x!r}'), ('f', lambda: f'{x!s}'), ('f', lambda: f'{x:>3}'), ('str.format', lambda: '{}'.format(x)), ('str.format', lambda: '{!r}'.format(x)), ('str.format', lambda: 'a{}'.format(x)),
                     ('%', lambda: '%s' % x), ('%', lambda: '%r' % x), ('%', lambda: '%a' % x), ('%', lambda: '%s' % one), ('%', lambda: '%5s' % x), ('%', lambda: '%.0s' % x), ('%', lambda: '%s ' % x), ('%', lambda: '%s%s' % last), ('%', lambda: '%s%s' % first),
                     ('str', lambda: str(x)), ('repr', lambda: repr(x)), ('ascii', lambda: ascii(x)), ('exception', lambda: str(ValueError(x))), ('exception', lambda: str(KeyError(x))), ('exception', lambda: str(ValueError(x, 1))),
                     ('split', lambda: s.split('longer')[0]), ('split', lambda: s.split('€')[0]), ('split', lambda: s.split('x')[0]), ('rsplit', lambda: s.rsplit('longer')[0]), ('rsplit', lambda: s.rsplit('x')[0]), ('split', lambda: s.split()[0]),
                     ('partition', lambda: s.partition('x')[0]), ('rpartition', lambda: s.rpartition('x')[2]), ('partition', lambda: s.partition('u')[0]), ('partition', lambda: 'a-b'.partition(StrSub('-'))[1]), ('iter', lambda: iter(s)), ('iter', lambda: iter('sub'))):
        try: print('label [' + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', label)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: label')
        try: print('type(f()).__name__ [' + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', type(f()).__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(f()).__name__')
        try: print("f() if not label == 'iter' else '' [" + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', f() if not label == 'iter' else '')
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: f() if not label == 'iter' else ''")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for label, f in (('format', lambda: format(s, 's')), ('format', lambd...")

# Odds and ends.
try: t('slice hash', lambda: (hash(slice(None)) == hash(slice(None)), hash(slice(1, 2)) != hash((1, 2, None)), hash(slice(1, 2, 3)) == hash(slice(1, 2, 3))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('slice hash', lambda: (hash(slice(None)) == hash(slice(None)), hash...")
try: t('slice hash', lambda: hash(slice([])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('slice hash', lambda: hash(slice([])))")
try:
    for key in (None, (), (1,), (1, 2), 'k', []):
        try: t('move_to_end %r' % (key,), lambda: collections.OrderedDict().move_to_end(key))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('move_to_end %r' % (key,), lambda: collections.OrderedDict().move_t...")
        try: t('move_to_end %r' % (key,), lambda: collections.OrderedDict(a=1).move_to_end(key))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('move_to_end %r' % (key,), lambda: collections.OrderedDict(a=1).mov...")
        try: t('pop %r' % (key,), lambda: collections.OrderedDict(a=1).pop(key))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('pop %r' % (key,), lambda: collections.OrderedDict(a=1).pop(key))")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for key in (None, (), (1,), (1, 2), 'k', []):")
try:
    for state in (2 ** 63, -2 ** 63 - 1, 1.5, Index(1), -1, 1):
        for make in (lambda: iter([1, 2, 3]), lambda: reversed([1, 2, 3]), lambda: iter((1, 2, 3)), lambda: iter('abc'), lambda: iter(bytearray(b'abc')), lambda: iter(range(3))):
            try: t('setstate', lambda: (lambda it: (it.__setstate__(state), list(it)))(make()))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('setstate', lambda: (lambda it: (it.__setstate__(state), list(it)))...")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for state in (2 ** 63, -2 ** 63 - 1, 1.5, Index(1), -1, 1):')
try: t('revived', lambda: (lambda it: (list(it), it.__setstate__(1), list(it)))(reversed([1, 2, 3])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('revived', lambda: (lambda it: (list(it), it.__setstate__(1), list(...")
try: t('not revived', lambda: (lambda it: (list(it), it.__setstate__(1), list(it)))(iter([1, 2, 3])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('not revived', lambda: (lambda it: (list(it), it.__setstate__(1), l...")
try: t('set', lambda: SetSub().__init__(1, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('set', lambda: SetSub().__init__(1, 2))")
try: t('set', lambda: set().__init__(1, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('set', lambda: set().__init__(1, 2))")
try: t('frozenset', lambda: FrozensetSub(1, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('frozenset', lambda: FrozensetSub(1, 2))")
try: t('frozenset', lambda: frozenset(1, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('frozenset', lambda: frozenset(1, 2))")
try: t('getsizeof', lambda: sys.getsizeof(type('S', (), {'__sizeof__': lambda self: 2 ** 63})()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('getsizeof', lambda: sys.getsizeof(type('S', (), {'__sizeof__': lam...")
try: t('read-only', lambda: setattr(array.array('i'), '__doc__', 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('read-only', lambda: setattr(array.array('i'), '__doc__', 1))")
try: t('__module__', lambda: (lambda f: (f.__module__, setattr(f, '__module__', 'm'), f.__module__, delattr(f, '__module__'), f.__module__))([].append))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('__module__', lambda: (lambda f: (f.__module__, setattr(f, '__modul...")
try:
    for args in ((True, 'm'), (1, 'm'), (1.0, 'm'), (IntSub(2), 'm'), (2 ** 70, 'm')):
        try: t('OSError', lambda: type(OSError(*args)).__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('OSError', lambda: type(OSError(*args)).__name__)")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for args in ((True, 'm'), (1, 'm'), (1.0, 'm'), (IntSub(2), 'm'), (2 ...")
try:
    for args in ((1, 'm', 5), (1, 'm', 5, 6), (1, 'm', 5, 6, 'f'), (1, 'm', 'f', 6, 'g'), (1, 'm', 2 ** 63), (1, 'm', 1.5), (1, 'm', None, 6, 'g')):
        try: t('BlockingIOError', lambda: (lambda e: (e.args, e.filename, e.filename2, getattr(e, 'characters_written', '-'), str(e)))(BlockingIOError(*args)))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('BlockingIOError', lambda: (lambda e: (e.args, e.filename, e.filena...")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for args in ((1, 'm', 5), (1, 'm', 5, 6), (1, 'm', 5, 6, 'f'), (1, 'm...")
try:
    for kind in (UnboundLocalError, ModuleNotFoundError, NameError, ImportError, AttributeError):
        try: t(kind.__name__, lambda: kind('m', nope=1))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t(kind.__name__, lambda: kind('m', nope=1))")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for kind in (UnboundLocalError, ModuleNotFoundError, NameError, Impor...')
try:
    for kind in (UnicodeEncodeError, UnicodeDecodeError, UnicodeTranslateError):
        try: e = kind.__new__(kind)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e = kind.__new__(kind)')
        try: t(kind.__name__, lambda: str(e))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(kind.__name__, lambda: str(e))')
        for value in (None, 'ab', b'ab'):
            try: e.object = value
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.object = value')
            try: t(kind.__name__, lambda: str(e))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(kind.__name__, lambda: str(e))')
        try: t(kind.__name__, lambda: setattr(e, 'start', 2 ** 63))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t(kind.__name__, lambda: setattr(e, 'start', 2 ** 63))")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for kind in (UnicodeEncodeError, UnicodeDecodeError, UnicodeTranslate...')
try: t('UnicodeDecodeError', lambda: UnicodeDecodeError('u', b'ab', 2 ** 63, 1, 'r'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('UnicodeDecodeError', lambda: UnicodeDecodeError('u', b'ab', 2 ** 6...")
try: e = SyntaxError('m')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: e = SyntaxError('m')")
try: e.lineno = 2 ** 63
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.lineno = 2 ** 63')
try: t('SyntaxError', lambda: str(e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('SyntaxError', lambda: str(e))")
