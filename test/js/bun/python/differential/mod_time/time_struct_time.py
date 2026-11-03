# The type struct_time.
import time

S = time.struct_time

def show(f, *args, **kw):
    try:
        r = repr(f(*args, **kw))
    except Exception as e:
        r = '%s: %s' % (type(e).__name__, e)
    print(getattr(f, '__name__', f), args, kw or '', r)

print(S, S.__name__, S.__qualname__, S.__module__, S.__bases__, S.__mro__, type(S))
print(S.n_fields, S.n_sequence_fields, S.n_unnamed_fields, S.__match_args__, time._STRUCT_TM_ITEMS)
s = S((2001, 2, 3, 4, 5, 6, 5, 34, 0))
print(s, len(s), tuple(s), s[0], s[-1], s[2:5], list(s), s == (2001, 2, 3, 4, 5, 6, 5, 34, 0), hash(s) == hash(tuple(s)), isinstance(s, tuple))
print(s.tm_year, s.tm_mon, s.tm_mday, s.tm_hour, s.tm_min, s.tm_sec, s.tm_wday, s.tm_yday, s.tm_isdst, s.tm_zone, s.tm_gmtoff)
s = S(range(11))
print(s, len(s), s.tm_zone, s.tm_gmtoff)
s = S(range(10))
print(s, len(s), s.tm_zone, s.tm_gmtoff)
s = S('abcdefghi')
print(s, s.tm_year)
s = S([1] * 9, {'tm_zone': 'Z', 'tm_gmtoff': 5})
print(s, s.tm_zone, s.tm_gmtoff)
s = S(sequence=[1] * 9, dict={'tm_zone': 'Q'})
print(s, s.tm_zone, s.tm_gmtoff)
for args in (((1, 2, 3),), (range(8),), (range(12),), (5,), (None,), ([1] * 9, 5), ([1] * 9, {'x': 1}), ([1] * 11, {'tm_zone': 1})):
    show(S, *args)
show(setattr, s, 'x', 5)
show(getattr, s, 'nothing')
show(s.__getitem__, 9)
show(s.__getitem__, 10)
g = time.gmtime(0)
print(type(g) is S, g, g.tm_zone, g.tm_gmtoff)
print(g.__reduce__())
print(g.__replace__(tm_year=2000), g.__replace__(tm_zone='X').tm_zone)
show(g.__replace__, x=1)
print(g + (1,), type(g + (1,)).__name__, g * 1 == tuple(g), type(g[:]).__name__, g < time.gmtime(1), max(g), g.count(0), g.index(1970))
match g:
    case S(y, m, d):
        print('matched', y, m, d)
match g:
    case S(tm_year=y, tm_zone=z):
        print('matched', y, z)
y, *rest = g
print(y, rest)
try:
    class Sub(S):
        pass
    print('subclassed')
except TypeError as e:
    print('TypeError:', e)
print(sorted(n for n in dir(S) if not n.startswith('__')))
import copy
c = copy.copy(time.gmtime(86400))
print(c, type(c) is S, c.tm_zone)
