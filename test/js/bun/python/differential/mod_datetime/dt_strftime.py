import os, time as _time
os.environ['TZ'] = 'UTC0'
_time.tzset()
from datetime import timedelta, date, datetime, time, timezone, tzinfo

def t(src, **env):
    try:
        print(src, '=>', repr(eval(src, globals(), env)))
    except BaseException as e:
        print(src, '!!', type(e).__name__, e)
def block(text, **env):
    for src in text.strip().splitlines():
        t(src, **env)
td = timedelta
utc = timezone.utc
class Fixed(tzinfo):
    def __init__(self, minutes, name='fixed'): self.minutes, self.name = minutes, name
    def utcoffset(self, dt): return None if self.minutes is None else td(minutes=self.minutes)
    def tzname(self, dt): return self.name
    def dst(self, dt): return None
    def __repr__(self): return 'Fixed(%r, %r)' % (self.minutes, self.name)

print('--- every directive')
values = [date(2024, 2, 29), date(1, 1, 1), date(99, 12, 31), date(999, 6, 15), date(1000, 1, 1), date(1899, 12, 31), date(1900, 1, 1), date(9999, 12, 31), datetime(2024, 2, 29, 13, 4, 5, 6), datetime(1, 1, 1), datetime(999, 12, 31, 23, 59, 59, 999999), datetime(2024, 1, 1, 0, 0, 0, 0, utc), datetime(2021, 1, 3, 12, tzinfo=Fixed(-330, 'X')), datetime(2020, 12, 31, 1, tzinfo=timezone(td(hours=1, seconds=1))), time(13, 4, 5, 6), time(0), time(1, tzinfo=utc)]
for v in values:
    for c in 'aAbBcCdDeFgGhHIjmMnprRSTtuUVwWxXyYzZf%':
        t("v.strftime('[%%%s]')" % c, v=v)
    t("v.strftime('[%:z]')", v=v)
    t("v.strftime('%Y-%m-%d %H:%M:%S.%f %z %Z %G-W%V-%u %C %y %F')", v=v)
print('--- years and padding')
for y in [1, 9, 10, 99, 100, 999, 1000, 1889, 1900, 9999]:
    for c in ['%Y', '%G', '%C', '%F', '%y', '%g', '%4Y', '%_Y', '%-Y', '%EY', '%Oy', '%c', '%x', '%D', '%Y%Y', '%%Y', '%%%Y', 'x%Yx']:
        t('date(y, 6, 15).strftime(c)', y=y, c=c)
        t('datetime(y, 1, 1).strftime(c)', y=y, c=c)
print('--- odd formats')
d = datetime(2024, 2, 29, 13, 4, 5, 6, Fixed(90, 'é€\U0001f600'))
block('''
d.strftime('')
d.strftime('%')
d.strftime('%%')
d.strftime('abc%')
d.strftime('%Q')
d.strftime('%1')
d.strftime('% ')
d.strftime('%é')
d.strftime('é%Y€%m\\U0001f600%d')
d.strftime('%Z')
d.strftime('[%Z][%z][%:z][%f]')
d.strftime('\\ud800')
d.strftime('%Y\\ud800%m')
d.strftime('\\0')
d.strftime('%Y\\0%m\\0')
d.strftime('%z' * 5)
d.strftime('%f' * 5)
d.strftime('x' * 1000)[:10]
len(d.strftime('%Y' * 1000))
d.strftime('%:')
d.strftime('%:%z')
d.strftime('%:Z')
d.strftime('%::z')
d.strftime('%:zz')
d.strftime('%%z%%Z%%f%%:z')
d.strftime('%%%z')
d.strftime(1)
d.strftime()
d.strftime('%Y', '%m')
d.strftime(format='%Y')
date(2024, 2, 29).strftime('%H:%M:%S.%f|%z|%Z|%:z')
date(2024, 2, 29).strftime(format='%d')
date(2024, 2, 29).strftime(1)
date(2024, 2, 29).strftime()
date.strftime(1, '%Y')
datetime.strftime is date.strftime
datetime.strftime(d, '%d')
date.strftime(d, '%H %f %z')
format(d, '%d/%m'), f'{d:%H:%M}', f'{d:}', format(d, '')
format(date(2024, 2, 29), '%d/%m'), f'{date(2024, 2, 29):%j}'
d.__format__('%Y'), date.__format__(d, '%H')
d.__format__(1)
d.__format__()
''')
class S(str): pass
t("d.strftime(S('%Y'))")
t("format(d, S('%Y'))")
class OwnStrftime(date):
    def strftime(self, fmt): return 'own ' + fmt
    def __str__(self): return 'own str'
t("format(OwnStrftime(2020, 1, 1), 'x')")
t("format(OwnStrftime(2020, 1, 1), '')")
t("f'{OwnStrftime(2020, 1, 1)}'")
class OwnTimetuple(date):
    def timetuple(self): return (1999, 1, 1, 0, 0, 0, 0, 1, -1)
t("OwnTimetuple(2020, 1, 1).strftime('%Y')")
class BadTimetuple(date):
    def timetuple(self): return 5
t("BadTimetuple(2020, 1, 1).strftime('%Y')")
t("BadTimetuple(20, 1, 1).strftime('%Y')")
class NameSub(tzinfo):
    def __init__(self, v): self.v = v
    def tzname(self, dt): return self.v
    def utcoffset(self, dt): return None
class Str2(str):
    def replace(self, a, b): return 5
t("datetime(2020, 1, 1, tzinfo=NameSub(Str2('x'))).strftime('%Z')")
t("datetime(2020, 1, 1, tzinfo=NameSub(5)).strftime('%Z')")
t("datetime(2020, 1, 1, tzinfo=NameSub('%Y%%')).strftime('[%Z]')")

print('--- strptime')
block('''
datetime.strptime('2020-01-02', '%Y-%m-%d')
datetime.strptime('2020-01-02 03:04:05', '%Y-%m-%d %H:%M:%S')
datetime.strptime('2020-01-02 03:04:05.6', '%Y-%m-%d %H:%M:%S.%f')
datetime.strptime('2020-01-02 03:04:05.678901', '%Y-%m-%d %H:%M:%S.%f')
datetime.strptime('2020-01-02 +0100', '%Y-%m-%d %z')
datetime.strptime('2020-01-02 -01:30', '%Y-%m-%d %z')
datetime.strptime('2020-01-02 +01:30:15', '%Y-%m-%d %z')
datetime.strptime('2020-01-02 +01:30:15.123456', '%Y-%m-%d %z')
datetime.strptime('2020-01-02 Z', '%Y-%m-%d %z')
datetime.strptime('2020-01-02 +00:00', '%Y-%m-%d %z')
datetime.strptime('2020-01-02 +00:00', '%Y-%m-%d %z').tzinfo is utc
datetime.strptime('2020-01-02 UTC', '%Y-%m-%d %Z')
datetime.strptime('2020-01-02 GMT', '%Y-%m-%d %Z')
datetime.strptime('2020-01-02 UTC +0000', '%Y-%m-%d %Z %z')
datetime.strptime('2020-01-02 UTC +0100', '%Y-%m-%d %Z %z')
datetime.strptime('2020-01-02 +01:00', '%Y-%m-%d %:z')
datetime.strptime('Thu Feb 29 13:04:05 2024', '%c')
datetime.strptime('Thu Feb 29 13:04:05 2024', '%a %b %d %H:%M:%S %Y')
datetime.strptime('2024 60', '%Y %j')
datetime.strptime('2024 9 4', '%G %V %u')
datetime.strptime('24', '%y'), datetime.strptime('69', '%y'), datetime.strptime('68', '%y')
datetime.strptime('12 AM', '%I %p'), datetime.strptime('12 PM', '%I %p')
datetime.strptime('', '')
datetime.strptime('%', '%%')
datetime.strptime('2020', '%Y').tzinfo
datetime.strptime('2020-13-01', '%Y-%m-%d')
datetime.strptime('2020-02-30', '%Y-%m-%d')
datetime.strptime('2020-01-02x', '%Y-%m-%d')
datetime.strptime('x', '%Y')
datetime.strptime('2020', '%Q')
datetime.strptime('2020', '%')
datetime.strptime('0000', '%Y')
datetime.strptime('10000', '%Y')
datetime.strptime('2020-01-02 +2400', '%Y-%m-%d %z')
datetime.strptime('2020-01-02 +0060', '%Y-%m-%d %z')
datetime.strptime(1, '%Y')
datetime.strptime('2020', 1)
datetime.strptime(b'2020', '%Y')
datetime.strptime('2020')
datetime.strptime()
datetime.strptime('2020', '%Y', 1)
datetime.strptime(date_string='2020', format='%Y')
date.strptime('2020-01-02', '%Y-%m-%d')
date.strptime('2020-01-02 03', '%Y-%m-%d %H')
date.strptime('03', '%H')
date.strptime('2020-02-30', '%Y-%m-%d')
date.strptime('x', '%Y')
date.strptime(1, '%Y')
date.strptime('2020')
date.strptime('2020-01-02 +0100', '%Y-%m-%d %z')
time.strptime('03:04:05.000006 +0100', '%H:%M:%S.%f %z')
''')
for v in [datetime(2024, 2, 29, 13, 4, 5, 6), datetime(1000, 1, 1), datetime(9999, 12, 31, 23, 59, 59, 999999), datetime(2024, 2, 29, 13, 4, 5, 6, utc), datetime(2024, 2, 29, 13, 4, 5, 6, timezone(td(hours=-3, minutes=-30)))]:
    for fmt in ['%Y-%m-%d %H:%M:%S.%f', '%Y-%m-%dT%H:%M:%S.%f%z', '%c', '%x %X', '%d/%m/%y %I:%M:%S %p', '%Y %j %H', '%G-W%V-%u %H:%M']:
        s = v.strftime(fmt)
        try:
            print(fmt, s, repr(datetime.strptime(s, fmt)))
        except Exception as e:
            print(fmt, s, type(e).__name__, e)
