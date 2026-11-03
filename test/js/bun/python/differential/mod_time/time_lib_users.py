# Modules of the library that lean on time.
import calendar, datetime, time, timeit

print(calendar.timegm((2001, 2, 3, 4, 5, 6)), calendar.timegm(time.gmtime(1234567890)), calendar.monthrange(2024, 2), calendar.month_name[2], calendar.day_abbr[0], calendar.isleap(2100), calendar.weekday(2001, 2, 3))
print(calendar.month(2024, 2))
D = datetime.datetime
utc = datetime.timezone.utc
d = D(2001, 2, 3, 4, 5, 6, 789)
print(d, d.isoformat(), d.ctime(), d.strftime('%A %d %B %Y %H:%M:%S.%f %j %U %%'), d.timetuple(), d.utctimetuple(), d.timestamp(), d.toordinal(), d.weekday(), tuple(d.isocalendar()))
print(D.fromtimestamp(0, utc), D.fromtimestamp(1234567890.5, utc), D.fromtimestamp(1234567890), D.fromtimestamp(-1e9, utc), D.strptime('2001-02-03 04:05', '%Y-%m-%d %H:%M'), D.fromisoformat('2001-02-03T04:05:06+05:30'))
print(d.replace(tzinfo=utc).astimezone(datetime.timezone(datetime.timedelta(hours=5, minutes=30))), d.astimezone().tzname(), d.astimezone().utcoffset(), d.replace(tzinfo=utc).strftime('%z %Z'))
print(datetime.date(2001, 2, 3).strftime('%x %a'), datetime.date.fromtimestamp(86400 * 365), datetime.time(4, 5, 6).strftime('%H-%M-%S'), datetime.date(1, 1, 1).strftime('%Y'), datetime.date(9999, 12, 31).strftime('%Y %G'))
print(abs((D.now() - D.fromtimestamp(time.time())).total_seconds()) < 5, abs((D.now(utc) - D.fromtimestamp(time.time(), utc)).total_seconds()) < 5, datetime.date.today().year >= 2025)
print(timeit.timeit('1 + 1', number=10) >= 0, timeit.default_timer is time.perf_counter, len(timeit.repeat('pass', number=1, repeat=3)))
