import copy, pickle, sys, operator, os, time as _time
os.environ['TZ'] = 'UTC0'
_time.tzset()
from datetime import timedelta, date, datetime, time, timezone, MINYEAR, MAXYEAR

def t(src, **env):
    try:
        print(src, '=>', repr(eval(src, globals(), env)))
    except BaseException as e:
        print(src, '!!', type(e).__name__, e)
def block(text, **env):
    for src in text.strip().splitlines():
        t(src, **env)

class Idx:
    def __init__(self, v): self.v = v
    def __index__(self): return self.v
    def __repr__(self): return 'Idx(%d)' % self.v

print('--- constructor')
block('''
date(2000, 1, 1)
date(1, 1, 1)
date(9999, 12, 31)
date(year=2000, month=2, day=29)
date(2000, day=29, month=2)
date(2000, 2, day=29)
date(0, 1, 1)
date(10000, 1, 1)
date(-1, 1, 1)
date(2000, 0, 1)
date(2000, 13, 1)
date(2000, 1, 0)
date(2000, 1, 32)
date(2001, 2, 29)
date(2000, 2, 30)
date(1900, 2, 29)
date(2000, 4, 31)
date(2000, -1, 1)
date(2000, 1, -1)
date(2**31, 1, 1)
date(2**31 - 1, 1, 1)
date(-2**31 - 1, 1, 1)
date(2**63, 1, 1)
date(2000, 2**31, 1)
date(2000, 1, 2**100)
date(2000.0, 1, 1)
date(2000, 1.0, 1)
date('2000', 1, 1)
date(None, 1, 1)
date(2000, 1, None)
date(True, True, True)
date(Idx(2000), Idx(1), Idx(2))
date()
date(2000)
date(2000, 1)
date(2000, 1, 1, 1)
date(2000, 1, 1, foo=1)
date(2000, 1, year=2000)
date(2000, 1, 1, year=2000)
date(years=2000, month=1, day=1)
date(2000, 1, dy=1)
date(*[2000, 1, 1])
date(**dict(year=2000, month=1, day=1))
MINYEAR, MAXYEAR
date.min
date.max
date.resolution
type(date.min), type(date.resolution)
''')

print('--- attributes')
d = date(2024, 2, 29)
block('''
d.year, d.month, d.day
type(d.year)
date.year
type(date.year).__name__
date.year.__get__(d)
date.year.__get__(1)
setattr(d, 'year', 1)
setattr(d, 'foo', 1)
delattr(d, 'year')
d.__dict__
d.hour
d.tzinfo
bool(d), bool(date.min)
repr(d), str(d)
repr(date.min), str(date.min), repr(date.max), str(date.max)
format(d), format(d, ''), format(d, '%Y'), f'{d}', f'{d:%d/%m/%y}', f'{d!r}'
format(d, 1)
d.__format__()
d.__format__('')
d.__format__('%j')
d.__format__(None)
'%s %r' % (d, d)
''')

print('--- ordinals, weekdays, the ISO calendar')
for y, m, dd in [(1, 1, 1), (1, 1, 2), (1, 12, 31), (2, 1, 1), (4, 2, 29), (100, 3, 1), (400, 12, 31), (401, 1, 1), (1582, 10, 15), (1899, 12, 31), (1900, 3, 1), (1970, 1, 1), (1999, 12, 31), (2000, 2, 29), (2000, 12, 31), (2004, 12, 31), (2005, 1, 1), (2008, 12, 29), (2009, 12, 31), (2010, 1, 3), (2020, 12, 31), (2021, 1, 3), (2024, 12, 30), (2026, 12, 31), (9999, 12, 31), (9999, 1, 1)]:
    x = date(y, m, dd)
    print(x, x.toordinal(), x.weekday(), x.isoweekday(), x.isocalendar(), tuple(x.isocalendar()), x.ctime(), x.timetuple(), date.fromordinal(x.toordinal()) == x)
import itertools
bad = 0
for n in itertools.chain(range(1, 2000), range(146000, 146200), range(693500, 740000, 37), range(3652059 - 800, 3652060)):
    x = date.fromordinal(n)
    if x.toordinal() != n or date.fromisocalendar(*x.isocalendar()) != x or (x.weekday() + 1) != x.isoweekday() or x.isocalendar()[2] != x.isoweekday():
        bad += 1
print('bad', bad)
acc = 0
for n in range(1, 3652060, 97):
    x = date.fromordinal(n)
    c = x.isocalendar()
    acc = (acc * 31 + x.year * 372 + x.month * 31 + x.day + c[0] * 7 + c[1] * 3 + c[2]) % 1000000007
print(acc)
block('''
date.fromordinal(1)
date.fromordinal(3652059)
date.fromordinal(0)
date.fromordinal(-1)
date.fromordinal(3652060)
date.fromordinal(2**31)
date.fromordinal(2**64)
date.fromordinal(1.0)
date.fromordinal('1')
date.fromordinal()
date.fromordinal(1, 2)
date.fromordinal(ordinal=1)
date.fromordinal(True)
date.fromordinal(Idx(730120))
d.toordinal(1)
d.weekday(1)
d.isoweekday(1)
d.isocalendar(1)
date.toordinal(1)
date.weekday(datetime(2000, 1, 1))
''')

print('--- IsoCalendarDate')
c = d.isocalendar()
block('''
c
type(c)
type(c).__name__, type(c).__qualname__, type(c).__module__
type(c).__mro__
type(c).__base__
isinstance(c, tuple)
c.year, c.week, c.weekday
c[0], c[1], c[2], c[-1], c[:2]
len(c)
tuple(c)
list(c)
c == (2024, 9, 4)
(2024, 9, 4) == c
c < (2024, 9, 5)
c + (1,)
type(c + (1,))
c * 2
c.count(9), c.index(9)
c[3]
setattr(c, 'year', 1)
setattr(c, 'foo', 1)
c.__dict__
c.__reduce__()
pickle.loads(pickle.dumps(c))
type(pickle.loads(pickle.dumps(c)))
copy.copy(c), type(copy.copy(c))
copy.deepcopy(c), type(copy.deepcopy(c))
type(c)(1, 2, 3)
type(c)(year=1, week=2, weekday=3)
type(c)(1, 2)
type(c)(1, 2, 3, 4)
type(c)('a', 2, 3)
type(c)(1.5, 2, 3)
type(c)((1, 2, 3))
type(c)(2**31, 2, 3)
repr(type(c)(-1, 0, 99))
str(c)
'%d %d %d' % c
(lambda y, w, wd: (y, w, wd))(*c)
sorted(vars(type(c)))
type(type(c).year).__name__
type(c).year.__get__(c)
''')
try:
    class Sub(type(c)): pass
    print('subclass allowed', Sub(1, 2, 3))
except TypeError as e:
    print('TypeError', e)
y, w, wd = c
print(y, w, wd)
match c:
    case (a, b, cc): print('matched', a, b, cc)

print('--- fromisocalendar')
block('''
date.fromisocalendar(2024, 9, 4)
date.fromisocalendar(year=2024, week=9, day=4)
date.fromisocalendar(2004, 53, 7)
date.fromisocalendar(2005, 53, 1)
date.fromisocalendar(2020, 53, 7)
date.fromisocalendar(2021, 53, 1)
date.fromisocalendar(2021, 0, 1)
date.fromisocalendar(2021, 54, 1)
date.fromisocalendar(2021, -1, 1)
date.fromisocalendar(2021, 1, 0)
date.fromisocalendar(2021, 1, 8)
date.fromisocalendar(2021, 1, -1)
date.fromisocalendar(0, 1, 1)
date.fromisocalendar(10000, 1, 1)
date.fromisocalendar(1, 1, 1)
date.fromisocalendar(9999, 52, 5)
date.fromisocalendar(9999, 52, 6)
date.fromisocalendar(9999, 52, 7)
date.fromisocalendar(9999, 53, 1)
date.fromisocalendar(2**31, 1, 1)
date.fromisocalendar(2021, 2**31, 1)
date.fromisocalendar(2021.0, 1, 1)
date.fromisocalendar('2021', 1, 1)
date.fromisocalendar(2021, 1)
date.fromisocalendar(2021, 1, 1, 1)
date.fromisocalendar(None, 1, 1)
datetime.fromisocalendar(2024, 9, 4)
''')

print('--- fromtimestamp, today')
block('''
date.fromtimestamp(0)
date.fromtimestamp(86399)
date.fromtimestamp(86400)
date.fromtimestamp(-1)
date.fromtimestamp(-86400)
date.fromtimestamp(-86401)
date.fromtimestamp(0.9)
date.fromtimestamp(-0.1)
date.fromtimestamp(86399.999999)
date.fromtimestamp(1e9)
date.fromtimestamp(1700000000)
date.fromtimestamp(253402300799)
date.fromtimestamp(253402300800)
date.fromtimestamp(-62135596800)
date.fromtimestamp(-62135596801)
date.fromtimestamp(1e20)
date.fromtimestamp(-1e20)
date.fromtimestamp(1e300)
date.fromtimestamp(2**63)
date.fromtimestamp(2**63 - 1)
date.fromtimestamp(-2**63)
date.fromtimestamp(10**30)
date.fromtimestamp(float('nan'))
date.fromtimestamp(float('inf'))
date.fromtimestamp(float('-inf'))
date.fromtimestamp(None)
date.fromtimestamp('0')
date.fromtimestamp(1j)
date.fromtimestamp()
date.fromtimestamp(0, 0)
date.fromtimestamp(timestamp=0)
date.fromtimestamp(True)
date.fromtimestamp(Idx(86400))
type(date.today())
date.today() == date.fromtimestamp(_time.time()) or date.today() == date.fromtimestamp(_time.time())
date.today(1)
''')
from fractions import Fraction
from decimal import Decimal
t('date.fromtimestamp(Fraction(3, 2))')
t('date.fromtimestamp(Decimal("86400.5"))')

print('--- replace')
block('''
d.replace()
d.replace() is d
d.replace() == d
d.replace(2023, 3, 1)
d.replace(year=2020)
d.replace(year=2023)
d.replace(month=3)
d.replace(day=1)
d.replace(day=30)
d.replace(2020, day=1)
d.replace(None)
d.replace(year=None)
d.replace(1, 2, 3, 4)
d.replace(foo=1)
d.replace(hour=1)
d.replace(2020, year=2021)
d.replace(year=0)
d.replace(month=13)
d.replace(year=2.0)
d.replace(year='x')
d.__replace__(year=2020)
d.__replace__(2020)
d.__replace__()
copy.replace(d, year=2020, day=1)
copy.replace(d, foo=1)
date.replace(1)
date.replace(d, 2020)
''')

print('--- isoformat, ctime, timetuple')
block('''
d.isoformat()
d.isoformat(1)
date(1, 2, 3).isoformat()
date(999, 12, 31).isoformat()
date(1, 2, 3).ctime()
d.ctime()
d.ctime(1)
date(2024, 1, 1).ctime()
date(2024, 10, 10).ctime()
d.timetuple()
type(d.timetuple())
d.timetuple().tm_yday, d.timetuple().tm_isdst, d.timetuple().tm_wday
d.timetuple().tm_zone, d.timetuple().tm_gmtoff
date(2023, 12, 31).timetuple()
date(2024, 12, 31).timetuple()
date(1, 1, 1).timetuple()
d.timetuple(1)
d.__str__()
d.__repr__()
date.__str__(1)
date.isoformat(datetime(2000, 1, 2, 3, 4))
date.__str__(datetime(2000, 1, 2, 3, 4))
date.__repr__(datetime(2000, 1, 2, 3, 4))
date.ctime(datetime(2000, 1, 2, 3, 4))
date.timetuple(datetime(2000, 1, 2, 3, 4))
''')

print('--- arithmetic')
def show(name, f, a, b):
    try:
        print(repr(a), name, repr(b), '=>', repr(f(a, b)))
    except BaseException as e:
        print(repr(a), name, repr(b), '!!', type(e).__name__, e)
dates = [date(1, 1, 1), date(1, 1, 2), date(2000, 2, 28), date(2000, 3, 1), date(2024, 2, 29), date(9999, 12, 30), date(9999, 12, 31)]
deltas = [timedelta(0), timedelta(1), timedelta(-1), timedelta(0, 1), timedelta(0, 86399, 999999), timedelta(-1, 1), timedelta(microseconds=-1), timedelta(365), timedelta(-366), timedelta(3652058), timedelta(-3652058), timedelta(3652059), timedelta.max, timedelta.min, timedelta(1, 43200)]
for a in dates:
    for b in deltas:
        show('+', operator.add, a, b)
        show('+', operator.add, b, a)
        show('-', operator.sub, a, b)
        show('-', operator.sub, b, a)
    for b in dates:
        show('-', operator.sub, a, b)
        show('+', operator.add, a, b)
for b in [0, 1, 1.0, None, 'x', (), time(0), datetime(2000, 1, 1), datetime(2000, 1, 1, tzinfo=timezone.utc), timezone.utc]:
    for name, f in [('+', operator.add), ('-', operator.sub), ('*', operator.mul), ('/', operator.truediv)]:
        show(name, f, d, b)
        show(name, f, b, d)
block('''
d.__add__(timedelta(1))
d.__add__(1)
d.__radd__(timedelta(1))
d.__radd__(1)
d.__sub__(timedelta(1))
d.__sub__(d)
d.__sub__(1)
d.__rsub__(d)
d.__rsub__(timedelta(1))
d.__rsub__(1)
date.__add__(1, d)
date.__add__(timedelta(1), d)
date.__sub__(timedelta(1), d)
date.__add__(d, d)
-d
abs(d)
int(d)
''')

print('--- comparison')
class Anything:
    def __eq__(self, other): return True
    def __ne__(self, other): return False
    def __lt__(self, other): return 'lt'
    def __gt__(self, other): return 'gt'
    def __le__(self, other): return 'le'
    def __ge__(self, other): return 'ge'
    def __repr__(self): return 'Anything()'
class HasTimetuple:
    def timetuple(self): return ()
    def __repr__(self): return 'HasTimetuple()'
cmps = [('==', operator.eq), ('!=', operator.ne), ('<', operator.lt), ('<=', operator.le), ('>', operator.gt), ('>=', operator.ge)]
for name, f in cmps:
    for a in [date(2000, 1, 1), date(2000, 1, 2), date(2000, 2, 1), date(2001, 1, 1), date(1999, 12, 31)]:
        for b in [date(2000, 1, 1), date(2000, 1, 2), date(2000, 2, 1), date(2001, 1, 1), date(1999, 12, 31), datetime(2000, 1, 1), datetime(2000, 1, 1, 1), datetime(2000, 1, 1, tzinfo=timezone.utc), 0, 730120, None, 'x', (2000, 1, 1), timedelta(1), time(0), Anything(), HasTimetuple()]:
            show(name, f, a, b)
            if type(b) is not date:
                show(name, f, b, a)
block('''
d.__eq__(d)
d.__eq__(1)
d.__eq__(datetime(2024, 2, 29))
d.__lt__(datetime(2024, 2, 29))
d.__ne__(None)
d.__lt__(d)
d.__le__(d)
date.__eq__(1, d)
date.__eq__(datetime(2024, 2, 29), d)
date.__eq__(datetime(2024, 2, 29), datetime(2024, 2, 29))
date.__lt__(datetime(2024, 2, 29), datetime(2024, 2, 29, 1))
hash(d) == hash(date(2024, 2, 29))
hash(d) == hash(d.replace())
{d: 1}[date(2024, 2, 29)]
len({date.fromordinal(i) for i in range(1, 500)})
type(hash(d))
date.__hash__(1)
d in [d], d in {d}, d in (1, 2)
sorted([date(2000, 1, 3), date(2000, 1, 1), date(1999, 1, 2)])
min(date.min, date.max), max(date.min, date.max)
''')

print('--- subclass')
class D(date):
    pass
class E(date):
    def __new__(cls, *args, extra=7, **kw):
        self = super().__new__(cls, *args, **kw)
        self.extra = extra
        return self
class F(date):
    __slots__ = ()
class G(date):
    calls = []
    def __init__(self, *args, **kw):
        G.calls.append((args, kw))
x = D(2024, 2, 29)
x.foo = 1
block('''
x, type(x).__name__, x.__dict__
repr(x), str(x)
type(x + timedelta(1)).__name__
type(timedelta(1) + x).__name__
type(x - timedelta(1)).__name__
type(x - x).__name__
type(x.replace(year=2020)).__name__
x.replace(year=2020).__dict__
type(copy.replace(x, year=2020)).__name__
type(D.fromordinal(1)).__name__
type(D.fromtimestamp(0)).__name__
type(D.today()).__name__
type(D.fromisoformat('2020-01-01')).__name__
type(D.fromisocalendar(2020, 1, 1)).__name__
type(D.strptime('2020-01-01', '%Y-%m-%d')).__name__
type(D.min).__name__
x == d, d == x, hash(x) == hash(d), x < date.max, x - d
type(copy.copy(x)).__name__, copy.copy(x).__dict__
type(copy.deepcopy(x)).__name__, copy.deepcopy(x).__dict__
x.__reduce__()
x.__reduce_ex__(4)
type(pickle.loads(pickle.dumps(x))).__name__, pickle.loads(pickle.dumps(x)).__dict__
E(2020, 1, 1).extra
E(2020, 1, 1, extra=9).extra
E.fromordinal(1).extra
E.fromtimestamp(0).extra
E.fromisoformat('2020-01-01').extra
E.fromisocalendar(2020, 1, 1).extra
E.today().extra
(E(2020, 1, 1, extra=9) + timedelta(1)).extra
E(2020, 1, 1, extra=9).replace(year=2021).extra
setattr(F(2020, 1, 1), 'foo', 1)
F(2020, 1, 1).__dict__
G(2020, 1, 1), G.calls
G.fromordinal(1), G.calls
G(2020, 1, 1) + timedelta(1), G.calls
date.__new__(D, 2020, 1, 1)
date.__new__(date, 2020, 1, 1)
date.__new__(datetime, 2020, 1, 1)
date.__new__(int, 2020, 1, 1)
date.__new__(D)
object.__new__(date)
object.__new__(D)
D.__mro__
isinstance(datetime(2000, 1, 1), date), issubclass(datetime, date)
''')
import weakref
t('type(weakref.ref(d)).__name__')
t('type(weakref.ref(x)).__name__')

print('--- pickles')
for v in [date(1, 1, 1), date(2024, 2, 29), date(9999, 12, 31)]:
    print(v.__reduce__(), v.__reduce_ex__(0), v.__reduce_ex__(2), v.__reduce_ex__(5))
    for proto in range(pickle.HIGHEST_PROTOCOL + 1):
        s = pickle.dumps(v, proto)
        print(proto, s, pickle.loads(s) == v)
    print(copy.copy(v) is v, copy.deepcopy(v) is v, copy.copy(v) == v)
block('''
date(b'\\x07\\xd0\\x01\\x01')
date(b'\\x07\\xd0\\x0c\\x1f')
date(b'\\x07\\xd0\\x0d\\x01')
date(b'\\x07\\xd0\\x00\\x01')
date(b'\\x07\\xd0\\x01')
date(b'\\x07\\xd0\\x01\\x01\\x01')
date(b'')
date(bytearray(b'\\x07\\xd0\\x01\\x01'))
date('\\x07\\xd0\\x01\\x01')
date('\\x07\\u0100\\x01\\x01')
date('\\x07\\xd0\\x0d\\x01')
date('abcd')
date(b'\\x07\\xd0\\x01\\x01', 1)
date(b'\\x07\\xd0\\x01\\x01', 1, 1)
date(year=b'\\x07\\xd0\\x01\\x01')
D(b'\\x07\\xd0\\x01\\x01')
''')
