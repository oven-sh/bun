# date, time and datetime take the state that a pickle holds: a bytes or a str of 4, 6 or 10, which is told from other arguments by its month, or its hour.
# CPython looks at nothing else in it, and has dates of the year 0 and times of 255 minutes; datetime.date(b'\0\0\1\1').ctime() ends the process.
# Here the fields go the way of the arguments of the constructor. So what is expected was written by hand.
import pickle
from datetime import date, time, datetime, timezone
class D(date): pass
class T(time): pass
class DT(datetime): pass
def show(what, make):
    try: print(what, '=>', repr(make()))
    except Exception as e: print(what, '!!', type(e).__name__, e)
DATES = {
    'as it is written': b'\x07\xd0\x02\x1d', 'the first': b'\x00\x01\x01\x01', 'the last': b'\x27\x0f\x0c\x1f',
    'year 0': b'\x00\x00\x01\x01', 'year 10000': b'\x27\x10\x01\x01', 'year 65535': b'\xff\xff\x0c\x1f',
    'day 0': b'\x07\xd0\x01\x00', '30 February': b'\x07\xd0\x02\x1e', '29 February 1900': b'\x07\x6c\x02\x1d', 'day 32': b'\x07\xd0\x01\x20', 'day 53': b'\x07\xd0\x01\x35', 'day 255': b'\x07\xd0\x01\xff',
}
TIMES = {
    'as it is written': b'\x17\x3b\x3b\x0f\x42\x3f', 'with the fold': b'\x97\x3b\x3b\x0f\x42\x3f',
    'minute 60': b'\x01\x3c\x00\x00\x00\x00', 'minute 64': b'\x01\x40\x00\x00\x00\x00', 'minute 255': b'\x01\xff\x00\x00\x00\x00',
    'second 60': b'\x01\x00\x3c\x00\x00\x00', 'second 255': b'\x01\x00\xff\x00\x00\x00',
    'microsecond 1000000': b'\x01\x00\x00\x0f\x42\x40', 'microsecond 1048576': b'\x01\x00\x00\x10\x00\x00', 'microsecond 16777215': b'\x01\x00\x00\xff\xff\xff',
    'all of them': b'\x01\x7f\x7f\xff\xff\xff',
}
for name, state in DATES.items():
    show('date, ' + name, lambda: date(state))
    show('date, a str, ' + name, lambda: date(state.decode('latin-1')))
    show('a class derived from date, ' + name, lambda: D(state))
    show('datetime, ' + name, lambda: datetime(state + b'\x00' * 6))
    show('datetime, with the fold, ' + name, lambda: datetime(state[:2] + bytes([state[2] | 0x80]) + state[3:] + b'\x00' * 6).fold)
    show('pickle, ' + name, lambda: pickle.loads(b'cdatetime\ndate\n(C\x04' + state + b'tR.'))
for name, state in TIMES.items():
    show('time, ' + name, lambda: time(state))
    show('time, a str, ' + name, lambda: time(state.decode('latin-1')))
    show('time, a zone, ' + name, lambda: time(state, timezone.utc))
    show('a class derived from time, ' + name, lambda: T(state))
    show('datetime, ' + name, lambda: datetime(b'\x07\xd0\x01\x01' + bytes([state[0] & 0x7f]) + state[1:]))
    show('a class derived from datetime, ' + name, lambda: DT(b'\x07\xd0\x01\x01' + bytes([state[0] & 0x7f]) + state[1:], timezone.utc))
for hour in (23, 24, 31, 32, 127, 128, 255):
    show('datetime, hour %d' % hour, lambda: datetime(b'\x07\xd0\x01\x01' + bytes([hour]) + b'\x00' * 5))
# What is refused first.
show('a zone that is none, and a day that is none', lambda: datetime(b'\x07\xd0\x01\x00' + b'\x00' * 6, 1))
show('a year and a minute', lambda: datetime(b'\x00\x00\x01\x01\x00\xff\x00\x00\x00\x00'))
