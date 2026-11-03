# tzset() and the time zones.
import posix, time

def report(tz):
    if tz is None:
        posix.unsetenv('TZ')
    else:
        posix.putenv('TZ', tz)
    time.tzset()
    print(repr(tz), time.timezone, time.altzone, time.daylight, time.tzname)
    for t in (0, 1e9, 1700000000, 1720000000, 1711846800, 1711846799, 1730001600, -1e9, 4e9, -2e9, -5e9):
        l = time.localtime(t)
        print(' ', t, tuple(l), l.tm_zone, l.tm_gmtoff, time.mktime(l), time.ctime(t), time.strftime('%Z %z %c', l))
    for tup in ((2024, 1, 15, 12, 0, 0, 0, 0, -1), (2024, 7, 15, 12, 0, 0, 0, 0, -1), (2024, 7, 15, 12, 0, 0, 0, 0, 0), (2024, 7, 15, 12, 0, 0, 0, 0, 1), (2024, 1, 15, 12, 0, 0, 0, 0, 1), (2024, 3, 31, 2, 30, 0, 0, 0, -1), (2024, 10, 27, 2, 30, 0, 0, 0, -1),
                (2024, 3, 10, 2, 30, 0, 0, 0, -1), (2024, 11, 3, 1, 30, 0, 0, 0, -1), (1900, 1, 1, 0, 0, 0, 0, 0, -1), (2100, 6, 1, 0, 0, 0, 0, 0, -1)):
        print(' ', tup, time.mktime(tup), time.strftime('%Z|%z', tup))

for tz in ('UTC', 'UTC0', 'EST5EDT', 'EST+5EDT,M3.2.0,M11.1.0', 'AEST-10AEDT-11,M10.5.0,M3.5.0', 'XYZ-3:30', '<+0330>-3:30', 'America/New_York', 'Europe/Paris', 'Asia/Kolkata', 'Australia/Sydney', 'Asia/Tokyo', 'America/Sao_Paulo',
           'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Nowhere/Nothing', '', 'ABCDEFGHIJKL-1', 'GMT+12', None):
    report(tz)
