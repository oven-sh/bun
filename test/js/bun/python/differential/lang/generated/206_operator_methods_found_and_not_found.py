# Operators: pow() with three arguments, methods that are descriptors, and what a match statement takes for a sequence or a mapping.
try: import collections.abc
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import collections.abc')

try:
    def t(label, f):
        try:
            print(label, 'ok', f())
        except Exception as e:
            print(label, type(e).__name__, e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(label, f):')

try:
    class P:
        def __pow__(self, other, mod=None): return ('P.__pow__', type(other).__name__, mod)
        def __rpow__(self, other, mod=None): return ('P.__rpow__', type(other).__name__, mod)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class P:')
try:
    class Q(P):
        def __rpow__(self, other, mod=None): return ('Q.__rpow__', type(other).__name__, mod)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Q(P):')
try:
    class N:
        def __pow__(self, other, mod=None): return NotImplemented
        def __rpow__(self, other, mod=None): return NotImplemented
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class N:')
try:
    class R:
        def __rpow__(self, other, mod=None): return ('R.__rpow__', type(other).__name__, mod)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class R:')
try:
    class M:
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class M:')
try: t('P P', lambda: pow(P(), P(), 5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('P P', lambda: pow(P(), P(), 5))")
try: t('P Q', lambda: pow(P(), Q(), 5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('P Q', lambda: pow(P(), Q(), 5))")
try: t('Q P', lambda: pow(Q(), P(), 5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('Q P', lambda: pow(Q(), P(), 5))")
try: t('2 P', lambda: pow(2, P(), 5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('2 P', lambda: pow(2, P(), 5))")
try: t('P 2', lambda: pow(P(), 2, 5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('P 2', lambda: pow(P(), 2, 5))")
try: t('N R', lambda: pow(N(), R(), 5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('N R', lambda: pow(N(), R(), 5))")
try: t('N N', lambda: pow(N(), N(), 5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('N N', lambda: pow(N(), N(), 5))")
try: t('2 R', lambda: pow(2, R(), 5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('2 R', lambda: pow(2, R(), 5))")
try: t('2 2 P', lambda: pow(2, 2, P()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('2 2 P', lambda: pow(2, 2, P()))")
try: t('2 2 M', lambda: pow(2, 2, M()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('2 2 M', lambda: pow(2, 2, M()))")
try: t('M M M', lambda: pow(M(), M(), M()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('M M M', lambda: pow(M(), M(), M()))")
try: t('2 R', lambda: 2 ** R())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('2 R', lambda: 2 ** R())")
try: t('N R', lambda: N() ** R())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('N R', lambda: N() ** R())")
try: t('2.0 2 3', lambda: pow(2.0, 2, 3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('2.0 2 3', lambda: pow(2.0, 2, 3))")
try: t('2 -1 5', lambda: pow(2, -1, 5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('2 -1 5', lambda: pow(2, -1, 5))")
try: t('2 -1 4', lambda: pow(2, -1, 4))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('2 -1 4', lambda: pow(2, -1, 4))")
try: t('2 2 0', lambda: pow(2, 2, 0))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('2 2 0', lambda: pow(2, 2, 0))")
try:
    class I:
        def __ipow__(self, other): return ('I.__ipow__', other)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class I:')
try:
    def ipow():
        i = I(); i **= 3; return i
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def ipow():')
try: t('**=', ipow)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('**=', ipow)")

# A method that is a property: an AttributeError from it says that there is no such method.
try:
    class Missing:
        def raiser(self):
            raise AttributeError('no such thing')
        __add__ = __radd__ = __eq__ = __lt__ = __neg__ = __len__ = __iter__ = __contains__ = __getitem__ = __call__ = __hash__ = __bool__ = __pow__ = __iadd__ = property(raiser)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Missing:')
try:
    class Other:
        def raiser(self):
            raise ValueError('something else')
        __add__ = __radd__ = __eq__ = __lt__ = __pow__ = property(raiser)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Other:')
try: m = Missing()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m = Missing()')
try:
    for label, f in (('+', lambda: m + 1), ('r+', lambda: 1 + m), ('==', lambda: m == 1), ('!=', lambda: m != 1), ('<', lambda: m < 1), ('>', lambda: 1 > m),
                     ('**', lambda: m ** 2), ('pow', lambda: pow(m, 2, 3)), ('-', lambda: -m), ('len', lambda: len(m)), ('iter', lambda: iter(m)), ('in', lambda: 1 in m),
                     ('[]', lambda: m[0]), ('()', lambda: m()), ('hash', lambda: hash(m)), ('bool', lambda: bool(m))):
        try: t('Missing ' + label, f)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('Missing ' + label, f)")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for label, f in (('+', lambda: m + 1), ('r+', lambda: 1 + m), ('==', ...")
try:
    def iadd():
        x = Missing(); x += 1; return x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def iadd():')
try: t('Missing +=', iadd)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('Missing +=', iadd)")
try: o = Other()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = Other()')
try:
    for label, f in (('+', lambda: o + 1), ('r+', lambda: 1 + o), ('==', lambda: o == 1), ('<', lambda: o < 1), ('**', lambda: o ** 2)):
        try: t('Other ' + label, f)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('Other ' + label, f)")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for label, f in (('+', lambda: o + 1), ('r+', lambda: 1 + o), ('==', ...")
try:
    class Bound:
        __add__ = property(lambda self: lambda other: ('bound', other))
        __eq__ = property(lambda self: lambda other: 'equal?')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Bound:')
try: t('Bound +', lambda: Bound() + 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('Bound +', lambda: Bound() + 1)")
try: t('Bound ==', lambda: Bound() == 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('Bound ==', lambda: Bound() == 1)")

# Sequence and mapping patterns go by the classes in the MRO, first come first served.
try:
    def kind(x):
        match x:
            case [*_]: return 'sequence'
            case {}: return 'mapping'
            case _: return 'neither'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def kind(x):')
try:
    class S(collections.abc.Sequence):
        def __getitem__(self, i): raise IndexError
        def __len__(self): return 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class S(collections.abc.Sequence):')
try:
    class Mp(collections.abc.Mapping):
        def __getitem__(self, k): raise KeyError
        def __len__(self): return 0
        def __iter__(self): return iter(())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Mp(collections.abc.Mapping):')
try:
    class SM(S, Mp): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class SM(S, Mp): pass')
try:
    class MS(Mp, S): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class MS(Mp, S): pass')
try:
    class LD(list, Mp): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class LD(list, Mp): pass')
try:
    class DL(dict, S): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class DL(dict, S): pass')
try:
    class Plain: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Plain: pass')
try:
    class PS(Plain, S): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class PS(Plain, S): pass')
try:
    class Reg: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Reg: pass')
try: collections.abc.Sequence.register(Reg)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: collections.abc.Sequence.register(Reg)')
try:
    class SubReg(Reg): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class SubReg(Reg): pass')
try:
    class Both: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Both: pass')
try: collections.abc.Sequence.register(Both)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: collections.abc.Sequence.register(Both)')
try: collections.abc.Mapping.register(Both)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: collections.abc.Mapping.register(Both)')
try:
    for cls in (S, Mp, SM, MS, LD, DL, Plain, PS, Reg, SubReg, Both, list, tuple, dict, str, bytes, range, set, collections.deque, collections.OrderedDict, memoryview):
        try: obj = cls(b'') if cls is memoryview else cls(0) if cls is range else cls()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: obj = cls(b'') if cls is memoryview else cls(0) if cls is range else ...")
        try: print('cls.__name__ [' + 'cls=' + (repr(cls) if type(cls) in (str, int, float, bytes, bool, type(None)) or (type(cls) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in cls)) else cls.__name__ if type(cls) is type else type(cls).__name__) + '] =>', cls.__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: cls.__name__')
        try: print('kind(obj) [' + 'cls=' + (repr(cls) if type(cls) in (str, int, float, bytes, bool, type(None)) or (type(cls) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in cls)) else cls.__name__ if type(cls) is type else type(cls).__name__) + '] =>', kind(obj))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: kind(obj)')
        try: print('bool(cls.__flags__ & 32) [' + 'cls=' + (repr(cls) if type(cls) in (str, int, float, bytes, bool, type(None)) or (type(cls) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in cls)) else cls.__name__ if type(cls) is type else type(cls).__name__) + '] =>', bool(cls.__flags__ & 32))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bool(cls.__flags__ & 32)')
        try: print('bool(cls.__flags__ & 64) [' + 'cls=' + (repr(cls) if type(cls) in (str, int, float, bytes, bool, type(None)) or (type(cls) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in cls)) else cls.__name__ if type(cls) is type else type(cls).__name__) + '] =>', bool(cls.__flags__ & 64))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bool(cls.__flags__ & 64)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for cls in (S, Mp, SM, MS, LD, DL, Plain, PS, Reg, SubReg, Both, list...')

# Without an __iter__, a __getitem__ is not looked at until the first item is asked for.
try:
    class G:
        __getitem__ = property(lambda self: 1 / 0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class G:')
try: t('iter', lambda: type(iter(G())).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('iter', lambda: type(iter(G())).__name__)")
try: t('next', lambda: next(iter(G())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('next', lambda: next(iter(G())))")
try: t('for', lambda: [x for x in G()])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('for', lambda: [x for x in G()])")
try: t('in', lambda: 1 in G())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('in', lambda: 1 in G())")
