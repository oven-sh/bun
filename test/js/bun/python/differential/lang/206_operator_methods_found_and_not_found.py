# Operators: pow() with three arguments, methods that are descriptors, and what a match statement takes for a sequence or a mapping.
import collections.abc

def t(label, f):
    try:
        print(label, 'ok', f())
    except Exception as e:
        print(label, type(e).__name__, e)

class P:
    def __pow__(self, other, mod=None): return ('P.__pow__', type(other).__name__, mod)
    def __rpow__(self, other, mod=None): return ('P.__rpow__', type(other).__name__, mod)
class Q(P):
    def __rpow__(self, other, mod=None): return ('Q.__rpow__', type(other).__name__, mod)
class N:
    def __pow__(self, other, mod=None): return NotImplemented
    def __rpow__(self, other, mod=None): return NotImplemented
class R:
    def __rpow__(self, other, mod=None): return ('R.__rpow__', type(other).__name__, mod)
class M:
    pass
t('P P', lambda: pow(P(), P(), 5))
t('P Q', lambda: pow(P(), Q(), 5))
t('Q P', lambda: pow(Q(), P(), 5))
t('2 P', lambda: pow(2, P(), 5))
t('P 2', lambda: pow(P(), 2, 5))
t('N R', lambda: pow(N(), R(), 5))
t('N N', lambda: pow(N(), N(), 5))
t('2 R', lambda: pow(2, R(), 5))
t('2 2 P', lambda: pow(2, 2, P()))
t('2 2 M', lambda: pow(2, 2, M()))
t('M M M', lambda: pow(M(), M(), M()))
t('2 R', lambda: 2 ** R())
t('N R', lambda: N() ** R())
t('2.0 2 3', lambda: pow(2.0, 2, 3))
t('2 -1 5', lambda: pow(2, -1, 5))
t('2 -1 4', lambda: pow(2, -1, 4))
t('2 2 0', lambda: pow(2, 2, 0))
class I:
    def __ipow__(self, other): return ('I.__ipow__', other)
def ipow():
    i = I(); i **= 3; return i
t('**=', ipow)

# A method that is a property: an AttributeError from it says that there is no such method.
class Missing:
    def raiser(self):
        raise AttributeError('no such thing')
    __add__ = __radd__ = __eq__ = __lt__ = __neg__ = __len__ = __iter__ = __contains__ = __getitem__ = __call__ = __hash__ = __bool__ = __pow__ = __iadd__ = property(raiser)
class Other:
    def raiser(self):
        raise ValueError('something else')
    __add__ = __radd__ = __eq__ = __lt__ = __pow__ = property(raiser)
m = Missing()
for label, f in (('+', lambda: m + 1), ('r+', lambda: 1 + m), ('==', lambda: m == 1), ('!=', lambda: m != 1), ('<', lambda: m < 1), ('>', lambda: 1 > m),
                 ('**', lambda: m ** 2), ('pow', lambda: pow(m, 2, 3)), ('-', lambda: -m), ('len', lambda: len(m)), ('iter', lambda: iter(m)), ('in', lambda: 1 in m),
                 ('[]', lambda: m[0]), ('()', lambda: m()), ('hash', lambda: hash(m)), ('bool', lambda: bool(m))):
    t('Missing ' + label, f)
def iadd():
    x = Missing(); x += 1; return x
t('Missing +=', iadd)
o = Other()
for label, f in (('+', lambda: o + 1), ('r+', lambda: 1 + o), ('==', lambda: o == 1), ('<', lambda: o < 1), ('**', lambda: o ** 2)):
    t('Other ' + label, f)
class Bound:
    __add__ = property(lambda self: lambda other: ('bound', other))
    __eq__ = property(lambda self: lambda other: 'equal?')
t('Bound +', lambda: Bound() + 1)
t('Bound ==', lambda: Bound() == 1)

# Sequence and mapping patterns go by the classes in the MRO, first come first served.
def kind(x):
    match x:
        case [*_]: return 'sequence'
        case {}: return 'mapping'
        case _: return 'neither'
class S(collections.abc.Sequence):
    def __getitem__(self, i): raise IndexError
    def __len__(self): return 0
class Mp(collections.abc.Mapping):
    def __getitem__(self, k): raise KeyError
    def __len__(self): return 0
    def __iter__(self): return iter(())
class SM(S, Mp): pass
class MS(Mp, S): pass
class LD(list, Mp): pass
class DL(dict, S): pass
class Plain: pass
class PS(Plain, S): pass
class Reg: pass
collections.abc.Sequence.register(Reg)
class SubReg(Reg): pass
class Both: pass
collections.abc.Sequence.register(Both); collections.abc.Mapping.register(Both)
for cls in (S, Mp, SM, MS, LD, DL, Plain, PS, Reg, SubReg, Both, list, tuple, dict, str, bytes, range, set, collections.deque, collections.OrderedDict, memoryview):
    obj = cls(b'') if cls is memoryview else cls(0) if cls is range else cls()
    print(cls.__name__, kind(obj), bool(cls.__flags__ & 32), bool(cls.__flags__ & 64))

# Without an __iter__, a __getitem__ is not looked at until the first item is asked for.
class G:
    __getitem__ = property(lambda self: 1 / 0)
t('iter', lambda: type(iter(G())).__name__)
t('next', lambda: next(iter(G())))
t('for', lambda: [x for x in G()])
t('in', lambda: 1 in G())
