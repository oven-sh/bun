import os, time as _time, pickle, copy
from datetime import timedelta, date, datetime, time, timezone, tzinfo

def t(src, **env):
    try:
        print(src, '=>', repr(eval(src, globals(), env)))
    except BaseException as e:
        print(src, '!!', type(e).__name__, e)
td = timedelta
utc = timezone.utc
ZERO, HOUR = td(0), td(hours=1)

def settz(name):
    os.environ['TZ'] = name
    _time.tzset()

print('--- local time with rules given in TZ (no files needed)')
for tz in ['EST5EDT,M3.2.0,M11.1.0', 'UTC0', 'CET-1CEST,M3.5.0,M10.5.0/3', 'AEST-10AEDT,M10.1.0,M4.1.0/3', 'IST-5:30', 'NST3:30NDT,M3.2.0,M11.1.0', '<+0845>-8:45', 'XXX12', 'YYY-14']:
    settz(tz)
    print('TZ', tz, _time.tzname)
    for y, m, d in [(2020, 3, 8), (2020, 11, 1), (2020, 3, 29), (2020, 10, 25), (2020, 10, 4), (2020, 4, 5), (2020, 1, 1), (2020, 7, 1), (1970, 1, 1), (1969, 12, 31), (2037, 7, 1), (2100, 7, 1), (1900, 1, 1), (1, 1, 2), (9999, 12, 30)]:
        for h, mi in [(0, 0), (0, 30), (1, 0), (1, 30), (2, 0), (2, 30), (3, 0), (3, 30), (12, 0)]:
            for fold in (0, 1):
                v = datetime(y, m, d, h, mi, fold=fold)
                try:
                    ts = v.timestamp()
                    a = v.astimezone()
                    back = datetime.fromtimestamp(ts)
                    print(v, fold, ts, a, a.tzname(), a.utcoffset(), a.fold, '|', back, back.fold, '|', v.astimezone(utc))
                except BaseException as e:
                    print(v, fold, type(e).__name__, e)
    for ts in [0, 1583650799, 1583650800, 1604206799, 1604206800, 1604210399, 1604210400, 1585443599, 1585443600, 1603587599, 1603587600, 1603591200, -1, -86400 * 365 * 70, 4102444800, 32503680000]:
        v = datetime.fromtimestamp(ts)
        w = datetime.fromtimestamp(ts, utc).astimezone()
        print(ts, v, v.fold, w, w.tzname(), w.fold, date.fromtimestamp(ts), v.timestamp() == ts)
    for ts in [1604206800.5, 1604210399.999999, 1604206799.9999996]:
        v = datetime.fromtimestamp(ts)
        print(ts, v, v.fold)
settz('UTC0')

print('--- a tzinfo that knows about fold')
def first_sunday_on_or_after(dt):
    days = 6 - dt.weekday()
    return dt + td(days) if days else dt
class USTimeZone(tzinfo):
    def __init__(self, hours, reprname, stdname, dstname):
        self.stdoffset = td(hours=hours)
        self.reprname, self.stdname, self.dstname = reprname, stdname, dstname
    def __repr__(self): return self.reprname
    def tzname(self, dt): return self.dstname if self.dst(dt) else self.stdname
    def utcoffset(self, dt): return self.stdoffset + self.dst(dt)
    def dst(self, dt):
        if dt is None or dt.tzinfo is None:
            return ZERO
        assert dt.tzinfo is self
        start = first_sunday_on_or_after(datetime(dt.year, 3, 8, 2))
        end = first_sunday_on_or_after(datetime(dt.year, 11, 1, 2))
        dt = dt.replace(tzinfo=None)
        if start + HOUR <= dt < end - HOUR:
            return HOUR
        if end - HOUR <= dt < end:
            return ZERO if dt.fold else HOUR
        if start <= dt < start + HOUR:
            return HOUR if dt.fold else ZERO
        return ZERO
    def fromutc(self, dt):
        assert dt.tzinfo is self
        start = first_sunday_on_or_after(datetime(dt.year, 3, 8, 2)).replace(tzinfo=self)
        end = first_sunday_on_or_after(datetime(dt.year, 11, 1, 2)).replace(tzinfo=self)
        std_time = dt + self.stdoffset
        dst_time = std_time + HOUR
        if end <= dst_time < end + HOUR:
            return std_time.replace(fold=1)
        if std_time < start or dst_time >= end:
            return std_time
        if start <= std_time < end - HOUR:
            return dst_time
Eastern = USTimeZone(-5, 'Eastern', 'EST', 'EDT')
Pacific = USTimeZone(-8, 'Pacific', 'PST', 'PDT')
moments = []
for m, d in [(3, 8), (11, 1)]:
    for h in range(0, 5):
        for mi in (0, 30):
            for fold in (0, 1):
                moments.append(datetime(2020, m, d, h, mi, tzinfo=Eastern, fold=fold))
for v in moments:
    print(v, v.fold, v.tzname(), v.utcoffset(), v.dst(), '|', v.astimezone(utc), '|', v.astimezone(Pacific), v.astimezone(Pacific).fold, '|', v.timestamp(), v.utctimetuple()[:6], v.timetuple().tm_isdst, v.isoformat(), v.strftime('%z %Z'))
print('--- comparisons between and within zones')
for a in moments[::3]:
    for b in [m.astimezone(utc) for m in moments[::5]] + [m.astimezone(Pacific) for m in moments[::7]] + moments[::4]:
        try:
            print(a, a.fold, '|', b, b.fold, '|', a == b, a != b, a < b, a <= b, a - b, hash(a) == hash(b))
        except BaseException as e:
            print(a, b, type(e).__name__, e)
print('--- fold is ignored within a zone, and kept by what copies')
a0 = datetime(2020, 11, 1, 1, 30, tzinfo=Eastern)
a1 = a0.replace(fold=1)
for src in '''
a0 == a1, hash(a0) == hash(a1), a0 < a1, a1 - a0
a0.astimezone(utc) == a1.astimezone(utc), a1.astimezone(utc) - a0.astimezone(utc)
a0 == a0.astimezone(utc), a1 == a1.astimezone(utc)
a0.astimezone(utc) == a0, a1.astimezone(utc) == a1
a0 != a0.astimezone(utc), a1 != a1.astimezone(utc)
a0 < a1.astimezone(utc), a1 > a0.astimezone(utc)
(a1 + td(0)).fold, (a1 - td(0)).fold, (a1 + td(1)).fold
a1.time().fold, a1.timetz().fold, a1.timetz()
datetime.combine(a1.date(), a1.timetz()).fold
a1.replace(hour=2).fold, a1.replace(fold=0).fold
copy.copy(a1).fold, copy.deepcopy(a1).fold
repr(a1), repr(a1.time()), repr(a1.timetz())
a1.isoformat(), a0.isoformat()
datetime(2020, 3, 8, 2, 30, tzinfo=Eastern) == datetime(2020, 3, 8, 2, 30, tzinfo=Eastern).astimezone(utc)
datetime(2020, 3, 8, 2, 30, tzinfo=Eastern, fold=1) == datetime(2020, 3, 8, 2, 30, tzinfo=Eastern, fold=1).astimezone(utc)
datetime(2020, 3, 8, 2, 30, tzinfo=Eastern).astimezone(utc).astimezone(Eastern)
time(1, 30, tzinfo=Eastern, fold=1) == time(1, 30, tzinfo=Eastern)
time(1, 30, tzinfo=Eastern, fold=1).utcoffset()
{a0: 'x'}[a1]
'''.strip().splitlines():
    t(src)
class Weird(tzinfo):
    "The offset depends on fold alone."
    def utcoffset(self, dt): return td(hours=1) if dt.fold else td(hours=2)
    def dst(self, dt): return ZERO
    def __repr__(self): return 'Weird()'
w0 = datetime(2020, 1, 1, 12, tzinfo=Weird())
w1 = w0.replace(fold=1)
for src in '''
w0 == w1, hash(w0) == hash(w1), w0 - w1
w0 == w0.astimezone(utc), w1 == w1.astimezone(utc)
w0 == datetime(2020, 1, 1, 10, tzinfo=utc), w1 == datetime(2020, 1, 1, 11, tzinfo=utc)
w0 < datetime(2020, 1, 1, 10, 30, tzinfo=utc), w1 < datetime(2020, 1, 1, 10, 30, tzinfo=utc)
w0 - datetime(2020, 1, 1, 10, tzinfo=utc), w1 - datetime(2020, 1, 1, 10, tzinfo=utc)
hash(w1) == hash(datetime(2020, 1, 1, 10, tzinfo=utc))
w0.timestamp(), w1.timestamp()
'''.strip().splitlines():
    t(src)
