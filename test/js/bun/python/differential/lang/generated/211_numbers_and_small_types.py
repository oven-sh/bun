# complex(), the sizes of ints and types, ContextVar(), the repr of a generic alias, slice[...], OSError.characters_written, sys.intern().
try: import contextvars, sys, types, warnings
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import contextvars, sys, types, warnings')

try:
    def t(label, f):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter('always')
            try:
                print(label, 'ok', repr(f()))
            except Exception as e:
                print(label, type(e).__name__, e)
            for w in caught:
                print('   ', w.category.__name__, w.message)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(label, f):')

try:
    for text in ('1+1j', ' 1+1j ', '(1+1j)', ' ( 1+1j ) ', '\u2003(\u20021+1j\u2002)\u2003', '\u00a01j', '( 1+1j', '1+1j )', '(1 + 1j)', '1\u20031j', '\u0661+\u0662j', '1_0+2_0j', '1__0j', '_1j', '(1+1j)x', '()', '', ' ', 'j', '+j', 'nan+infj', '1e5j', '1e+j'):
        try: t(ascii(text), lambda: complex(text))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(ascii(text), lambda: complex(text))')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for text in ('1+1j', ' 1+1j ', '(1+1j)', ' ( 1+1j ) ', '\\u2003(\\u2002...")
try:
    class C0:
        def __complex__(self): return 1 + 2j
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class C0:')
try:
    class CS(complex):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class CS(complex):')
try:
    class C1:
        def __complex__(self): return CS(1, 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class C1:')
try:
    class C2:
        def __complex__(self): return 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class C2:')
try:
    class F:
        def __float__(self): return 1.5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class F:')
try:
    class I:
        def __index__(self): return 3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class I:')
try: t('complex, complex', lambda: complex(1j, 2j))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('complex, complex', lambda: complex(1j, 2j))")
try: t('real, complex', lambda: complex(1, 2j))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('real, complex', lambda: complex(1, 2j))")
try: t('complex, real', lambda: complex(1j, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('complex, real', lambda: complex(1j, 2))")
try: t('__complex__', lambda: complex(C0()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('__complex__', lambda: complex(C0()))")
try: t('__complex__, real', lambda: complex(C0(), 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('__complex__, real', lambda: complex(C0(), 1))")
try: t('real, __complex__', lambda: complex(1, C0()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('real, __complex__', lambda: complex(1, C0()))")
try: t('a subclass', lambda: complex(C1()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('a subclass', lambda: complex(C1()))")
try: t('not a complex', lambda: complex(C2()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('not a complex', lambda: complex(C2()))")
try: t('__float__', lambda: complex(F(), F()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('__float__', lambda: complex(F(), F()))")
try: t('__index__', lambda: complex(I(), I()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('__index__', lambda: complex(I(), I()))")
try: t('str, real', lambda: complex('1', 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('str, real', lambda: complex('1', 2))")
try: t('real, str', lambda: complex(1, '2'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('real, str', lambda: complex(1, '2'))")
try: t('None', lambda: complex(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('None', lambda: complex(None))")
try: t('None, 1', lambda: complex(None, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('None, 1', lambda: complex(None, 1))")
try: t('keywords', lambda: complex(real=1j, imag=1j))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('keywords', lambda: complex(real=1j, imag=1j))")
try: t('imag only', lambda: complex(imag=2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('imag only', lambda: complex(imag=2))")
try: t('imag complex only', lambda: complex(imag=2j))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('imag complex only', lambda: complex(imag=2j))")
try: t('subclass', lambda: type(CS(CS(1, 2))).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('subclass', lambda: type(CS(CS(1, 2))).__name__)")
try: t('three', lambda: complex(1, 2, 3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('three', lambda: complex(1, 2, 3))")
try: t('from_number', lambda: (complex.from_number(1), complex.from_number(C0()), complex.from_number(1.5)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('from_number', lambda: (complex.from_number(1), complex.from_number...")
try: t('from_number str', lambda: complex.from_number('1'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('from_number str', lambda: complex.from_number('1'))")
try: t('float', lambda: (float(' 1.5 '), float('\u20031.5\u2003'), float('\u0661.\u0665')))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('float', lambda: (float(' 1.5 '), float('\\u20031.5\\u2003'), float('...")
try: t('float inner space', lambda: float('1\u20035'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('float inner space', lambda: float('1\\u20035'))")

try:
    class MyInt(int): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class MyInt(int): pass')
try:
    for n in (0, 1, -1, 2**30 - 1, 2**30, -2**30, 2**60 - 1, 2**60, 2**90, 10**100):
        try: print('n.bit_length() [' + 'n=' + (repr(n) if type(n) in (str, int, float, bytes, bool, type(None)) or (type(n) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in n)) else n.__name__ if type(n) is type else type(n).__name__) + '] =>', n.bit_length())
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n.bit_length()')
        try: print('n.__sizeof__() [' + 'n=' + (repr(n) if type(n) in (str, int, float, bytes, bool, type(None)) or (type(n) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in n)) else n.__name__ if type(n) is type else type(n).__name__) + '] =>', n.__sizeof__())
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n.__sizeof__()')
        try: print('MyInt(n).__sizeof__() [' + 'n=' + (repr(n) if type(n) in (str, int, float, bytes, bool, type(None)) or (type(n) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in n)) else n.__name__ if type(n) is type else type(n).__name__) + '] =>', MyInt(n).__sizeof__())
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: MyInt(n).__sizeof__()')
        try: print('sys.getsizeof(n) [' + 'n=' + (repr(n) if type(n) in (str, int, float, bytes, bool, type(None)) or (type(n) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in n)) else n.__name__ if type(n) is type else type(n).__name__) + '] =>', sys.getsizeof(n))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.getsizeof(n)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for n in (0, 1, -1, 2**30 - 1, 2**30, -2**30, 2**60 - 1, 2**60, 2**90...')
try: print('True.__sizeof__() =>', True.__sizeof__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: True.__sizeof__()')
try: print('int.__basicsize__ =>', int.__basicsize__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: int.__basicsize__')
try: print('int.__itemsize__ =>', int.__itemsize__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: int.__itemsize__')
try: print('bool.__basicsize__ =>', bool.__basicsize__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bool.__basicsize__')
try: print('MyInt.__basicsize__ =>', MyInt.__basicsize__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: MyInt.__basicsize__')
try: print('MyInt.__itemsize__ =>', MyInt.__itemsize__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: MyInt.__itemsize__')
try:
    class Slots: __slots__ = ('a', 'b')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: class Slots: __slots__ = ('a', 'b')")
try:
    class SubSlots(Slots): __slots__ = ('c',)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: class SubSlots(Slots): __slots__ = ('c',)")
try:
    class Plain: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Plain: pass')
try:
    class T(tuple): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class T(tuple): pass')
try: print([c.__basicsize__ for c in (object, Plain, Slots, SubSlots, float, complex, str, bytes, bytearray, tuple, T, list, dict, set, frozenset, type, BaseException, ValueError)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__basicsize__ for c in (object, Plain, Slots, SubSlots, float, com...')
try: print([c.__itemsize__ for c in (object, Plain, float, str, bytes, tuple, T, list, type)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__itemsize__ for c in (object, Plain, float, str, bytes, tuple, T,...')
try: print('type.__sizeof__(int) =>', type.__sizeof__(int))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type.__sizeof__(int)')
try: print('type.__sizeof__(Slots) =>', type.__sizeof__(Slots))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type.__sizeof__(Slots)')
try: print('type.__sizeof__(type) =>', type.__sizeof__(type))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type.__sizeof__(type)')

try: t('ContextVar()', lambda: contextvars.ContextVar())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('ContextVar()', lambda: contextvars.ContextVar())")
try: t('ContextVar(1)', lambda: contextvars.ContextVar(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('ContextVar(1)', lambda: contextvars.ContextVar(1))")
try: t('two', lambda: contextvars.ContextVar('a', 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('two', lambda: contextvars.ContextVar('a', 1))")
try: t('three', lambda: contextvars.ContextVar('a', default=1, x=2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('three', lambda: contextvars.ContextVar('a', default=1, x=2))")
try: t('name=', lambda: contextvars.ContextVar(name='a'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('name=', lambda: contextvars.ContextVar(name='a'))")
try: t('x=', lambda: contextvars.ContextVar('a', x=2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('x=', lambda: contextvars.ContextVar('a', x=2))")
try: t('default', lambda: contextvars.ContextVar('a', default=5).get())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('default', lambda: contextvars.ContextVar('a', default=5).get())")
try:
    class Unhashable(str):
        __hash__ = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Unhashable(str):')
try: t('unhashable name', lambda: contextvars.ContextVar(Unhashable('a')))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('unhashable name', lambda: contextvars.ContextVar(Unhashable('a')))")
try:
    class Named(str): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Named(str): pass')
try: t('subclass of str', lambda: type(contextvars.ContextVar(Named('a')).name).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('subclass of str', lambda: type(contextvars.ContextVar(Named('a'))....")

try: items = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: items = []')
try:
    class Evil:
        def __repr__(self):
            items.clear()
            return 'evil'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Evil:')
try: items += [Evil(), 1]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: items += [Evil(), 1]')
try: t('list that shrinks', lambda: repr(types.GenericAlias(int, items)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('list that shrinks', lambda: repr(types.GenericAlias(int, items)))")
try: t('list', lambda: repr(types.GenericAlias(int, ([int, str], ...))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('list', lambda: repr(types.GenericAlias(int, ([int, str], ...))))")
try: t('slice[int]', lambda: (slice[int], slice[int, str, None], type(slice[int]).__name__, slice[int].__origin__ is slice))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('slice[int]', lambda: (slice[int], slice[int, str, None], type(slic...")

try:
    for n in range(6):
        try: e = BlockingIOError(*('a', 'b', 'c', 'd', 'e')[:n])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: e = BlockingIOError(*('a', 'b', 'c', 'd', 'e')[:n])")
        try: t('characters_written %d' % n, lambda: e.characters_written)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('characters_written %d' % n, lambda: e.characters_written)")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for n in range(6):')
try: e = BlockingIOError('a', 'b', 3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: e = BlockingIOError('a', 'b', 3)")
try: t('given', lambda: e.characters_written)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('given', lambda: e.characters_written)")
try:
    def assign(value):
        e.characters_written = value
        return e.characters_written
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def assign(value):')
try: t('5', lambda: assign(5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('5', lambda: assign(5))")
try: t('index', lambda: assign(I()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('index', lambda: assign(I()))")
try: t('str', lambda: assign('x'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('str', lambda: assign('x'))")
try: t('float', lambda: assign(1.5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('float', lambda: assign(1.5))")
try: t('huge', lambda: assign(2**70))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('huge', lambda: assign(2**70))")
try: t('-1', lambda: assign(-1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('-1', lambda: assign(-1))")
try: t('-2', lambda: assign(-2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('-2', lambda: assign(-2))")
try:
    def delete():
        del e.characters_written
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def delete():')
try: t('del', delete)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('del', delete)")
try: t('del again', delete)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('del again', delete)")
try: t('gone', lambda: e.characters_written)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('gone', lambda: e.characters_written)")
try: t('OSError', lambda: OSError(1, 'x').characters_written)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('OSError', lambda: OSError(1, 'x').characters_written)")

try: a = ''.join(['never ', 'interned ', 'before'])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: a = ''.join(['never ', 'interned ', 'before'])")
try: b = ''.join(['never ', 'interned ', 'before'])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: b = ''.join(['never ', 'interned ', 'before'])")
try: print('a is b =>', a is b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a is b')
try: print('sys.intern(a) is a =>', sys.intern(a) is a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.intern(a) is a')
try: print('sys._is_interned(a) =>', sys._is_interned(a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys._is_interned(a)')
try: print('sys._is_interned(b) =>', sys._is_interned(b))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys._is_interned(b)')
try: print('sys.intern(b) is a =>', sys.intern(b) is a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.intern(b) is a')
try: print('sys.intern(b) is b =>', sys.intern(b) is b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.intern(b) is b')
try: print('sys._is_interned(b) =>', sys._is_interned(b))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys._is_interned(b)')
try: print('a is b =>', a is b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a is b')
try: t('subclass', lambda: sys.intern(Named('x')))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('subclass', lambda: sys.intern(Named('x')))")
try: t('bytes', lambda: sys.intern(b'x'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('bytes', lambda: sys.intern(b'x'))")
