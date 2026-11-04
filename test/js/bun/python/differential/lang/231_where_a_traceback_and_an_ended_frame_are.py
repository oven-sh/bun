# tb_lineno, tb_lasti, and f_lineno and f_lasti of a frame whose call has ended, asked for late: after the function has other code, after
# collections, more than once.
import gc
import sys
import types


def raises(x):
    y = x + 1
    return y // 0


def calls(x):
    z = 1
    return raises(
        x)


def entries(e):
    tb = e.__traceback__
    out = []
    while tb:
        code = tb.tb_frame.f_code
        positions = list(code.co_positions())[tb.tb_lasti // 2]
        out.append((code.co_name, tb.tb_lineno - code.co_firstlineno, tb.tb_frame.f_lineno - code.co_firstlineno, tb.tb_lasti == tb.tb_frame.f_lasti, positions[0] - code.co_firstlineno, positions[2:]))
        tb = tb.tb_next
    return out


def catch(f, *a):
    try:
        f(*a)
    except Exception as e:
        return e


e = catch(calls, 1)
print(entries(e)[1:])
print(entries(e)[1:])

print('--- the function has other code by then')


def other(x):


    return 'other'


e = catch(calls, 1)
old = raises.__code__
raises.__code__ = other.__code__
gc.collect()
print(entries(e)[1:])
print(calls(1))
raises.__code__ = old

print('--- many, kept, and looked at after collections')
kept = [catch(calls, i) for i in range(200)]
for i in range(3):
    gc.collect()
print({tuple(entries(e)[1:]) for e in kept})

print('--- code that nothing else keeps')
namespace = {}
exec(compile('def f():\n    a = 1\n\n    return a / 0\n', '<made>', 'exec'), namespace)
e = catch(namespace.pop('f'))
del namespace
gc.collect()
print(entries(e)[1:])

print('--- a frame that returned')


def returns():
    frame = sys._getframe()
    return frame


frame = returns()
gc.collect()
print(frame.f_lineno - frame.f_code.co_firstlineno, frame.f_lasti >= 0, frame.f_lineno - frame.f_code.co_firstlineno)


def returns_at_the_end(p):
    global frame
    frame = sys._getframe()
    if p:
        x = 1
    else:
        x = 2


for p in (0, 1):
    returns_at_the_end(p)
    print(frame.f_lineno - frame.f_code.co_firstlineno)

print('--- a generator that ended')


def gen():
    global frame
    frame = sys._getframe()
    yield 1
    yield 2
    raise ValueError


g = gen()
lines = []
try:
    for x in g:
        lines.append(frame.f_lineno - frame.f_code.co_firstlineno)
except ValueError as e:
    print(lines, frame.f_lineno - frame.f_code.co_firstlineno, entries(e)[1:])

print('--- left through a with, a finally, an except')


class CM:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        pass


def through_with():
    with CM():
        x = 1
        raise ValueError


def through_finally():
    try:
        raise ValueError
    finally:
        x = 1
        y = 2


def through_except():
    try:
        raise ValueError
    except KeyError:
        pass
    except OSError:
        pass


def raised_again():
    try:
        raise ValueError
    except ValueError:
        x = 1
        raise


def raised_again_by_name():
    try:
        raise ValueError
    except ValueError as e:
        x = 1
        raise e


for f in (through_with, through_finally, through_except, raised_again, raised_again_by_name):
    print(f.__name__, entries(catch(f))[1:])

print('--- made by the program')
tb = types.TracebackType(None, frame, 4, 77)
print(tb.tb_lineno, tb.tb_lasti, tb.tb_next)
