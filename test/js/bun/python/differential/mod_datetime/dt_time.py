import copy, pickle, sys, operator
from datetime import timedelta, date, datetime, time, timezone, tzinfo

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
print('--- constructor')
block('''
time()
time(0)
time(1)
time(1, 2)
time(1, 2, 3)
time(1, 2, 3, 4)
time(1, 2, 3, 4, None)
time(1, 2, 3, 4, utc)
time(1, 2, 3, 4, utc, fold=1)
time(1, 2, 3, 4, fold=1)
time(fold=1)
time(fold=0)
time(hour=1, minute=2, second=3, microsecond=4, tzinfo=utc, fold=1)
time(23, 59, 59, 999999)
time(24)
time(-1)
time(0, 60)
time(0, -1)
time(0, 0, 60)
time(0, 0, -1)
time(0, 0, 0, 1000000)
time(0, 0, 0, -1)
time(fold=2)
time(fold=-1)
time(2**31)
time(0, 2**31)
time(0, 0, 0, 2**63)
time(1.0)
time('1')
time(None)
time(0, None)
time(True, True, True, True)
time(Idx(1), Idx(2), Idx(3), Idx(4))
time(fold=True)
time(fold=None)
time(fold=1.0)
time(tzinfo=1)
time(tzinfo='UTC')
time(tzinfo=tzinfo)
type(time(tzinfo=tzinfo()).tzinfo)
time(tzinfo=timedelta(0))
time(1, 2, 3, 4, utc, 1)
time(1, 2, 3, 4, utc, 1, 1)
time(1, hour=1)
time(foo=1)
time(hours=1)
time(1, 2, 3, 4, 5)
time.min, time.max, time.resolution
type(time.min), type(time.resolution)
''')

print('--- attributes')
x = time(1, 2, 3, 4, utc, fold=1)
n = time(12, 34, 56, 789012)
block('''
x.hour, x.minute, x.second, x.microsecond, x.tzinfo, x.fold
n.hour, n.minute, n.second, n.microsecond, n.tzinfo, n.fold
type(x.hour), type(x.fold)
time.hour
type(time.hour).__name__
time.hour.__get__(x)
time.hour.__get__(1)
setattr(x, 'hour', 1)
setattr(x, 'fold', 0)
setattr(x, 'tzinfo', None)
setattr(x, 'foo', 1)
x.__dict__
x.year
bool(time(0)), bool(time(0, tzinfo=utc)), bool(x), bool(time.min)
bool(time(0, tzinfo=Fixed(0))), bool(time(1, tzinfo=Fixed(60))), bool(time(0, tzinfo=Fixed(-60)))
''')

print('--- repr, str, isoformat')
times = [time(), time(1), time(1, 2), time(1, 2, 3), time(1, 2, 3, 4), time(0, 0, 0, 1), time(0, 0, 1), time(0, 1), time(23, 59, 59, 999999), time(1, 2, 3, 400000), time(1, 2, 3, 4000), time(fold=1), time(1, 2, 3, 4, fold=1),
         time(tzinfo=utc), time(1, 2, 3, 4, utc), time(1, 2, 3, 4, utc, fold=1), time(1, tzinfo=timezone(timedelta(hours=5, minutes=30))), time(1, tzinfo=timezone(timedelta(hours=-5))), time(1, tzinfo=timezone(timedelta(seconds=1))),
         time(1, tzinfo=timezone(timedelta(microseconds=1))), time(1, tzinfo=timezone(timedelta(microseconds=-1))), time(1, tzinfo=timezone(timedelta(hours=23, minutes=59, seconds=59, microseconds=999999))),
         time(1, tzinfo=timezone(-timedelta(hours=23, minutes=59, seconds=59, microseconds=999999))), time(1, tzinfo=Fixed(90)), time(1, tzinfo=Fixed(None)), time(1, tzinfo=timezone(timedelta(hours=1), 'X'))]
for v in times:
    print(repr(v), '|', str(v), '|', v.isoformat(), '|', format(v), '|', v.utcoffset(), v.dst(), v.tzname())
    for spec in ['auto', 'hours', 'minutes', 'seconds', 'milliseconds', 'microseconds']:
        print('   ', spec, v.isoformat(spec), v.isoformat(timespec=spec))
block('''
n.isoformat('')
n.isoformat('foo')
n.isoformat('Hours')
n.isoformat('auto ')
n.isoformat(None)
n.isoformat(1)
n.isoformat(b'auto')
n.isoformat('auto', 1)
n.isoformat(spec='auto')
n.isoformat(timespec='\\ud800')
n.isoformat(timespec='au\\0to')
n.isoformat(timespec='h\\xe9')
time.isoformat(1)
n.__str__(), n.__repr__()
time.__str__(1)
''')

print('--- utcoffset, dst, tzname')
class Bad(tzinfo):
    def __init__(self, value): self.value = value
    def utcoffset(self, dt): return self.value
    def dst(self, dt): return self.value
    def tzname(self, dt): return self.value
    def __repr__(self): return 'Bad(%r)' % (self.value,)
class Raises(tzinfo):
    def utcoffset(self, dt): raise KeyError('utcoffset')
    def dst(self, dt): raise KeyError('dst')
    def tzname(self, dt): raise KeyError('tzname')
class Sees(tzinfo):
    def utcoffset(self, dt): print('utcoffset sees', dt); return timedelta(0)
    def dst(self, dt): print('dst sees', dt); return None
    def tzname(self, dt): print('tzname sees', dt); return 'S'
class TD(timedelta): pass
class S(str): pass
for value in [None, 0, 1.0, 'x', timedelta(0), timedelta(hours=23, minutes=59), timedelta(hours=24), timedelta(hours=-24), timedelta(hours=-23, minutes=-59), timedelta(days=1, microseconds=-1), timedelta(days=-1, microseconds=1), timedelta(days=-1), timedelta(seconds=1), timedelta(microseconds=1), timedelta(days=2), TD(hours=1), S('sub'), b'x', (), timedelta.max]:
    v = time(12, tzinfo=Bad(value))
    for src in ['v.utcoffset()', 'v.dst()', 'v.tzname()', 'str(v)', 'v.isoformat()', 'hash(v) == hash(v)', 'v == v', 'v == time(12, tzinfo=utc)', 'v < time(13, tzinfo=utc)', 'bool(v)', 'repr(v)', "v.strftime('%z|%Z')"]:
        t(src, v=v)
v = time(12, tzinfo=Raises())
for src in ['v.utcoffset()', 'v.dst()', 'v.tzname()', 'str(v)', 'hash(v)', 'v == v', 'v == time(12, tzinfo=utc)', 'v < time(12, tzinfo=utc)', 'v == time(12)', "v.strftime('%z')", "v.strftime('%Z')", "v.strftime('%H')"]:
    t(src, v=v)
v = time(12, tzinfo=Sees())
for src in ['v.utcoffset()', 'v.dst()', 'v.tzname()', 'str(v)', 'v == time(12, tzinfo=utc)', "v.strftime('%z %Z %z %Z')"]:
    t(src, v=v)
v = time(12, tzinfo=tzinfo())
for src in ['v.utcoffset()', 'v.dst()', 'v.tzname()', 'str(v)', 'hash(v)', 'v == v', 'v == time(12)', 'repr(v)[:40]']:
    t(src, v=v)
block('''
n.utcoffset(), n.dst(), n.tzname()
n.utcoffset(1)
n.dst(1)
n.tzname(1)
time.utcoffset(1)
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
vals = [time(0), time(1), time(0, 1), time(0, 0, 1), time(0, 0, 0, 1), time(23, 59, 59, 999999), time(1, fold=1), time(0, tzinfo=utc), time(1, tzinfo=utc), time(1, tzinfo=Fixed(60)), time(2, tzinfo=Fixed(60)), time(0, tzinfo=Fixed(-60)), time(23, tzinfo=Fixed(-120)), time(1, tzinfo=Fixed(None)), time(0, 30, tzinfo=Fixed(60)), time(1, tzinfo=utc, fold=1), time(1, tzinfo=timezone(timedelta(microseconds=1)))]
for name, f in cmps:
    for a in vals:
        for b in vals:
            show(name, f, a, b)
        for b in [0, None, 'x', (), timedelta(0), date(2000, 1, 1), datetime(2000, 1, 1), Anything()]:
            show(name, f, a, b)
            show(name, f, b, a)
for a in vals:
    for b in vals:
        try:
            if a == b:
                print(repr(a), repr(b), 'equal; hashes equal:', hash(a) == hash(b))
        except Exception as e:
            print(type(e).__name__, e)
block('''
x.__eq__(x), x.__eq__(1), x.__lt__(1), x.__ne__(None)
time.__eq__(1, x)
time.__hash__(1)
type(hash(x)), type(hash(n))
hash(time(1, fold=1)) == hash(time(1))
hash(time(1, tzinfo=utc, fold=1)) == hash(time(1, tzinfo=utc))
hash(time(0, tzinfo=Fixed(-60))) == hash(time(1, tzinfo=utc))
hash(time(0, 30, tzinfo=Fixed(60))) == hash(time(0, 30, tzinfo=Fixed(60)))
{time(1): 1}[time(1, fold=1)]
len({time(h, m) for h in range(24) for m in range(60)})
sorted([time(3), time(1), time(2)])
sorted([time(3, tzinfo=utc), time(1, tzinfo=Fixed(-180)), time(2, tzinfo=Fixed(60))])
x + timedelta(1)
x - x
x - timedelta(1)
timedelta(1) + x
x * 2
-x
''')

print('--- replace')
block('''
x.replace()
x.replace() is x, x.replace() == x
x.replace(5)
x.replace(5, 6, 7, 8)
x.replace(5, 6, 7, 8, None)
x.replace(5, 6, 7, 8, None, fold=0)
x.replace(hour=5), x.replace(minute=5), x.replace(second=5), x.replace(microsecond=5)
x.replace(tzinfo=None)
x.replace(tzinfo=Fixed(60))
x.replace(fold=0)
n.replace(fold=1)
n.replace(tzinfo=utc)
x.replace(hour=24)
x.replace(minute=60)
x.replace(second=-1)
x.replace(microsecond=10**6)
x.replace(fold=2)
x.replace(tzinfo=1)
x.replace(hour=None)
x.replace(hour=1.0)
x.replace(tzinfo=True)
x.replace(foo=1)
x.replace(year=1)
x.replace(1, hour=1)
x.replace(1, 2, 3, 4, None, 1)
x.__replace__(hour=5)
x.__replace__(5)
copy.replace(x, hour=5, fold=0)
copy.replace(x, tzinfo=None)
time.replace(1)
''')

print('--- strftime, __format__')
block('''
n.strftime('%H:%M:%S.%f')
n.strftime('%H %I %p %M %S %f %z %Z %%')
x.strftime('%H %I %p %M %S %f %z %:z %Z %%')
n.strftime('%Y-%m-%d %j %a %A %b %B %d %w %y %U %W')
n.strftime('')
n.strftime('no directives')
n.strftime('%')
n.strftime('%%')
n.strftime('100%')
n.strftime('%f%f')
n.strftime('%%f')
n.strftime('%%%f')
n.strftime('%:z')
n.strftime('%:')
n.strftime('%:f')
x.strftime('%::z')
n.strftime('\\xe9%H\\u20ac%M\\U0001f600')
n.strftime('%H\\0%M')
n.strftime(1)
n.strftime(None)
n.strftime()
n.strftime('%H', 1)
n.strftime(format='%H')
n.strftime(fmt='%H')
format(n, '%H-%M'), f'{n:%H.%M}', format(n, ''), f'{n}'
n.__format__('%S')
n.__format__(1)
time(1, tzinfo=Fixed(90, 'a%zb')).strftime('%Z|%z')
time(1, tzinfo=Fixed(-90, '%')).strftime('[%Z]')
time(1, tzinfo=Fixed(0, '')).strftime('[%Z][%z]')
time(1, tzinfo=Fixed(None, None)).strftime('[%Z][%z][%:z]')
time(1, tzinfo=timezone(timedelta(hours=1, seconds=1))).strftime('%z %:z')
time(1, tzinfo=timezone(timedelta(hours=-1, microseconds=-1))).strftime('%z %:z')
time.strftime(1, '%H')
''')

print('--- strptime')
block('''
time.strptime('12:34:56', '%H:%M:%S')
time.strptime('12:34:56.789', '%H:%M:%S.%f')
time.strptime('12:34 +0530', '%H:%M %z')
time.strptime('12', '%H')
time.strptime('1 PM', '%I %p')
time.strptime('12:34', '%H')
time.strptime('x', '%H')
time.strptime('2020', '%Y')
time.strptime('2020-01-02 12', '%Y-%m-%d %H')
time.strptime(1, '%H')
time.strptime('1', 1)
time.strptime('1')
time.strptime()
''')

print('--- subclass')
class T(time): pass
class E(time):
    def __new__(cls, *args, extra=7, **kw):
        self = super().__new__(cls, *args, **kw)
        self.extra = extra
        return self
y = T(1, 2, 3, 4, utc, fold=1)
y.foo = 1
block('''
y, type(y).__name__, y.__dict__
repr(y), str(y)
type(y.replace(hour=5)).__name__, y.replace(hour=5).__dict__
type(copy.replace(y, hour=5)).__name__
type(T.fromisoformat('01:02')).__name__
type(T.strptime('01', '%H')).__name__
type(T.min).__name__
y == x, x == y, hash(y) == hash(x)
type(copy.copy(y)).__name__, copy.copy(y).__dict__, copy.copy(y) == y
type(copy.deepcopy(y)).__name__, copy.deepcopy(y).__dict__
y.__reduce__()
y.__reduce_ex__(2)
y.__reduce_ex__(3)
type(pickle.loads(pickle.dumps(y))).__name__, pickle.loads(pickle.dumps(y)).fold
E(1).extra, E(1, extra=9).extra
E(1, extra=9).replace(hour=2).extra
E(1, fold=1, extra=9).replace(hour=2).fold
E.fromisoformat('01:02').extra
E.strptime('01', '%H').extra
time.__new__(T, 1)
time.__new__(int, 1)
object.__new__(time)
T.__mro__
''')
import weakref
t('type(weakref.ref(x)).__name__')
t('type(weakref.ref(y)).__name__')

print('--- pickles')
for v in [time(), time(1, 2, 3, 4), time(23, 59, 59, 999999), time(1, fold=1), time(1, 2, 3, 4, utc), time(1, 2, 3, 4, utc, fold=1), time(1, tzinfo=timezone(timedelta(hours=1), 'X'))]:
    print(v.__reduce__(), [v.__reduce_ex__(p) for p in range(6)])
    for proto in range(pickle.HIGHEST_PROTOCOL + 1):
        s = pickle.dumps(v, proto)
        w = pickle.loads(s)
        print(proto, s if proto < 4 or v.tzinfo is None else len(s) > 0, w == v, w.fold, w.tzinfo)
    print(copy.copy(v) is v, copy.deepcopy(v) is v, copy.copy(v) == v, copy.copy(v).fold, copy.deepcopy(v).tzinfo is v.tzinfo)
block('''
time(b'\\x01\\x02\\x03\\x00\\x00\\x04')
time(b'\\x81\\x02\\x03\\x00\\x00\\x04')
time(b'\\x17\\x3b\\x3b\\x0f\\x42\\x3f')
time(b'\\x18\\x02\\x03\\x00\\x00\\x04')
time(b'\\x98\\x02\\x03\\x00\\x00\\x04')
time(b'\\x97\\x02\\x03\\x00\\x00\\x04')
time(b'\\x01\\x02\\x03\\x00\\x00\\x04', None)
time(b'\\x01\\x02\\x03\\x00\\x00\\x04', utc)
time(b'\\x01\\x02\\x03\\x00\\x00\\x04', 1)
time(b'\\x01\\x02\\x03\\x00\\x00\\x04', utc, 1)
time(b'\\x01\\x02\\x03\\x00\\x00\\x04', tzinfo=utc)
time(b'\\x01\\x02\\x03\\x00\\x00')
time(b'\\x01\\x02\\x03\\x00\\x00\\x04\\x05')
time(b'')
time('\\x01\\x02\\x03\\x00\\x00\\x04')
time('\\x81\\x02\\x03\\x00\\x00\\x04')
time('\\x01\\x02\\x03\\x00\\x00\\u0104')
time('\\x18\\x02\\x03\\x00\\x00\\x04')
time('abcdef')
time(bytearray(b'\\x01\\x02\\x03\\x00\\x00\\x04'))
T(b'\\x01\\x02\\x03\\x00\\x00\\x04', utc)
time(b'\\x01\\x7f\\x7f\\xff\\xff\\xff').hour
''')
