# What a frame object shows of a call that has ended: tracebacks, sys._getframe(), debuggers post mortem.
import sys, traceback
def show(tb):
    while tb:
        f = tb.tb_frame
        print(f.f_code.co_name, tb.tb_lineno, f.f_lineno, sorted((k, getattr(v, '__qualname__', None) or repr(v)) for k, v in f.f_locals.items() if not k.startswith('__') and k not in ('sys','traceback','show','outer','inner','C','gen','agen','e','tb','run','deep','cellfn','mk', 'tbs', 'saved', 'f', 'k', 'v', 'te', 'line', 'frames', 'getf', 'fr', 'g', 'comp', 'withfn', 'CM', 'late', 'r', 'cls')))
        tb = tb.tb_next
def inner(a, b=2, *args, c=3, **kw):
    x = a + b
    y = [x]
    del b
    z = 1 / 0
    never = 1
def outer(p):
    q = p * 2
    inner(q, 5, 6, 7, c=8, d=9)
try:
    outer(10)
except ZeroDivisionError as e:
    show(e.__traceback__)
    saved = e.__traceback__
show(saved)
# cells and free variables
def cellfn(n):
    total = n
    def add(m):
        nonlocal total
        total += m
        loc = total
        raise ValueError(loc)
    add(5)
try:
    cellfn(1)
except ValueError as e:
    show(e.__traceback__)
# class body
try:
    class C:
        attr = 1
        other = attr + 1
        boom = 1 / 0
except ZeroDivisionError as e:
    tb = e.__traceback__.tb_next
    print(tb.tb_frame.f_code.co_name, sorted(k for k in tb.tb_frame.f_locals))
# generator
def gen(n):
    i = n
    yield i
    j = i + 1
    raise KeyError(j)
g = gen(3)
next(g)
try:
    next(g)
except KeyError as e:
    show(e.__traceback__)
print(g.gi_frame)
# comprehension
def comp(n):
    pre = n
    return [1 / (k - 2) for k in range(n)]
try:
    comp(5)
except ZeroDivisionError as e:
    show(e.__traceback__)
# frame object taken by sys._getframe, read after return
def getf(a):
    b = a + 1
    fr = sys._getframe()
    c = b + 1
    return fr
fr = getf(1)
print(sorted((k, v) for k, v in fr.f_locals.items() if k != 'fr'), fr.f_lineno, fr.f_back is sys._getframe())
# with statement / exception in __exit__
class CM:
    def __enter__(self): return 5
    def __exit__(self, *a):
        inexit = 1
        return False
def withfn():
    with CM() as v1:
        w = v1 + 1
        raise RuntimeError(w)
try:
    withfn()
except RuntimeError as e:
    show(e.__traceback__)
# capture_locals
try:
    outer(1)
except ZeroDivisionError as e:
    te = traceback.TracebackException.from_exception(e, capture_locals=True)
    for frame in te.stack[1:]:
        print(frame.name, frame.lineno, sorted(frame.locals.items()))
# writes through f_locals after the end
fr.f_locals['a'] = 100
fr.f_locals['new'] = 7
print(sorted((k, v) for k, v in fr.f_locals.items() if k != 'fr'))
# clear
fr.clear()
print(sorted(fr.f_locals))
# late: variables assigned after frame object creation and exception
def late():
    f = sys._getframe()
    try:
        a = 1
        raise OSError
    except OSError:
        b = 2
    c = 3
    return f
r = late()
print(sorted((k, v) for k, v in r.f_locals.items() if k != 'f'))
