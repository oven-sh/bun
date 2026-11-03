# The events of sys.monitoring, but for jumps, branches and instructions, whose places depend on the bytecode.
import re
import sys

m = sys.monitoring
E = m.events
TOOL = 2
log = []
NAMES = ['PY_START', 'PY_RESUME', 'PY_RETURN', 'PY_YIELD', 'CALL', 'LINE', 'STOP_ITERATION', 'RAISE', 'EXCEPTION_HANDLED', 'PY_UNWIND', 'PY_THROW', 'RERAISE',
         'C_RETURN', 'C_RAISE']


def describe(value):
    if value is m.MISSING:
        return 'MISSING'
    if isinstance(value, BaseException):
        return repr(value)
    name = getattr(value, '__qualname__', None)
    return name if name else re.sub(r' at 0x[0-9a-f]+', '', repr(value))


def recorder(name):
    def record(code, where, *args):
        if code.co_filename != __file__:
            return
        if name == 'LINE':
            log.append((name, code.co_name, where - code.co_firstlineno))
        else:
            assert isinstance(where, int)
            log.append((name, code.co_name) + tuple(describe(a) for a in args))
    return record


def run(function, *args, events=None):
    del log[:]
    names = events or NAMES
    m.use_tool_id(TOOL, 'test')
    for name in names:
        m.register_callback(TOOL, getattr(E, name), recorder(name))
    mask = 0
    for name in names:
        mask |= getattr(E, name)
    try:
        m.set_events(TOOL, mask)
        try:
            result = function(*args)
        finally:
            m.set_events(TOOL, 0)
    except BaseException as e:
        result = 'raised %r' % (e,)
    m.free_tool_id(TOOL)
    print('==', function.__name__, '->', result)
    for entry in log:
        if entry[1] != 'run':
            print('  ', *entry)


def callee(a=None, *rest, **kw):
    return a


class C:
    def __init__(self, a=None):
        self.a = a

    def method(self, x=None):
        return x

    @classmethod
    def class_method(cls):
        return 1

    @staticmethod
    def static_method(a):
        return a

    def __call__(self, a):
        return a

    def __len__(self):
        return 3


def simple():
    x = 1
    return x


def python_calls():
    callee()
    callee(1)
    callee(1, 2, k=3)
    callee(*[1, 2])
    callee(**{'a': 1})
    callee(k=1)


def method_calls():
    c = C(5)
    c.method()
    c.method(1)
    C.method(c, 2)
    bound = c.method
    bound(3)
    c.class_method()
    C.class_method()
    c.static_method(4)
    c(5)


def builtin_calls():
    len('abc')
    [].append(1)
    'a'.upper()
    str.upper('a')
    int('1')
    dict(a=1)
    max(1, 2)
    print(end='')
    sorted([2, 1], key=callee)
    isinstance(1, int)
    len(C())


def builtin_raises():
    try:
        len(1)
    except TypeError:
        pass
    try:
        int('x')
    except ValueError:
        pass
    try:
        {}.pop('k')
    except KeyError:
        pass


def class_calls():
    C()
    C(1)
    object()
    type('T', (), {})
    ValueError('v')


def raises():
    raise ValueError('v')


def catches():
    try:
        raises()
    except ValueError:
        return 'caught'


def reraises():
    try:
        raises()
    except ValueError:
        raise


def finally_clause():
    try:
        raises()
    finally:
        x = 1


def catches_finally():
    try:
        finally_clause()
    except ValueError:
        pass


def with_block():
    class M:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return True
    with M():
        raise KeyError('k')


def named_handler():
    try:
        raise ValueError('v')
    except ValueError as e:
        x = 1


def implicit_raise():
    try:
        1 / 0
    except ZeroDivisionError:
        pass
    try:
        [][1]
    except IndexError:
        pass
    try:
        None.a
    except AttributeError:
        pass
    try:
        undefined_name
    except NameError:
        pass


def gen():
    yield 1
    yield 2
    return 'done'


def for_generator():
    for i in gen():
        pass


def next_generator():
    g = gen()
    next(g)
    next(g)
    try:
        next(g)
    except StopIteration:
        pass


def list_generator():
    list(gen())


def throw_generator():
    g = gen()
    next(g)
    try:
        g.throw(ValueError('t'))
    except ValueError:
        pass


def close_generator():
    g = gen()
    next(g)
    g.close()


def delegate():
    return (yield from gen())


def yield_from():
    for i in delegate():
        pass


def for_iterator():
    for i in iter([1]):
        pass
    for i in range(1):
        pass


async def coroutine():
    return 1


async def awaits():
    return await coroutine()


def run_coroutine():
    try:
        awaits().send(None)
    except StopIteration as e:
        return e.value


def comprehension():
    return [callee(i) for i in range(2)]


def generator_expression():
    return sorted(callee(i) for i in range(2))


def decorated():
    @callee
    def inner():
        pass


def operators():
    c = C()
    len(c)
    c.a
    c == c
    str(c)[:0]


for function in [simple, python_calls, method_calls, builtin_calls, builtin_raises, class_calls, catches, reraises, catches_finally, with_block, named_handler,
                 implicit_raise, for_generator, next_generator, list_generator, throw_generator, close_generator, yield_from, for_iterator, run_coroutine,
                 comprehension, generator_expression, decorated, operators]:
    run(function)
