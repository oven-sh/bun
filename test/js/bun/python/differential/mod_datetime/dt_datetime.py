import copy, pickle, sys, operator, os, time as _time
os.environ['TZ'] = 'UTC0'
_time.tzset()
from datetime import timedelta, date, datetime, time, timezone, tzinfo
from fractions import Fraction
from decimal import Decimal

def t(src, **env):
    try:
        print(src, '=>', repr(eval(src, globals(), env)))
    except BaseException as e:
        print(src, '!!', type(e).__name__, e)
def block(text, **env):
    for src in text.strip().splitlines():
        t(src, **env)
def show(name, f, a, b):
    try:
        print(repr(a), name, repr(b), '=>', repr(f(a, b)))
    except BaseException as e:
        print(repr(a), name, repr(b), '!!', type(e).__name__, e)

class Idx:
    def __init__(self, v): self.v = v
    def __index__(self): return self.v
    def __repr__(self): return 'Idx(%d)' % self.v
class Fixed(tzinfo):
    def __init__(self, minutes, name='fixed', dst=None):
        self.minutes, self.name, self._dst = minutes, name, dst
    def utcoffset(self, dt): return None if self.minutes is None else timedelta(minutes=self.minutes)
    def tzname(self, dt): return self.name
    def dst(self, dt): return self._dst
    def __repr__(self): return 'Fixed(%r, %r)' % (self.minutes, self.name)
utc = timezone.utc
td = timedelta

print('--- constructor')
block('''
datetime(2000, 1, 1)
datetime(2000, 1, 2, 3)
datetime(2000, 1, 2, 3, 4)
datetime(2000, 1, 2, 3, 4, 5)
datetime(2000, 1, 2, 3, 4, 5, 6)
datetime(2000, 1, 2, 3, 4, 5, 6, None)
datetime(2000, 1, 2, 3, 4, 5, 6, utc)
datetime(2000, 1, 2, 3, 4, 5, 6, utc, fold=1)
datetime(2000, 1, 2, fold=1)
datetime(year=2000, month=1, day=2, hour=3, minute=4, second=5, microsecond=6, tzinfo=utc, fold=1)
datetime(2000, 1, 2, tzinfo=utc)
datetime(2000, 1, 2, microsecond=6)
datetime(1, 1, 1), datetime(9999, 12, 31, 23, 59, 59, 999999)
datetime(0, 1, 1)
datetime(10000, 1, 1)
datetime(2000, 0, 1)
datetime(2000, 13, 1)
datetime(2000, 1, 0)
datetime(2000, 2, 30)
datetime(2001, 2, 29)
datetime(2000, 1, 1, 24)
datetime(2000, 1, 1, -1)
datetime(2000, 1, 1, 0, 60)
datetime(2000, 1, 1, 0, 0, 60)
datetime(2000, 1, 1, 0, 0, 0, 1000000)
datetime(2000, 1, 1, 0, 0, 0, -1)
datetime(2000, 1, 1, fold=2)
datetime(2000, 1, 1, fold=-1)
datetime(2000, 13, 32, 25, 61, 61, -1, 5, fold=3)
datetime(2000, 1, 1, 25, 61, 61, -1, 5, fold=3)
datetime(2000, 1, 1, 0, 0, 0, 0, 5, fold=3)
datetime(2000, 1, 1, 0, 0, 0, 0, 5)
datetime(2000, 1, 1, tzinfo='x')
datetime(2000, 1, 1, tzinfo=tzinfo)
datetime(2**31, 1, 1)
datetime(2000, 1, 1, 2**31)
datetime(2000, 1, 1, 0, 0, 0, 2**64)
datetime(2000.0, 1, 1)
datetime(2000, 1, 1, 1.0)
datetime('2000', 1, 1)
datetime(None, 1, 1)
datetime(2000, 1, 1, None)
datetime(True, True, True, True, True, True, True)
datetime(Idx(2000), Idx(1), Idx(2), Idx(3), Idx(4), Idx(5), Idx(6))
datetime()
datetime(2000)
datetime(2000, 1)
datetime(2000, 1, 1, 0, 0, 0, 0, None, 0)
datetime(2000, 1, 1, 0, 0, 0, 0, None, 0, 0)
datetime(2000, 1, 1, foo=1)
datetime(2000, 1, 1, hours=1)
datetime(2000, 1, 1, year=2000)
datetime(2000, 1, day=1, hour=1)
datetime(month=1, day=1)
datetime.min, datetime.max, datetime.resolution
type(datetime.min), type(datetime.resolution)
''')

print('--- attributes')
x = datetime(2024, 2, 29, 1, 2, 3, 4, utc, fold=1)
n = datetime(2024, 2, 29, 12, 34, 56, 789012)
block('''
x.year, x.month, x.day, x.hour, x.minute, x.second, x.microsecond, x.tzinfo, x.fold
n.year, n.month, n.day, n.hour, n.minute, n.second, n.microsecond, n.tzinfo, n.fold
type(datetime.hour).__name__, type(datetime.year).__name__, datetime.year is date.year
datetime.hour.__get__(x), datetime.year.__get__(x)
datetime.hour.__get__(date(2000, 1, 1))
setattr(x, 'hour', 1)
setattr(x, 'year', 1)
setattr(x, 'foo', 1)
x.__dict__
bool(x), bool(datetime.min)
x.date(), x.time(), x.timetz()
n.date(), n.time(), n.timetz()
type(x.date()), type(x.time()), type(x.timetz())
x.time().fold, x.timetz().fold, x.timetz().tzinfo
x.date(1)
x.time(1)
x.timetz(1)
x.toordinal(), x.weekday(), x.isoweekday(), x.isocalendar()
x.utcoffset(), x.dst(), x.tzname()
n.utcoffset(), n.dst(), n.tzname()
x.utcoffset(1)
datetime.utcoffset(1)
datetime.date(date(2000, 1, 1))
''')

print('--- repr, str, isoformat, ctime')
vals = [datetime(1, 1, 1), datetime(2000, 1, 2, 3), datetime(2000, 1, 2, 3, 4), datetime(2000, 1, 2, 3, 4, 5), datetime(2000, 1, 2, 3, 4, 5, 6), datetime(2000, 1, 2, 0, 0, 0, 6), datetime(2000, 1, 2, 0, 0, 5), datetime(999, 12, 31, 23, 59, 59, 999999),
        datetime(9999, 12, 31, 23, 59, 59, 999999), datetime(2000, 1, 2, fold=1), datetime(2000, 1, 2, 3, 4, 5, 6, fold=1), datetime(2000, 1, 2, tzinfo=utc), datetime(2000, 1, 2, 3, 4, 5, 6, utc, fold=1), datetime(2000, 1, 2, 3, 4, 5, 600000, timezone(td(hours=5, minutes=30))),
        datetime(2000, 1, 2, tzinfo=timezone(td(hours=-5))), datetime(2000, 1, 2, tzinfo=timezone(td(seconds=1))), datetime(2000, 1, 2, tzinfo=timezone(td(microseconds=-1))), datetime(2000, 1, 2, tzinfo=Fixed(90)), datetime(2000, 1, 2, tzinfo=Fixed(None)), datetime(2000, 1, 2, tzinfo=timezone(td(hours=1), 'X'))]
for v in vals:
    print(repr(v), '|', str(v), '|', v.isoformat(), '|', v.ctime(), '|', format(v), '|', v.isoformat(' '), '|', v.isoformat(sep='x'))
    for spec in ['auto', 'hours', 'minutes', 'seconds', 'milliseconds', 'microseconds']:
        print('   ', spec, v.isoformat('T', spec), v.isoformat(timespec=spec), v.isoformat(sep=' ', timespec=spec))
block('''
n.isoformat('')
n.isoformat('ab')
n.isoformat('\\xe9')
n.isoformat('\\u20ac')
n.isoformat('\\U0001f600')
n.isoformat('\\ud800')
n.isoformat('\\0')
n.isoformat(None)
n.isoformat(1)
n.isoformat(b'T')
n.isoformat('T', 'foo')
n.isoformat('T', None)
n.isoformat('T', 1)
n.isoformat('T', 'auto', 1)
n.isoformat(foo=1)
n.isoformat(timespec='')
n.isoformat(timespec='\\ud800')
n.isoformat(sep='T', timespec='hours')
n.ctime(1)
datetime.isoformat(1)
datetime.isoformat(date(2000, 1, 1))
datetime.__str__(date(2000, 1, 1))
n.__str__(), n.__repr__()
''')

print('--- combine')
block('''
datetime.combine(date(2000, 1, 2), time(3, 4, 5, 6))
datetime.combine(date(2000, 1, 2), time(3, 4, 5, 6, utc))
datetime.combine(date(2000, 1, 2), time(3, 4, 5, 6, utc, fold=1))
datetime.combine(date(2000, 1, 2), time(3, 4, 5, 6, utc), None)
datetime.combine(date(2000, 1, 2), time(3, 4, 5, 6), utc)
datetime.combine(date(2000, 1, 2), time(3, 4, 5, 6, utc), tzinfo=Fixed(60))
datetime.combine(date=date(2000, 1, 2), time=time(3))
datetime.combine(datetime(2000, 1, 2, 9, 9, 9, tzinfo=utc), time(3))
datetime.combine(date(2000, 1, 2), time(3), 1)
datetime.combine(date(2000, 1, 2), time(3), True)
datetime.combine(date(2000, 1, 2), datetime(2000, 1, 1))
datetime.combine(date(2000, 1, 2), 1)
datetime.combine(1, time(3))
datetime.combine(None, None)
datetime.combine(time(3), date(2000, 1, 2))
datetime.combine(date(2000, 1, 2))
datetime.combine()
datetime.combine(date(2000, 1, 2), time(3), None, 1)
datetime.combine(date(2000, 1, 2), time(3), foo=1)
x.combine(date(2000, 1, 2), time(3))
''')

print('--- timestamps')
stamps = [0, 1, -1, 0.5, -0.5, 0.000001, -0.000001, 0.0000005, 0.0000015, 0.0000025, -0.0000005, -0.0000015, 1e-7, -1e-7, 0.9999995, 0.9999994, 1.9999995, -0.9999995, 86399.999999, 86400, 1e9, 1234567890.123456, 1234567890.1234565, 1700000000.5, 2**31, 2**31 - 1, -2**31, -2**31 - 1, 2**32, 4102444800,
          253402300799, 253402300799.5, 253402300799.999999, 253402300799.9999995, 253402300800, -62135596800, -62135596800.5, -62135596801, -62135596799.5, 1e11, 1e12, 1e13, 1e15, 1e17, 1e18, 1e19, 1e20, -1e20, 1e300, 2**63, 2**63 - 1, -2**63, -2**63 - 1, 10**30, -10**30, float('nan'), float('inf'), float('-inf'),
          True, Idx(5), Fraction(3, 2), Decimal('1.5'), None, '0', 1j, [], b'0']
for s in stamps:
    for src in ['datetime.fromtimestamp(s)', 'datetime.fromtimestamp(s, utc)', 'datetime.fromtimestamp(s, tz=timezone(td(hours=5, minutes=30)))', 'datetime.fromtimestamp(s, Fixed(-90))']:
        try:
            print(repr(s), src, '=>', repr(eval(src)))
        except BaseException as e:
            print(repr(s), src, '!!', type(e).__name__, e)
import warnings
with warnings.catch_warnings(record=True) as w:
    warnings.simplefilter('always')
    for s in stamps:
        try:
            print(repr(s), 'utcfromtimestamp =>', repr(datetime.utcfromtimestamp(s)))
        except BaseException as e:
            print(repr(s), 'utcfromtimestamp !!', type(e).__name__, e)
    print(type(datetime.utcnow()), datetime.utcnow().tzinfo)
    print(len(w), sorted({(x.category.__name__, str(x.message)) for x in w}))
block('''
datetime.fromtimestamp()
datetime.fromtimestamp(0, None)
datetime.fromtimestamp(0, 1)
datetime.fromtimestamp(0, 'UTC')
datetime.fromtimestamp(0, utc, 1)
datetime.fromtimestamp(timestamp=0)
datetime.fromtimestamp(timestamp=0, tz=utc)
datetime.fromtimestamp(0, tzinfo=utc)
datetime.fromtimestamp(0, tz=tzinfo())
datetime.utcfromtimestamp()
datetime.utcfromtimestamp(0, 1)
datetime.utcfromtimestamp(timestamp=0)
''')
for v in [datetime(1970, 1, 1), datetime(1970, 1, 1, tzinfo=utc), datetime(1969, 12, 31, 23, 59, 59, 999999), datetime(2000, 1, 1, 0, 0, 0, 1), datetime(2024, 2, 29, 12, 34, 56, 789012), datetime(2024, 2, 29, 12, 34, 56, 789012, utc), datetime(2024, 2, 29, 12, tzinfo=Fixed(90)), datetime(2024, 2, 29, 12, tzinfo=Fixed(None)),
          datetime(1, 1, 1, tzinfo=utc), datetime(9999, 12, 31, 23, 59, 59, 999999, utc), datetime(1, 1, 1), datetime(1, 1, 2), datetime(9999, 12, 31, 23, 59, 59, 999999), datetime(1900, 1, 1), datetime(2038, 1, 19, 3, 14, 8), datetime(2000, 1, 1, fold=1), datetime(1, 1, 1, tzinfo=Fixed(60)), datetime(9999, 12, 31, 23, tzinfo=Fixed(-600))]:
    t('v.timestamp()', v=v)
    try:
        print('   round trip', datetime.fromtimestamp(v.timestamp(), v.tzinfo) == v)
    except BaseException as e:
        print('   round trip', type(e).__name__, e)
t('n.timestamp(1)')
t('datetime.timestamp(1)')

print('--- now')
block('''
type(datetime.now()), datetime.now().tzinfo
type(datetime.now(utc)), datetime.now(utc).tzinfo
datetime.now(None).tzinfo
datetime.now(tz=utc).tzinfo
datetime.now(tz=None).tzinfo
datetime.now(Fixed(90)).tzinfo, datetime.now(Fixed(90)).utcoffset()
datetime.now(1)
datetime.now('UTC')
datetime.now(utc, 1)
datetime.now(tzinfo=utc)
datetime.now(tzinfo())
abs(datetime.now().timestamp() - _time.time()) < 5
abs(datetime.now(utc).timestamp() - _time.time()) < 5
abs((datetime.now(Fixed(90)) - datetime.now(utc)).total_seconds()) < 5
abs((datetime.now(Fixed(90)).replace(tzinfo=None) - datetime.now()).total_seconds() - 5400) < 5
type(datetime.today()), datetime.today().tzinfo
datetime.now() <= datetime.now()
''')

print('--- timetuple, utctimetuple')
for v in vals + [datetime(2000, 1, 1, tzinfo=Fixed(60, dst=td(0))), datetime(2000, 1, 1, tzinfo=Fixed(60, dst=td(hours=1))), datetime(2000, 1, 1, tzinfo=Fixed(60, dst=td(hours=-1))), datetime(2000, 1, 1, 0, 30, tzinfo=Fixed(60)), datetime(2000, 12, 31, 23, 30, tzinfo=Fixed(-60)),
                 datetime(1, 1, 1, tzinfo=Fixed(60)), datetime(9999, 12, 31, 23, 59, tzinfo=Fixed(-60)), datetime(1, 1, 1, 1, tzinfo=Fixed(60))]:
    t('v.timetuple()', v=v)
    t('v.utctimetuple()', v=v)
t('n.timetuple(1)')
t('n.utctimetuple(1)')
t('type(n.timetuple()), n.timetuple().tm_zone, n.timetuple().tm_gmtoff')
t('_time.mktime(n.timetuple())')
t('_time.strftime("%Y %j", n.timetuple())')

print('--- replace')
block('''
x.replace()
x.replace() is x, x.replace() == x, x.replace().fold
x.replace(2020)
x.replace(2020, 3, 4, 5, 6, 7, 8)
x.replace(2020, 3, 4, 5, 6, 7, 8, None)
x.replace(2020, 3, 4, 5, 6, 7, 8, None, fold=0)
x.replace(year=2020), x.replace(month=3), x.replace(day=1), x.replace(hour=5), x.replace(minute=5), x.replace(second=5), x.replace(microsecond=5)
x.replace(tzinfo=None), x.replace(tzinfo=Fixed(60)), x.replace(fold=0), n.replace(fold=1), n.replace(tzinfo=utc)
x.replace(year=2023)
x.replace(month=13)
x.replace(day=30)
x.replace(hour=24)
x.replace(minute=60)
x.replace(second=60)
x.replace(microsecond=-1)
x.replace(fold=2)
x.replace(tzinfo=1)
x.replace(tzinfo=True)
x.replace(year=None)
x.replace(hour=None)
x.replace(hour=1.0)
x.replace(foo=1)
x.replace(2020, year=2020)
x.replace(2020, 3, 4, 5, 6, 7, 8, None, 0)
x.__replace__(year=2020)
x.__replace__(2020)
copy.replace(x, year=2020, fold=0, tzinfo=None)
copy.replace(x, foo=1)
datetime.replace(1)
datetime.replace(date(2000, 1, 1))
date.replace(x, 2020)
''')

print('--- arithmetic')
dts = [datetime(1, 1, 1), datetime(1, 1, 1, 0, 0, 0, 1), datetime(2000, 2, 28, 23, 59, 59, 999999), datetime(2000, 3, 1), datetime(2024, 2, 29, 12), datetime(9999, 12, 31), datetime(9999, 12, 31, 23, 59, 59, 999999), datetime(2000, 1, 1, tzinfo=utc), datetime(2000, 1, 1, 12, tzinfo=Fixed(90)), datetime(2000, 1, 1, tzinfo=Fixed(None)), datetime(2000, 1, 1, fold=1), datetime(2000, 1, 1, tzinfo=Fixed(-600), fold=1)]
deltas = [td(0), td(1), td(-1), td(0, 1), td(0, 0, 1), td(microseconds=-1), td(0, 86399, 999999), td(365), td(-366), td(3652058), td(-3652058), td(3652058, 86399, 999999), td(3652059), td.max, td.min, td(1, 43200, 500000), td(hours=-25, microseconds=7)]
for a in dts:
    for b in deltas:
        show('+', operator.add, a, b)
        show('+', operator.add, b, a)
        show('-', operator.sub, a, b)
        show('-', operator.sub, b, a)
    for b in dts:
        show('-', operator.sub, a, b)
        show('+', operator.add, a, b)
for b in [0, 1, 1.0, None, 'x', (), time(0), date(2000, 1, 1), utc]:
    for name, f in [('+', operator.add), ('-', operator.sub), ('*', operator.mul)]:
        show(name, f, n, b)
        show(name, f, b, n)
block('''
(x + td(1)).fold, (x - td(0)).fold, (x + td(0)).tzinfo
n.__add__(td(1)), n.__radd__(td(1)), n.__sub__(td(1)), n.__sub__(n)
n.__add__(1), n.__radd__(1), n.__sub__(1), n.__rsub__(1), n.__rsub__(td(1))
n.__rsub__(n)
n.__rsub__(date(2000, 1, 1))
n.__sub__(date(2000, 1, 1))
datetime.__add__(td(1), n)
datetime.__add__(1, n)
datetime.__sub__(td(1), n)
datetime.__add__(date(2000, 1, 1), td(1))
date.__add__(n, td(1))
date.__sub__(n, n)
date.__sub__(n, td(1))
date.__sub__(n, date(2000, 1, 1))
''')
class RaisingOffset(tzinfo):
    def utcoffset(self, dt): raise KeyError('offset')
r = datetime(2000, 1, 1, tzinfo=RaisingOffset())
block('''
r - r
r - datetime(2000, 1, 1, tzinfo=utc)
r == r
r == datetime(2000, 1, 1, tzinfo=utc)
r == datetime(2000, 1, 1)
r < datetime(2000, 1, 1, tzinfo=utc)
hash(r)
r + td(1) is not None
str(r)
r.timestamp()
r.astimezone(utc)
r.utctimetuple()
''')

print('--- comparison and hash')
cmps = [('==', operator.eq), ('!=', operator.ne), ('<', operator.lt), ('<=', operator.le), ('>', operator.gt), ('>=', operator.ge)]
class Anything:
    def __eq__(self, other): return True
    def __ne__(self, other): return False
    def __lt__(self, other): return 'lt'
    def __gt__(self, other): return 'gt'
    def __le__(self, other): return 'le'
    def __ge__(self, other): return 'ge'
    def __repr__(self): return 'Anything()'
cv = [datetime(2000, 1, 1), datetime(2000, 1, 1, 0, 0, 0, 1), datetime(2000, 1, 1, 1), datetime(2000, 1, 2), datetime(1999, 12, 31, 23, 59, 59, 999999), datetime(2000, 1, 1, fold=1), datetime(2000, 1, 1, tzinfo=utc), datetime(2000, 1, 1, 1, tzinfo=Fixed(60)), datetime(2000, 1, 1, 1, tzinfo=utc),
      datetime(1999, 12, 31, 23, tzinfo=Fixed(-60)), datetime(2000, 1, 1, tzinfo=Fixed(None)), datetime(2000, 1, 1, tzinfo=utc, fold=1), datetime(2000, 1, 1, tzinfo=timezone(td(microseconds=1))), datetime(1, 1, 1, tzinfo=Fixed(600)), datetime(9999, 12, 31, 23, tzinfo=Fixed(-600))]
for name, f in cmps:
    for a in cv:
        for b in cv:
            show(name, f, a, b)
        for b in [0, None, 'x', (), td(0), time(0), Anything()]:
            show(name, f, a, b)
            show(name, f, b, a)
for a in cv:
    for b in cv:
        try:
            if a == b:
                print(repr(a), repr(b), 'equal; hashes equal:', hash(a) == hash(b))
        except Exception as e:
            print(type(e).__name__, e)
block('''
n.__eq__(n), n.__eq__(1), n.__lt__(1), n.__ne__(None), n.__eq__(date(2024, 2, 29)), n.__lt__(date(2024, 2, 29))
datetime.__eq__(1, n)
datetime.__eq__(date(2000, 1, 1), n)
datetime.__hash__(1)
datetime.__hash__(date(2000, 1, 1))
type(hash(n)), type(hash(x))
hash(datetime(2000, 1, 1)) == hash(date(2000, 1, 1))
hash(datetime(2000, 1, 1, fold=1)) == hash(datetime(2000, 1, 1))
hash(datetime(1, 1, 1, tzinfo=Fixed(600))) == hash(datetime(1, 1, 1, tzinfo=Fixed(600)))
hash(datetime(9999, 12, 31, 23, tzinfo=Fixed(-600))) == hash(datetime(9999, 12, 31, 23, tzinfo=Fixed(-600)))
{datetime(2000, 1, 1): 1}[datetime(2000, 1, 1, fold=1)]
{datetime(2000, 1, 1, tzinfo=utc): 1}[datetime(2000, 1, 1, 1, tzinfo=Fixed(60))]
len({datetime(2000, 1, 1) + td(seconds=i) for i in range(1000)})
sorted([datetime(2000, 1, 3), datetime(2000, 1, 1), datetime(2000, 1, 2)])
sorted([datetime(2000, 1, 1, 3, tzinfo=utc), datetime(2000, 1, 1, 1, tzinfo=Fixed(-180)), datetime(2000, 1, 1, 2, tzinfo=Fixed(60))])
min(datetime.min, datetime.max), max(datetime.min, datetime.max)
''')

print('--- astimezone')
for v in [datetime(2000, 1, 1, 12, tzinfo=utc), datetime(2000, 1, 1, 12, tzinfo=Fixed(90)), datetime(2000, 1, 1, 12), datetime(2000, 1, 1, 12, fold=1), datetime(2000, 1, 1, 12, tzinfo=Fixed(None)), datetime(1, 1, 1, tzinfo=utc), datetime(9999, 12, 31, 23, 59, 59, 999999, utc), datetime(1, 1, 1), datetime(9999, 12, 31, 23), datetime(1970, 1, 1), datetime(1900, 1, 1, tzinfo=utc)]:
    for z in ['utc', 'Fixed(90)', 'Fixed(-600)', 'timezone(td(hours=14))', 'timezone(td(hours=-14))', 'None', 'v.tzinfo', 'Fixed(None)']:
        src = 'v.astimezone(%s)' % z
        try:
            r = eval(src)
            print(repr(v), src, '=>', repr(r), r.tzname(), r.utcoffset(), r is v)
        except BaseException as e:
            print(repr(v), src, '!!', type(e).__name__, e)
    try:
        r = v.astimezone()
        print(repr(v), 'astimezone()', repr(r), r.tzname(), r.utcoffset())
    except BaseException as e:
        print(repr(v), 'astimezone() !!', type(e).__name__, e)
block('''
n.astimezone(1)
n.astimezone('UTC')
n.astimezone(utc, 1)
n.astimezone(tz=utc)
n.astimezone(tzinfo=utc)
n.astimezone(tzinfo())
x.astimezone(utc) is x
x.astimezone(timezone(td(0), 'x')) is x
datetime.astimezone(1)
''')
class OwnFromUtc(tzinfo):
    def utcoffset(self, dt): return td(hours=1)
    def fromutc(self, dt): return 'whatever fromutc returns: %r' % (dt.replace(tzinfo=None),)
t('x.astimezone(OwnFromUtc())')

print('--- subclass')
class D(datetime): pass
class E(datetime):
    def __new__(cls, *args, extra=7, **kw):
        self = super().__new__(cls, *args, **kw)
        self.extra = extra
        return self
y = D(2024, 2, 29, 1, 2, 3, 4, utc, fold=1)
y.foo = 1
block('''
y, type(y).__name__, y.__dict__
repr(y), str(y)
type(y + td(1)).__name__, type(td(1) + y).__name__, type(y - td(1)).__name__, type(y - y).__name__
(y + td(1)).__dict__
type(y.replace(year=2020)).__name__, y.replace(year=2020).__dict__, y.replace(year=2020).fold
type(copy.replace(y, year=2020)).__name__
type(y.astimezone(Fixed(60))).__name__
type(y.astimezone(utc)).__name__
type(y.astimezone()).__name__
type(y.date()).__name__, type(y.time()).__name__, type(y.timetz()).__name__
type(D.now()).__name__, type(D.now(utc)).__name__, type(D.now(Fixed(60))).__name__, type(D.today()).__name__
type(D.fromtimestamp(0)).__name__, type(D.fromtimestamp(0, utc)).__name__, type(D.fromtimestamp(0, Fixed(60))).__name__
type(D.fromordinal(1)).__name__, D.fromordinal(730120)
type(D.fromisoformat('2020-01-01T00:00')).__name__
type(D.fromisocalendar(2020, 1, 1)).__name__
type(D.combine(date(2000, 1, 1), time(1))).__name__
type(D.strptime('2020', '%Y')).__name__
type(D.min).__name__
y == x, x == y, hash(y) == hash(x), y - x
type(copy.copy(y)).__name__, copy.copy(y).__dict__, copy.copy(y).fold
type(copy.deepcopy(y)).__name__, copy.deepcopy(y).__dict__
y.__reduce__()
y.__reduce_ex__(2)
y.__reduce_ex__(3)
type(pickle.loads(pickle.dumps(y))).__name__, pickle.loads(pickle.dumps(y)).fold
E(2020, 1, 1).extra, E(2020, 1, 1, extra=9).extra
(E(2020, 1, 1, extra=9) + td(1)).extra
E(2020, 1, 1, extra=9).replace(year=2021).extra
E(2020, 1, 1, fold=1, extra=9).replace(year=2021).fold
E.now().extra, E.now(utc).extra, E.today().extra, E.fromtimestamp(0).extra, E.fromtimestamp(0, utc).extra, E.fromordinal(1).extra
E.fromisoformat('2020-01-01').extra, E.fromisocalendar(2020, 1, 1).extra, E.combine(date(2000, 1, 1), time(1)).extra, E.strptime('2020', '%Y').extra
E(2020, 1, 1, tzinfo=utc, extra=9).astimezone(Fixed(60)).extra
E.combine(date(2000, 1, 1), time(1, fold=1)).fold
datetime.__new__(D, 2020, 1, 1)
datetime.__new__(date, 2020, 1, 1)
datetime.__new__(int, 2020, 1, 1)
object.__new__(datetime)
D.__mro__
''')
import weakref
t('type(weakref.ref(x)).__name__')
t('type(weakref.ref(y)).__name__')
with warnings.catch_warnings():
    warnings.simplefilter('ignore')
    t('type(D.utcnow()).__name__, type(D.utcfromtimestamp(0)).__name__, E.utcnow().extra, E.utcfromtimestamp(0).extra')

print('--- pickles')
for v in [datetime(1, 1, 1), datetime(2024, 2, 29, 1, 2, 3, 4), datetime(9999, 12, 31, 23, 59, 59, 999999), datetime(2000, 1, 1, fold=1), datetime(2000, 12, 1, fold=1), datetime(2000, 1, 2, 3, 4, 5, 6, utc), datetime(2000, 1, 2, 3, 4, 5, 6, utc, fold=1), datetime(2000, 1, 1, tzinfo=timezone(td(hours=1), 'X'))]:
    print(v.__reduce__(), [v.__reduce_ex__(p) for p in range(6)])
    for proto in range(pickle.HIGHEST_PROTOCOL + 1):
        s = pickle.dumps(v, proto)
        w = pickle.loads(s)
        print(proto, s if proto < 4 or v.tzinfo is None else len(s) > 0, w == v, w.fold, w.tzinfo)
    print(copy.copy(v) is v, copy.deepcopy(v) is v, copy.copy(v) == v, copy.copy(v).fold, copy.deepcopy(v).tzinfo is v.tzinfo)
block('''
datetime(b'\\x07\\xd0\\x01\\x02\\x03\\x04\\x05\\x00\\x00\\x06')
datetime(b'\\x07\\xd0\\x81\\x02\\x03\\x04\\x05\\x00\\x00\\x06')
datetime(b'\\x07\\xd0\\x8c\\x02\\x03\\x04\\x05\\x00\\x00\\x06')
datetime(b'\\x07\\xd0\\x0d\\x02\\x03\\x04\\x05\\x00\\x00\\x06')
datetime(b'\\x07\\xd0\\x8d\\x02\\x03\\x04\\x05\\x00\\x00\\x06')
datetime(b'\\x07\\xd0\\x00\\x02\\x03\\x04\\x05\\x00\\x00\\x06')
datetime(b'\\x07\\xd0\\x80\\x02\\x03\\x04\\x05\\x00\\x00\\x06')
datetime(b'\\x07\\xd0\\x01\\x02\\x03\\x04\\x05\\x00\\x00\\x06', None)
datetime(b'\\x07\\xd0\\x01\\x02\\x03\\x04\\x05\\x00\\x00\\x06', utc)
datetime(b'\\x07\\xd0\\x01\\x02\\x03\\x04\\x05\\x00\\x00\\x06', 1)
datetime(b'\\x07\\xd0\\x01\\x02\\x03\\x04\\x05\\x00\\x00\\x06', utc, 1)
datetime(b'\\x07\\xd0\\x01\\x02\\x03\\x04\\x05\\x00\\x00\\x06', tzinfo=utc)
datetime(b'\\x07\\xd0\\x01\\x02\\x03\\x04\\x05\\x00\\x00')
datetime(b'\\x07\\xd0\\x01\\x02\\x03\\x04\\x05\\x00\\x00\\x06\\x07')
datetime(b'')
datetime('\\x07\\xd0\\x01\\x02\\x03\\x04\\x05\\x00\\x00\\x06')
datetime('\\x07\\xd0\\x81\\x02\\x03\\x04\\x05\\x00\\x00\\x06')
datetime('\\x07\\u0100\\x01\\x02\\x03\\x04\\x05\\x00\\x00\\x06')
datetime('\\x07\\xd0\\x0d\\x02\\x03\\x04\\x05\\x00\\x00\\x06')
datetime('abcdefghij')
datetime(bytearray(b'\\x07\\xd0\\x01\\x02\\x03\\x04\\x05\\x00\\x00\\x06'))
D(b'\\x07\\xd0\\x01\\x02\\x03\\x04\\x05\\x00\\x00\\x06', utc)
''')
