import copy, pickle, sys, operator
from datetime import timedelta, date, datetime, time, timezone
from fractions import Fraction
from decimal import Decimal

def t(src, **env):
    try:
        print(src, '=>', repr(eval(src, globals(), env)))
    except BaseException as e:
        print(src, '!!', type(e).__name__, e)

td = timedelta

print('--- constructor')
for src in '''
td()
td(0)
td(1)
td(-1)
td(1, 2, 3)
td(1, 2, 3, 4, 5, 6, 7)
td(days=1, seconds=2, microseconds=3, milliseconds=4, minutes=5, hours=6, weeks=7)
td(weeks=1)
td(hours=24)
td(minutes=24*60)
td(seconds=86400)
td(milliseconds=86400000)
td(microseconds=86400000000)
td(seconds=-1)
td(microseconds=-1)
td(milliseconds=-1)
td(days=-1, seconds=86399, microseconds=999999)
td(0, 0, 1000000)
td(0, 0, -1000000)
td(0, 86400)
td(0, -86400)
td(0, 86399, 1000001)
td(1.5)
td(0.5)
td(days=.5, seconds=.5, microseconds=.5)
td(seconds=0.1)
td(seconds=1e-6)
td(seconds=1e-7)
td(seconds=5e-7)
td(seconds=1.5e-6)
td(seconds=2.5e-6)
td(microseconds=0.5)
td(microseconds=1.5)
td(microseconds=2.5)
td(microseconds=-0.5)
td(microseconds=-1.5)
td(microseconds=0.4999999)
td(microseconds=0.51)
td(milliseconds=0.0005)
td(milliseconds=0.0015)
td(milliseconds=1.0005)
td(hours=1/3)
td(weeks=1/7)
td(days=1/86400)
td(days=1/86400000000)
td(days=1e-11)
td(days=0.1, hours=0.1, minutes=0.1, seconds=0.1, milliseconds=0.1, microseconds=0.1)
td(days=-0.1, hours=-0.1, minutes=-0.1, seconds=-0.1, milliseconds=-0.1, microseconds=-0.1)
td(seconds=0.6112295, microseconds=0.5)
td(seconds=0.5/1000, microseconds=0.5)
td(seconds=0.001, microseconds=-0.5)
td(True)
td(True, True, True)
td(999999999)
td(-999999999)
td(1000000000)
td(-1000000000)
td(999999999, 86399, 999999)
td(999999999, 86399, 1000000)
td(-999999999, 0, -1)
td(999999999, 86400)
td(days=10**9)
td(days=10**10)
td(days=10**20)
td(days=-10**20)
td(seconds=10**20)
td(microseconds=10**30)
td(microseconds=10**18)
td(microseconds=-10**18)
td(microseconds=86399999999999999999)
td(microseconds=86400000000000000000)
td(weeks=142857142)
td(weeks=142857143)
td(days=1e9)
td(days=1e10)
td(days=1e300)
td(seconds=1e300)
td(float('inf'))
td(float('-inf'))
td(float('nan'))
td(seconds=float('nan'))
td(microseconds=float('inf'))
td('1')
td(None)
td(1j)
td([])
td(Fraction(1, 2))
td(Decimal(1))
td(seconds='x')
td(microseconds=b'1')
td(1, 2, 3, 4, 5, 6, 7, 8)
td(1, days=1)
td(foo=1)
td(day=1)
td(second=1)
td(**{'weeks': 1, 'days': 1})
'''.strip().splitlines():
    t(src)

class Idx:
    def __init__(self, v): self.v = v
    def __index__(self): return self.v
    def __repr__(self): return 'Idx(%d)' % self.v
class Flt:
    def __float__(self): return 1.5
class IntSub(int): pass
class FloatSub(float): pass
t('td(Idx(3))')
t('td(Flt())')
t('td(IntSub(3))')
t('td(FloatSub(1.5))')
t('td(seconds=IntSub(3), microseconds=FloatSub(1.5))')

print('--- attributes')
for d in [td(), td(1, 2, 3), td(-1, 2, 3), td(microseconds=-1), td.min, td.max, td.resolution]:
    print(repr(d), str(d), d.days, d.seconds, d.microseconds, d.total_seconds(), bool(d))
for src in '''
td(1).days
type(td(1).days)
td.days
td.seconds
td.microseconds
type(td.days).__name__
td.days.__get__(td(5))
td.days.__get__(None, td)
td.days.__get__(5)
td(1).foo
setattr(td(1), 'days', 2)
setattr(td(1), 'foo', 2)
delattr(td(1), 'days')
td(1).__dict__
td.min
td.max
td.resolution
td.min.min
type(td.min)
td.total_seconds(td(1))
td.total_seconds(1)
td(1).total_seconds(1)
td(days=999999999, hours=23, minutes=59, seconds=59, microseconds=999999).total_seconds()
td(microseconds=1).total_seconds()
td(days=365*292277).total_seconds()
td(seconds=0x7fffffffffffffff // 10**6).total_seconds()
td(microseconds=2**53 + 1).total_seconds()
td(microseconds=2**60 + 12345).total_seconds()
'''.strip().splitlines():
    t(src)

print('--- repr and str')
for src in '''
repr(td(0))
repr(td(1))
repr(td(0, 1))
repr(td(0, 0, 1))
repr(td(1, 1))
repr(td(1, 0, 1))
repr(td(0, 1, 1))
repr(td(1, 1, 1))
repr(td(-1))
repr(td(-1, 1))
str(td(0))
str(td(1))
str(td(2))
str(td(-1))
str(td(-2))
str(td(0, 1))
str(td(0, 3661))
str(td(0, 36000))
str(td(0, 0, 1))
str(td(1, 0, 1))
str(td(-1, 86399, 999999))
str(td(999999999, 86399, 999999))
str(td(-999999999))
format(td(1))
format(td(1), '')
format(td(1), '>20')
'%s' % td(1)
f'{td(1, 1)}'
f'{td(1, 1)!r}'
'''.strip().splitlines():
    t(src)

print('--- arithmetic')
values = [td(0), td(1), td(-1), td(0, 1), td(0, 0, 1), td(1, 2, 3), td(-5, 7, 11), td(0, 0, 7), td(days=100, microseconds=999999), td.max, td.min, td.resolution]
others = [0, 1, -1, 2, 3, 7, 10**6, 10**20, -10**20, True, False, 0.0, 0.5, 1.5, -2.5, 1e-7, 1e20, 1/3, float('inf'), float('-inf'), float('nan'), None, 'x', 1j, Fraction(1, 2), Decimal(2), [], (1,), IntSub(3), FloatSub(0.5), Idx(2)]
ops = [('+', operator.add), ('-', operator.sub), ('*', operator.mul), ('/', operator.truediv), ('//', operator.floordiv), ('%', operator.mod), ('divmod', divmod), ('**', operator.pow)]
def show(name, f, a, b):
    try:
        r = f(a, b)
        print(repr(a), name, repr(b), '=>', repr(r))
    except BaseException as e:
        print(repr(a), name, repr(b), '!!', type(e).__name__, e)
for name, f in ops:
    for a in values:
        for b in values:
            show(name, f, a, b)
for name, f in ops:
    for a in values[:9]:
        for b in others:
            show(name, f, a, b)
            show(name, f, b, a)
for a in values:
    for src in ['-a', '+a', 'abs(a)', 'bool(a)', '~a', 'int(a)', 'float(a)', 'a.__neg__()', 'a.__pos__()', 'a.__abs__()', 'a.__bool__()']:
        t(src, a=a)

print('--- rounding of products and quotients')
for us in [1, 2, 3, 5, 7, 999999, 1000001, 10**12 + 1]:
    a = td(microseconds=us)
    for f in [0.5, 1.5, 2.5, 0.1, 0.3, 1/3, 2/3, 1e-3, 1e3, 0.9999999, -0.5, -1.5, 1e-10]:
        show('*', operator.mul, a, f)
        show('/', operator.truediv, a, f)
    for n in [2, 3, 4, 6, 7, -2, -3, 10**6, 10**12]:
        show('/', operator.truediv, a, n)
        show('//', operator.floordiv, a, n)

print('--- direct calls of the methods')
for src in '''
td(1).__add__(td(1))
td(1).__add__(1)
td(1).__radd__(td(1))
td(1).__radd__(1)
td(1).__sub__(1)
td(1).__rsub__(td(3))
td(1).__mul__(2)
td(1).__rmul__(2)
td(1).__mul__(td(1))
td(1).__mul__('x')
td(1).__truediv__(2)
td(1).__rtruediv__(2)
td(1).__rtruediv__(td(2))
td(1).__floordiv__(td(0, 7))
td(1).__rfloordiv__(td(3))
td(1).__rfloordiv__(3)
td(1).__mod__(td(0, 7))
td(1).__rmod__(td(3))
td(1).__divmod__(td(0, 7))
td(1).__rdivmod__(td(3))
td(1).__divmod__(3)
td.__add__(1, td(1))
td.__add__(td(1), td(1))
td.__add__(1, 1)
td.__mul__(2, td(1))
td.__neg__(1)
td.__abs__(1)
td.__bool__(1)
td.__hash__(1)
td.__repr__(1)
td.__str__(1)
td.__eq__(1, td(1))
td.__reduce__(1)
sum([td(1), td(2)], td())
sum([td(1), td(2)])
max(td(1), td(2))
sorted([td(3), td(1), td(2)])
'''.strip().splitlines():
    t(src)

print('--- comparison')
cmps = [('==', operator.eq), ('!=', operator.ne), ('<', operator.lt), ('<=', operator.le), ('>', operator.gt), ('>=', operator.ge)]
class Anything:
    def __eq__(self, other): return True
    def __ne__(self, other): return False
    def __lt__(self, other): return 'lt'
    def __gt__(self, other): return 'gt'
    def __le__(self, other): return 'le'
    def __ge__(self, other): return 'ge'
    def __repr__(self): return 'Anything()'
for name, f in cmps:
    for a in [td(0), td(1), td(0, 1), td(0, 0, 1), td(-1), td(1, 1, 1)]:
        for b in [td(0), td(1), td(0, 1), td(0, 0, 1), td(-1), td(1, 1, 1), 0, 1, 86400, 0.0, None, 'x', (), date(2000, 1, 1), time(0), Anything()]:
            show(name, f, a, b)
            if not isinstance(b, td):
                show(name, f, b, a)
for src in '''
td(1).__eq__(td(1))
td(1).__eq__(1)
td(1).__ne__(1)
td(1).__lt__(1)
td(1).__lt__(td(2))
td(1).__le__(td(1))
td(1).__gt__(td(0))
td(1).__ge__(None)
td(1) in [td(1)]
td(1) in {td(1)}
{td(1): 1}[td(hours=24)]
hash(td(1)) == hash(td(hours=24))
hash(td(0)) == hash(td())
hash(td(1, 2, 3)) == hash(td(microseconds=86402000003))
len({td(i) for i in range(100)} | {td(hours=24 * i) for i in range(100)})
type(hash(td(1)))
hash(td.max) == hash(td.max)
hash(td.min) == hash(td(-999999999))
'''.strip().splitlines():
    t(src)

print('--- pickle, copy')
for d in [td(), td(1, 2, 3), td(-1, 2, 3), td.max, td.min]:
    print(d.__reduce__(), d.__reduce_ex__(2))
    for proto in range(pickle.HIGHEST_PROTOCOL + 1):
        s = pickle.dumps(d, proto)
        print(proto, s, pickle.loads(s) == d, type(pickle.loads(s)).__name__)
    print(copy.copy(d) == d, copy.deepcopy(d) == d, copy.copy(d) is d, copy.deepcopy(d) is d)
t('td(0) is td(0)')
t('td() is td(0, 0, 0)')
t('(td(1) - td(1)) is td(0)')
t('copy.replace(td(1), days=2)')

print('--- subclass')
class T(td):
    def __repr__(self): return 'T' + super().__repr__()[len('datetime.timedelta') if super().__repr__().startswith('datetime') else len('T'):]
    def hours(self): return self.total_seconds() / 3600
class U(td):
    __slots__ = ()
class V(td):
    def __new__(cls, *args, extra=None, **kw):
        self = super().__new__(cls, *args, **kw)
        self.extra = extra
        return self
x = T(1, 2, 3)
print(type(x).__name__, td.__repr__(x), x.hours(), x.days, x.__dict__)
x.foo = 5
print(x.foo, x.__dict__)
for src in '''
type(x + x).__name__
type(x - x).__name__
type(x * 2).__name__
type(2 * x).__name__
type(x / 2).__name__
type(x // 2).__name__
type(x % td(0, 7)).__name__
type(divmod(x, td(0, 7))[1]).__name__
type(-x).__name__
type(+x).__name__
type(abs(x)).__name__
type(x + td(1)).__name__
type(td(1) + x).__name__
type(T.min).__name__
type(T.max).__name__
type(T()).__name__
T() is T()
T(0) == td(0)
hash(T(1)) == hash(td(1))
T(1) == td(1)
td(1) == T(1)
T(1) < td(2)
type(copy.copy(x)).__name__
copy.copy(x).__dict__
type(copy.deepcopy(x)).__name__
copy.deepcopy(x).__dict__
x.__reduce__()
x.__reduce_ex__(2)
type(pickle.loads(pickle.dumps(x))).__name__
pickle.loads(pickle.dumps(x)).__dict__
U(1).__slots__
setattr(U(1), 'foo', 1)
U(1).__dict__
V(1, extra=5).extra
V(1, 2, extra=5) + V(1)
type(V(1, extra=5) + V(1)).__name__
td.__new__(T, 1)
td.__new__(td, 1)
td.__new__(int, 1)
td.__new__(1)
td.__new__()
object.__new__(td)
object.__new__(T)
T.__new__(td)
isinstance(x, td)
issubclass(T, td)
T.__mro__
T.__base__
str(x)
td.__str__(x)
'''.strip().splitlines():
    t(src)

import weakref
t('type(weakref.ref(td(1))).__name__')
t('type(weakref.ref(x)).__name__')
class W(td):
    __slots__ = ('__weakref__',)
t('type(weakref.ref(W(1))).__name__')

print('--- float subclasses and as_integer_ratio')
class BadFloat(float):
    def as_integer_ratio(self): return 'x'
class BadFloat2(float):
    def as_integer_ratio(self): return (1, 2, 3)
class BadFloat3(float):
    def as_integer_ratio(self): return (7, 2)
class BadFloat4(float):
    def as_integer_ratio(self): raise KeyError('k')
class BadFloat5(float):
    def as_integer_ratio(self): return (1.5, 2)
class BadFloat6(float):
    def as_integer_ratio(self): return (1, 0)
for cls in [BadFloat, BadFloat2, BadFloat3, BadFloat4, BadFloat5, BadFloat6]:
    for src in ['td(1) * f', 'f * td(1)', 'td(1) / f']:
        t(src, f=cls(1.5))
class MulInt(int):
    def __mul__(self, other): return 'mul'
    def __rmul__(self, other): return 'rmul'
t('td(1) * MulInt(3)')
t('MulInt(3) * td(1)')
t('td(1) // MulInt(3)')
t('td(1) / MulInt(3)')
