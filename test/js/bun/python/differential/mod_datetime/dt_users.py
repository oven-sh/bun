import os, time as _time, io, struct, json, copy, pickle
os.environ['TZ'] = 'UTC0'
_time.tzset()
from datetime import timedelta, date, datetime, time, timezone, tzinfo, UTC

def t(src, **env):
    try:
        print(src, '=>', repr(eval(src, globals(), env)))
    except BaseException as e:
        print(src, '!!', type(e).__name__, e)
def block(text, **env):
    for src in text.strip().splitlines():
        t(src, **env)
td = timedelta

print('--- struct_time')
block('''
datetime(*_time.gmtime(0)[:6])
datetime(*_time.localtime(86400)[:6])
datetime.fromtimestamp(_time.mktime(datetime(2020, 1, 2, 3, 4, 5).timetuple()))
_time.strftime('%Y-%m-%d %H:%M:%S', datetime(2020, 1, 2, 3, 4, 5).timetuple())
_time.asctime(datetime(2020, 1, 2, 3, 4, 5).timetuple())
datetime(2020, 1, 2, 3, 4, 5).timetuple() == _time.struct_time((2020, 1, 2, 3, 4, 5, 3, 2, -1))
tuple(date(2020, 1, 2).timetuple())
datetime(*_time.strptime('2020-01-02', '%Y-%m-%d')[:3])
''')

print('--- zoneinfo, from a file made here')
import zoneinfo
def tzif(transitions, types, abbrevs, footer=b''):
    # Version 2: an empty version 1 block, then 64-bit data.
    def header(version, isutc, isstd, leap, timecnt, typecnt, charcnt):
        return b'TZif' + version + b'\0' * 15 + struct.pack('>6l', isutc, isstd, leap, timecnt, typecnt, charcnt)
    v1 = header(b'2', 0, 0, 0, 0, 1, 1) + struct.pack('>lBB', 0, 0, 0) + b'\0'
    body = b''.join(struct.pack('>q', when) for when, _ in transitions) + bytes(index for _, index in transitions)
    body += b''.join(struct.pack('>lBB', off, isdst, abbr) for off, isdst, abbr in types) + abbrevs
    return v1 + header(b'2', 0, 0, 0, len(transitions), len(types), len(abbrevs)) + body + b'\n' + footer + b'\n'
data = tzif([(1583650800, 1), (1604210400, 0), (1615705200, 1), (1636264800, 0)], [(-18000, 0, 0), (-14400, 1, 4)], b'EST\0EDT\0', b'EST5EDT,M3.2.0,M11.1.0')
Z = zoneinfo.ZoneInfo.from_file(io.BytesIO(data), key='Test/Eastern')
print(Z, Z.key)
for y, m, d, h, mi in [(2020, 1, 1, 0, 0), (2020, 3, 8, 1, 59), (2020, 3, 8, 2, 30), (2020, 3, 8, 3, 0), (2020, 7, 1, 12, 0), (2020, 11, 1, 0, 59), (2020, 11, 1, 1, 30), (2020, 11, 1, 2, 0), (2021, 3, 14, 2, 30), (2030, 7, 1, 0, 0), (2030, 11, 3, 1, 30), (1960, 1, 1, 0, 0)]:
    for fold in (0, 1):
        v = datetime(y, m, d, h, mi, tzinfo=Z, fold=fold)
        print(v, fold, v.tzname(), v.utcoffset(), v.dst(), v.astimezone(UTC), v.timestamp(), v.astimezone(UTC).astimezone(Z), v.astimezone(UTC).astimezone(Z).fold)
for ts in [1583650799, 1583650800, 1604210399, 1604210400, 1604206800, 0, 1900000000]:
    v = datetime.fromtimestamp(ts, Z)
    print(ts, v, v.fold, v.tzname())
block('''
datetime(2020, 11, 1, 1, 30, tzinfo=Z) == datetime(2020, 11, 1, 1, 30, tzinfo=Z, fold=1)
datetime(2020, 11, 1, 1, 30, tzinfo=Z) == datetime(2020, 11, 1, 5, 30, tzinfo=UTC)
datetime(2020, 7, 1, 1, 30, tzinfo=Z) == datetime(2020, 7, 1, 5, 30, tzinfo=UTC)
datetime(2020, 7, 1, tzinfo=Z) - datetime(2020, 1, 1, tzinfo=Z)
datetime(2020, 7, 1, tzinfo=Z) - datetime(2020, 1, 1, tzinfo=UTC)
str(datetime(2020, 3, 8, 1, tzinfo=Z) + td(hours=1))
time(12, tzinfo=Z).utcoffset(), time(12, tzinfo=Z).tzname()
datetime.now(Z).tzinfo is Z
isinstance(Z, tzinfo)
zoneinfo.ZoneInfo('Nowhere/Nothing')
''')

print('--- email.utils')
import email.utils
block('''
email.utils.format_datetime(datetime(2020, 1, 2, 3, 4, 5))
email.utils.format_datetime(datetime(2020, 1, 2, 3, 4, 5, tzinfo=UTC))
email.utils.format_datetime(datetime(2020, 1, 2, 3, 4, 5, tzinfo=UTC), usegmt=True)
email.utils.format_datetime(datetime(2020, 1, 2, 3, 4, 5, tzinfo=timezone(td(hours=-5))))
email.utils.parsedate_to_datetime('Thu, 02 Jan 2020 03:04:05 -0500')
email.utils.parsedate_to_datetime('Thu, 02 Jan 2020 03:04:05 -0000')
email.utils.parsedate_to_datetime('Thu, 02 Jan 2020 03:04:05 +0000')
email.utils.localtime(datetime(2020, 1, 2, 3, 4, 5))
email.utils.formatdate(0), email.utils.formatdate(0, localtime=True), email.utils.formatdate(0, usegmt=True)
''')

print('--- calendar, json, csv, repr in containers')
import calendar
block('''
calendar.timegm(datetime(2020, 1, 2, 3, 4, 5).utctimetuple())
calendar.weekday(2020, 1, 2), calendar.monthrange(2020, 2)
list(calendar.Calendar().itermonthdates(2020, 2))[:3]
calendar.month_name[1], calendar.day_name[0]
json.dumps({'d': date(2020, 1, 2)}, default=str)
json.dumps(date(2020, 1, 2))
json.dumps({'d': datetime(2020, 1, 2)}, default=datetime.isoformat)
[date(2020, 1, 2), td(1)], {date(2020, 1, 2): time(1)}, (datetime(2020, 1, 2),)
str([date(2020, 1, 2)])
'%s|%r|%10s' % (date(2020, 1, 2), td(1), time(1))
'{0:%Y} {0.year} {1.days}'.format(date(2020, 1, 2), td(5))
''')

print('--- plistlib, xmlrpc, http, logging')
import plistlib, xmlrpc.client, http.cookiejar, logging
block('''
plistlib.dumps({'d': datetime(2020, 1, 2, 3, 4, 5)})
plistlib.loads(plistlib.dumps({'d': datetime(2020, 1, 2, 3, 4, 5)}))
plistlib.loads(plistlib.dumps({'d': datetime(2020, 1, 2, 3, 4, 5)}, fmt=plistlib.FMT_BINARY))
plistlib.loads(plistlib.dumps({'d': datetime(2020, 1, 2, 3, 4, 5, tzinfo=UTC)}, aware_datetime=True), aware_datetime=True)
xmlrpc.client.dumps((datetime(2020, 1, 2, 3, 4, 5),))
xmlrpc.client.loads(xmlrpc.client.dumps((datetime(2020, 1, 2, 3, 4, 5),)), use_builtin_types=True)
str(xmlrpc.client.DateTime(datetime(2020, 1, 2, 3, 4, 5)))
xmlrpc.client.DateTime(datetime(2020, 1, 2, 3, 4, 5)) == datetime(2020, 1, 2, 3, 4, 5)
http.cookiejar.http2time('Thu, 02 Jan 2020 03:04:05 GMT'), http.cookiejar.time2isoz(0)
logging.Formatter().formatTime(logging.makeLogRecord({'created': 0, 'msecs': 1}))
''')

print('--- dataclasses, enum, typing, statistics, sorting')
import dataclasses, enum, statistics, bisect, heapq
@dataclasses.dataclass(frozen=True, order=True)
class Event:
    when: datetime
    length: td = td(0)
block('''
Event(datetime(2020, 1, 2)), Event(datetime(2020, 1, 2)) == Event(datetime(2020, 1, 2)), hash(Event(datetime(2020, 1, 2))) == hash(Event(datetime(2020, 1, 2)))
sorted([Event(datetime(2020, 1, 3)), Event(datetime(2020, 1, 2), td(1)), Event(datetime(2020, 1, 2))])
dataclasses.asdict(Event(datetime(2020, 1, 2)))
dataclasses.replace(Event(datetime(2020, 1, 2)), length=td(2))
copy.deepcopy(Event(datetime(2020, 1, 2, tzinfo=UTC)))
pickle.loads(pickle.dumps(Event(datetime(2020, 1, 2, tzinfo=UTC))))
statistics.mean([td(1), td(3)])
sum([td(1), td(3)], td()) / 2
bisect.bisect([date(2020, 1, 1), date(2020, 1, 3)], date(2020, 1, 2))
heapq.nsmallest(2, [date(2020, 1, 3), date(2020, 1, 1), date(2020, 1, 2)])
max([td(1), td(3), td(2)], key=abs)
list(map(date.fromordinal, range(737425, 737428)))
[d.isoformat() for d in (date(2020, 1, 1) + td(i) for i in range(3))]
''')
class Day(enum.Enum):
    FIRST = date(2020, 1, 1)
    SECOND = date(2020, 1, 2)
t('Day(date(2020, 1, 2)), Day.FIRST.value')
match date(2020, 1, 2):
    case date(year=2020, month=m): print('matched', m)
match datetime(2020, 1, 2, 3):
    case datetime(hour=h) if h == 3: print('matched', h)
match td(1, 2):
    case td(days=1, seconds=s): print('matched', s)
t('date.__match_args__')
