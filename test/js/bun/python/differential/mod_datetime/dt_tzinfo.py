import copy, pickle, sys, operator
from datetime import timedelta, date, datetime, time, timezone, tzinfo, UTC
import datetime as datetime_module

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

td = timedelta
print('--- tzinfo itself')
z = tzinfo()
dt = datetime(2020, 6, 1, 12)
block('''
type(z)
type(tzinfo()) is tzinfo
type(tzinfo(1))
type(tzinfo(a=1))
tzinfo(1, 2, a=3) is not None
z.utcoffset(None)
z.utcoffset(dt)
z.dst(None)
z.tzname(None)
z.utcoffset()
z.utcoffset(1, 2)
z.fromutc(dt)
z.fromutc(dt.replace(tzinfo=z))
z.fromutc(1)
z.fromutc(None)
z.fromutc()
z.fromutc(date(2020, 1, 1))
setattr(z, 'x', 1)
z.__dict__
z.__reduce__()
z == z, z == tzinfo(), z != tzinfo()
hash(z) == hash(z)
z < z
bool(z)
type(pickle.loads(pickle.dumps(z)))
type(copy.copy(z)), type(copy.deepcopy(z))
tzinfo.__mro__
sorted(k for k in vars(tzinfo))
tzinfo.utcoffset(1, None)
tzinfo.__new__(tzinfo) is not None
tzinfo.__new__(timezone)
tzinfo.__new__(int)
object.__new__(tzinfo) is not None
''')
import weakref
t('type(weakref.ref(z)).__name__')

print('--- subclasses of tzinfo')
class Plain(tzinfo): pass
class WithInit(tzinfo):
    def __init__(self, a, b=2): self.a, self.b = a, b
class WithArgs(tzinfo):
    def __init__(self, a): self.a = a
    def __getinitargs__(self): return (self.a,)
class WithState(tzinfo):
    def __init__(self): self.a = 1
    def __getstate__(self): return {'a': 5}
class Slots(tzinfo):
    __slots__ = ('a',)
p = Plain()
p.x = 1
block('''
type(p).__name__, p.__dict__
p.utcoffset(None)
p.tzname(None)
p.dst(None)
p.fromutc(dt.replace(tzinfo=p))
p.__reduce__()[0].__name__, p.__reduce__()[1:]
Plain().__reduce__()[1:]
pickle.loads(pickle.dumps(p)).__dict__
copy.copy(p).__dict__, copy.deepcopy(p).__dict__
WithInit(1).__reduce__()[1:]
pickle.loads(pickle.dumps(WithInit(1, 3))).__dict__
WithArgs(7).__reduce__()[1:]
pickle.loads(pickle.dumps(WithArgs(7))).a
WithState().__reduce__()[1:]
pickle.loads(pickle.dumps(WithState())).a
Slots().__reduce__()[1:]
setattr(Slots(), 'b', 1)
type(weakref.ref(p)).__name__
isinstance(p, tzinfo), issubclass(Plain, tzinfo)
Plain(1, 2, 3) is not None
WithInit()
''')
class BadInitArgs(tzinfo):
    def __getinitargs__(self): return 5
class RaisingInitArgs(tzinfo):
    def __getinitargs__(self): raise KeyError('x')
t('BadInitArgs().__reduce__()[1:]')
t('RaisingInitArgs().__reduce__()')

print('--- the default fromutc')
class Eastern(tzinfo):
    # As in the documentation, without fold.
    def __init__(self, hours, std, dstname):
        self.std, self.names = td(hours=hours), (std, dstname)
    def __repr__(self): return self.names[0]
    def _isdst(self, dt):
        if dt is None or dt.tzinfo is None: return False
        assert dt.tzinfo is self
        def first_sunday_on_or_after(d):
            days = 6 - d.weekday()
            return d + td(days) if days else d
        start = first_sunday_on_or_after(datetime(dt.year, 3, 8, 2))
        end = first_sunday_on_or_after(datetime(dt.year, 11, 1, 2))
        return start <= dt.replace(tzinfo=None) < end
    def utcoffset(self, dt): return self.std + self.dst(dt)
    def dst(self, dt): return td(hours=1) if self._isdst(dt) else td(0)
    def tzname(self, dt): return self.names[self._isdst(dt)]
E = Eastern(-5, 'EST', 'EDT')
for month, day, hours in [(3, 8, range(0, 12)), (11, 1, range(0, 12)), (1, 1, [0, 12]), (7, 1, [0, 12])]:
    for h in hours:
        for minute in (0, 30):
            u = datetime(2020, month, day, h, minute, tzinfo=E)
            r = E.fromutc(u)
            print(u.replace(tzinfo=None), '->', r, r.tzname(), r.utcoffset(), r.dst(), r.fold, type(r).__name__)
            a = datetime(2020, month, day, h, minute, tzinfo=timezone.utc).astimezone(E)
            print('   astimezone', a, a.tzname(), a.astimezone(timezone.utc))
class NoneOffset(tzinfo):
    def utcoffset(self, dt): return None
    def dst(self, dt): return td(0)
class NoneDst(tzinfo):
    def utcoffset(self, dt): return td(0)
    def dst(self, dt): return None
class Inconsistent(tzinfo):
    def __init__(self): self.n = 0
    def utcoffset(self, dt): return td(hours=1)
    def dst(self, dt):
        self.n += 1
        return td(0) if self.n == 1 else None
class Flip(tzinfo):
    def __init__(self): self.n = 0
    def utcoffset(self, dt):
        self.n += 1
        return td(hours=self.n)
    def dst(self, dt): return td(minutes=self.n)
    def __repr__(self): return 'Flip()'
for cls in [NoneOffset, NoneDst, Inconsistent, Flip]:
    zz = cls()
    t('zz.fromutc(datetime(2020, 1, 1, tzinfo=zz))', zz=zz)
    zz = cls()
    t('datetime(2020, 1, 1, tzinfo=timezone.utc).astimezone(zz)', zz=zz)
t('E.fromutc(datetime(2020, 1, 1))')
t('E.fromutc(datetime(2020, 1, 1, tzinfo=timezone.utc))')
t('E.fromutc(datetime(1, 1, 1, tzinfo=E))')
t('E.fromutc(datetime(9999, 12, 31, 23, tzinfo=E))')
t('Eastern(5, "A", "B").fromutc(datetime(9999, 12, 31, 23, tzinfo=None))')
class DT(datetime): pass
t('type(E.fromutc(DT(2020, 1, 1, tzinfo=E))).__name__')
t('tzinfo.fromutc(E, datetime(2020, 7, 1, tzinfo=E))')

print('--- timezone: constructor')
block('''
timezone(td(0))
timezone(td(0)) is timezone.utc
timezone(td(0), 'UTC')
timezone(td(0), 'UTC') is timezone.utc
timezone(td(0), 'UTC') == timezone.utc
timezone(td(hours=1))
timezone(td(hours=-1))
timezone(td(hours=1), 'X')
timezone(offset=td(hours=1), name='X')
timezone(td(hours=1), name='X')
timezone(td(hours=1), '')
timezone(td(hours=1), '\\xe9\\u20ac')
timezone(td(minutes=1)), timezone(td(seconds=1)), timezone(td(microseconds=1))
timezone(td(hours=23, minutes=59, seconds=59, microseconds=999999))
timezone(-td(hours=23, minutes=59, seconds=59, microseconds=999999))
timezone(td(hours=24))
timezone(td(hours=-24))
timezone(td(days=1, microseconds=1))
timezone(td(days=-2))
timezone(td.max)
timezone()
timezone(0)
timezone(None)
timezone('UTC')
timezone(1.0)
timezone(td(0), None)
timezone(td(0), 1)
timezone(td(0), b'x')
timezone(td(0), 'x', 1)
timezone(td(0), foo=1)
timezone(td(0), offset=td(0))
timezone.utc, timezone.min, timezone.max
UTC, UTC is timezone.utc, datetime_module.UTC is UTC
type(timezone.utc), type(timezone.min)
timezone.min.utcoffset(None), timezone.max.utcoffset(None)
''')
class TD(td): pass
class S(str): pass
block('''
timezone(TD(hours=1))
type(timezone(TD(hours=1)).utcoffset(None)).__name__
timezone(TD(0)) is timezone.utc
timezone(td(hours=1), S('x'))
type(timezone(td(hours=1), S('x')).tzname(None)).__name__
''')
try:
    class Z(timezone): pass
    print('subclass allowed')
except TypeError as e:
    print('TypeError', e)

print('--- timezone: methods')
zones = [timezone.utc, timezone.min, timezone.max, timezone(td(hours=1)), timezone(td(hours=-5, minutes=-30)), timezone(td(hours=5, minutes=45)), timezone(td(seconds=1)), timezone(td(seconds=-1)), timezone(td(microseconds=1)), timezone(td(microseconds=-1)),
         timezone(td(hours=1, minutes=2, seconds=3, microseconds=4)), timezone(-td(hours=1, minutes=2, seconds=3, microseconds=4)), timezone(td(hours=1), 'X'), timezone(td(0), 'Zulu'), timezone(td(hours=10))]
for zz in zones:
    print(repr(zz), '|', str(zz), '|', zz.tzname(None), '|', zz.utcoffset(None), '|', zz.dst(None), '|', zz.__getinitargs__(), '|', zz.__reduce__(), '|', zz.tzname(dt), zz.utcoffset(dt), zz.dst(dt))
    print('   ', zz.fromutc(dt.replace(tzinfo=zz)), dt.replace(tzinfo=zz).isoformat(), dt.replace(tzinfo=zz).strftime('%z %:z %Z'), format(zz), bool(zz))
    for proto in range(pickle.HIGHEST_PROTOCOL + 1):
        w = pickle.loads(pickle.dumps(zz, proto))
        print('   ', proto, w == zz, repr(w), w is zz)
    print('   ', copy.copy(zz) is zz, copy.deepcopy(zz) is zz, copy.copy(zz) == zz, repr(copy.deepcopy(zz)))
u = timezone.utc
block('''
u.utcoffset(1)
u.utcoffset('x')
u.utcoffset(date(2020, 1, 1))
u.utcoffset(time(1))
u.utcoffset()
u.utcoffset(None, None)
u.dst(1)
u.dst()
u.tzname(1)
u.tzname()
u.fromutc(1)
u.fromutc(None)
u.fromutc(dt)
u.fromutc(dt.replace(tzinfo=timezone(td(0), 'x')))
u.fromutc(dt.replace(tzinfo=u))
u.fromutc(date(2020, 1, 1))
timezone.max.fromutc(datetime.max.replace(tzinfo=timezone.max))
timezone.min.fromutc(datetime.min.replace(tzinfo=timezone.min))
type(u.fromutc(DT(2020, 1, 1, tzinfo=u))).__name__
setattr(u, 'x', 1)
u.__dict__
u.offset
u._offset
u.name
timezone.utcoffset(1, None)
timezone.utcoffset(z, None)
timezone.__repr__(z)
tzinfo.utcoffset(u, None)
tzinfo.fromutc(u, dt.replace(tzinfo=u))
tzinfo.__reduce__(u)
type(weakref.ref(u)).__name__
timezone.__mro__
isinstance(u, tzinfo)
sorted(k for k in vars(timezone))
''')

print('--- timezone: comparison')
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
    for a in [timezone.utc, timezone(td(hours=1)), timezone(td(hours=1), 'X'), timezone(td(0), 'X')]:
        for b in [timezone.utc, timezone(td(hours=1)), timezone(td(hours=1), 'Y'), timezone(td(0), 'X'), td(0), td(hours=1), 0, None, 'UTC', Anything(), E]:
            show(name, f, a, b)
            if not isinstance(b, timezone):
                show(name, f, b, a)
block('''
hash(timezone(td(hours=1))) == hash(timezone(td(hours=1), 'X'))
hash(timezone.utc) == hash(timezone(td(0), 'X'))
hash(timezone(td(hours=1))) == hash(td(hours=1))
{timezone(td(hours=1)): 1}[timezone(td(hours=1), 'X')]
len({timezone(td(minutes=m)) for m in range(-100, 100)})
u.__eq__(u), u.__eq__(1), u.__ne__(1), u.__lt__(u)
timezone.__eq__(1, u)
timezone.__hash__(1)
''')
