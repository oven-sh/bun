# complex(), the sizes of ints and types, ContextVar(), the repr of a generic alias, slice[...], OSError.characters_written, sys.intern().
import contextvars, sys, types, warnings

def t(label, f):
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter('always')
        try:
            print(label, 'ok', repr(f()))
        except Exception as e:
            print(label, type(e).__name__, e)
        for w in caught:
            print('   ', w.category.__name__, w.message)

for text in ('1+1j', ' 1+1j ', '(1+1j)', ' ( 1+1j ) ', '\u2003(\u20021+1j\u2002)\u2003', '\u00a01j', '( 1+1j', '1+1j )', '(1 + 1j)', '1\u20031j', '\u0661+\u0662j', '1_0+2_0j', '1__0j', '_1j', '(1+1j)x', '()', '', ' ', 'j', '+j', 'nan+infj', '1e5j', '1e+j'):
    t(ascii(text), lambda: complex(text))
class C0:
    def __complex__(self): return 1 + 2j
class CS(complex):
    pass
class C1:
    def __complex__(self): return CS(1, 2)
class C2:
    def __complex__(self): return 1
class F:
    def __float__(self): return 1.5
class I:
    def __index__(self): return 3
t('complex, complex', lambda: complex(1j, 2j))
t('real, complex', lambda: complex(1, 2j))
t('complex, real', lambda: complex(1j, 2))
t('__complex__', lambda: complex(C0()))
t('__complex__, real', lambda: complex(C0(), 1))
t('real, __complex__', lambda: complex(1, C0()))
t('a subclass', lambda: complex(C1()))
t('not a complex', lambda: complex(C2()))
t('__float__', lambda: complex(F(), F()))
t('__index__', lambda: complex(I(), I()))
t('str, real', lambda: complex('1', 2))
t('real, str', lambda: complex(1, '2'))
t('None', lambda: complex(None))
t('None, 1', lambda: complex(None, 1))
t('keywords', lambda: complex(real=1j, imag=1j))
t('imag only', lambda: complex(imag=2))
t('imag complex only', lambda: complex(imag=2j))
t('subclass', lambda: type(CS(CS(1, 2))).__name__)
t('three', lambda: complex(1, 2, 3))
t('from_number', lambda: (complex.from_number(1), complex.from_number(C0()), complex.from_number(1.5)))
t('from_number str', lambda: complex.from_number('1'))
t('float', lambda: (float(' 1.5 '), float('\u20031.5\u2003'), float('\u0661.\u0665')))
t('float inner space', lambda: float('1\u20035'))

class MyInt(int): pass
for n in (0, 1, -1, 2**30 - 1, 2**30, -2**30, 2**60 - 1, 2**60, 2**90, 10**100):
    print(n.bit_length(), n.__sizeof__(), MyInt(n).__sizeof__(), sys.getsizeof(n))
print(True.__sizeof__(), int.__basicsize__, int.__itemsize__, bool.__basicsize__, MyInt.__basicsize__, MyInt.__itemsize__)
class Slots: __slots__ = ('a', 'b')
class SubSlots(Slots): __slots__ = ('c',)
class Plain: pass
class T(tuple): pass
print([c.__basicsize__ for c in (object, Plain, Slots, SubSlots, float, complex, str, bytes, bytearray, tuple, T, list, dict, set, frozenset, type, BaseException, ValueError)])
print([c.__itemsize__ for c in (object, Plain, float, str, bytes, tuple, T, list, type)])
print(type.__sizeof__(int), type.__sizeof__(Slots), type.__sizeof__(type))

t('ContextVar()', lambda: contextvars.ContextVar())
t('ContextVar(1)', lambda: contextvars.ContextVar(1))
t('two', lambda: contextvars.ContextVar('a', 1))
t('three', lambda: contextvars.ContextVar('a', default=1, x=2))
t('name=', lambda: contextvars.ContextVar(name='a'))
t('x=', lambda: contextvars.ContextVar('a', x=2))
t('default', lambda: contextvars.ContextVar('a', default=5).get())
class Unhashable(str):
    __hash__ = None
t('unhashable name', lambda: contextvars.ContextVar(Unhashable('a')))
class Named(str): pass
t('subclass of str', lambda: type(contextvars.ContextVar(Named('a')).name).__name__)

items = []
class Evil:
    def __repr__(self):
        items.clear()
        return 'evil'
items += [Evil(), 1]
t('list that shrinks', lambda: repr(types.GenericAlias(int, items)))
t('list', lambda: repr(types.GenericAlias(int, ([int, str], ...))))
t('slice[int]', lambda: (slice[int], slice[int, str, None], type(slice[int]).__name__, slice[int].__origin__ is slice))

for n in range(6):
    e = BlockingIOError(*('a', 'b', 'c', 'd', 'e')[:n])
    t('characters_written %d' % n, lambda: e.characters_written)
e = BlockingIOError('a', 'b', 3)
t('given', lambda: e.characters_written)
def assign(value):
    e.characters_written = value
    return e.characters_written
t('5', lambda: assign(5))
t('index', lambda: assign(I()))
t('str', lambda: assign('x'))
t('float', lambda: assign(1.5))
t('huge', lambda: assign(2**70))
t('-1', lambda: assign(-1))
t('-2', lambda: assign(-2))
def delete():
    del e.characters_written
t('del', delete)
t('del again', delete)
t('gone', lambda: e.characters_written)
t('OSError', lambda: OSError(1, 'x').characters_written)

a = ''.join(['never ', 'interned ', 'before'])
b = ''.join(['never ', 'interned ', 'before'])
print(a is b, sys.intern(a) is a, sys._is_interned(a), sys._is_interned(b), sys.intern(b) is a, sys.intern(b) is b, sys._is_interned(b), a is b)
t('subclass', lambda: sys.intern(Named('x')))
t('bytes', lambda: sys.intern(b'x'))
