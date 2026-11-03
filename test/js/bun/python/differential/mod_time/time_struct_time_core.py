# What struct_time has from the struct sequences of the runtime (PyStructSeq.cpp), not from the module time.
import time

S = time.struct_time

def show(f, *args, **kw):
    try:
        r = repr(f(*args, **kw))
    except Exception as e:
        r = '%s: %s' % (type(e).__name__, e)
    print(getattr(f, '__name__', f), args, kw or '', r)

s = S([1] * 9)
show(S)
show(S, [1] * 9, {}, 1)
show(S, x=1)
show(setattr, s, 'tm_year', 5)
show(delattr, s, 'tm_year')
show(s.__replace__, 1)
print(type(S.tm_year).__name__, type(S.tm_zone).__name__, S.tm_year, S.tm_zone)
