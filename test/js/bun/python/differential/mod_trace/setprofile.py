# What a profile function is told of.
import sys

log = []


def describe(arg):
    if arg is None:
        return 'None'
    name = getattr(arg, '__qualname__', None)
    return name if name else repr(arg)


def profiler(frame, event, arg):
    code = frame.f_code
    if code.co_filename != __file__:
        return
    log.append((code.co_name, event, frame.f_lineno - code.co_firstlineno, describe(arg)))


def run(function, *args):
    del log[:]
    sys.setprofile(profiler)
    try:
        try:
            result = function(*args)
        finally:
            sys.setprofile(None)
    except BaseException as e:
        result = 'raised %r' % (e,)
    print('==', function.__name__, '->', result)
    for entry in log:
        if entry[0] != 'run':
            print('  ', *entry)


def callee(a=None):
    return a


def simple():
    return callee(1)


def builtins():
    len('abc')
    [].append(1)
    'a'.upper()
    str.upper('a')
    int('1')
    max(1, 2, key=callee)
    sorted([1])
    {}.get(1)
    print(end='')


def builtin_raises():
    try:
        len(1)
    except TypeError:
        pass
    try:
        {}.pop(1)
    except KeyError:
        pass
    return


class C:
    def method(self):
        return 1

    def __len__(self):
        return 0


def classes():
    c = C()
    c.method()
    len(c)
    object()
    ValueError()


def raises():
    raise ValueError('v')


def catches():
    try:
        raises()
    except ValueError:
        pass
    return


def gen():
    yield 1
    yield 2


def generators():
    for i in gen():
        pass
    g = gen()
    next(g)
    g.close()
    g = gen()
    next(g)
    try:
        g.throw(KeyError)
    except KeyError:
        pass
    return


def star_calls():
    callee(*[1])
    len(*['ab'])
    dict(**{'a': 1})


for function in [simple, builtins, builtin_raises, classes, catches, raises, generators, star_calls]:
    run(function)

# getprofile, errors
print(sys.getprofile())
sys.setprofile(profiler)
print(sys.getprofile() is profiler)
sys.setprofile(None)
print(sys.getprofile())


def failing(frame, event, arg):
    if event == 'return' and frame.f_code.co_name == 'callee':
        raise RuntimeError('in the profile function')


sys.setprofile(failing)
try:
    simple()
except RuntimeError as e:
    print('caught', e, sys.getprofile())
sys.setprofile(None)

# Both at once
del log[:]


def tracer(frame, event, arg):
    if frame.f_code.co_filename == __file__:
        log.append(('trace', frame.f_code.co_name, event))
        return tracer


def both(frame, event, arg):
    if frame.f_code.co_filename == __file__:
        log.append(('profile', frame.f_code.co_name, event))


sys.settrace(tracer)
sys.setprofile(both)
simple()
sys.setprofile(None)
sys.settrace(None)
for entry in log:
    print(*entry)
