# What a trace function is told of, construct by construct.
import re
import sys

log = []


def show(value):
    return re.sub(r' at 0x[0-9a-f]+', '', repr(value))


def tracer(frame, event, arg):
    code = frame.f_code
    if code.co_filename != __file__:
        return None
    line = frame.f_lineno - code.co_firstlineno
    if event == 'return':
        log.append((code.co_name, event, line, show(arg)))
    elif event == 'exception':
        log.append((code.co_name, event, line, arg[0].__name__, show(arg[1]), type(arg[2]).__name__))
    else:
        log.append((code.co_name, event, line))
    return tracer


def run(function, *args):
    del log[:]
    sys.settrace(tracer)
    try:
        try:
            result = function(*args)
        finally:
            sys.settrace(None)
    except BaseException as e:
        result = 'raised %r' % (e,)
    print('==', function.__name__, '->', result)
    for entry in log:
        print('  ', *entry)


def simple():
    x = 1
    y = 2
    return x + y


def only_pass():
    pass


def constants():
    1
    'a'
    ...
    None


def if_else(a):
    if a:
        x = 1
    else:
        x = 2
    return x


def if_elif(a):
    if a == 1:
        return 'one'
    elif a == 2:
        return 'two'
    elif a == 3:
        pass
    return 'many'


def for_loop():
    total = 0
    for i in range(3):
        total += i
    return total


def for_else():
    for i in range(2):
        pass
    else:
        i = 10
    return i


def for_break():
    for i in range(5):
        if i == 1:
            break
    else:
        i = -1
    return i


def for_continue():
    n = 0
    for i in range(4):
        if i % 2:
            continue
        n += 1
    return n


def one_line_for():
    for i in range(3): pass
    return i


def one_line_while():
    i = 0
    while i < 3: i += 1
    return i


def while_loop():
    i = 0
    while i < 3:
        i += 1
    return i


def while_true():
    i = 0
    while True:
        i += 1
        if i > 2:
            break
    return i


def while_else():
    i = 0
    while i < 2:
        i += 1
    else:
        i = 10
    return i


def nested_loops():
    n = 0
    for i in range(2):
        for j in range(2):
            n += 1
    return n


def try_except():
    try:
        x = 1
        raise ValueError('v')
    except KeyError:
        x = 2
    except ValueError as e:
        x = 3
    return x


def try_bare_except():
    try:
        1 / 0
    except:
        x = 1
    return x


def try_else():
    try:
        x = 1
    except ValueError:
        x = 2
    else:
        x = 3
    return x


def try_finally():
    try:
        x = 1
    finally:
        x = 2
    return x


def try_finally_raise():
    try:
        raise ValueError('v')
    finally:
        x = 2


def try_except_finally():
    try:
        raise ValueError('v')
    except ValueError:
        x = 1
    finally:
        x = 2
    return x


def return_in_try_finally():
    try:
        return 1
    finally:
        x = 2


def return_in_except():
    try:
        raise ValueError
    except ValueError as e:
        return 5


def break_in_try_finally():
    for i in range(3):
        try:
            break
        finally:
            x = 2
    return i


def continue_in_try_finally():
    for i in range(2):
        try:
            continue
        finally:
            x = 2
    return i


def not_caught():
    try:
        raise ValueError('v')
    except KeyError:
        x = 2
    return 1


def reraise():
    try:
        raise ValueError('v')
    except ValueError:
        raise


def raise_in_handler():
    try:
        raise ValueError('v')
    except ValueError:
        raise KeyError('k')


def nested_try():
    try:
        try:
            raise ValueError('v')
        finally:
            a = 1
    except ValueError:
        b = 2
    return a + b


class Manager:
    def __init__(self, swallow=False):
        self.swallow = swallow

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return self.swallow


def with_statement():
    with Manager() as m:
        x = 1
    return x


def with_raise():
    with Manager():
        raise ValueError('v')


def with_swallow():
    with Manager(True):
        raise ValueError('v')
    return 1


def with_two():
    with Manager() as a, Manager() as b:
        x = 1
    return x


def with_return():
    with Manager():
        return 1


def with_multiline():
    with (
        Manager() as a,
        Manager() as b,
    ):
        x = 1
    return x


def callee(a, b=2):
    return a + b


def calls():
    x = callee(1)
    y = callee(
        x,
        b=3,
    )
    return y


def multiline_expression():
    x = (1 +
         callee(1) +
         3)
    y = [
        1,
        x,
        3,
    ]
    z = {
        'a': 1,
        'b': x,
    }
    return (x,
            y,
            z)


def multiline_assign():
    x = (
        1)
    y = (
        callee(2)
    )
    return x + y


def bool_ops(a, b):
    x = (a and
         b)
    y = (a or
         b)
    if (a and
            b):
        return 1
    return x, y


def conditional_expression(a):
    x = (1 if a
         else 2)
    return x


def comprehension():
    x = [i for i in range(2)]
    y = [i
         for i in range(2)
         if i]
    return x, y


def generator_expression():
    return sum(i for i in range(2))


def make_lambda():
    f = lambda a: a + 1
    return f(1)


def inner_function():
    def inner(a):
        return a
    return inner(1)


def decorator(f):
    return f


def decorated():
    @decorator
    @decorator
    def inner():
        return 1
    return inner()


def class_body():
    class C:
        a = 1

        def method(self):
            return self.a
    return C().method()


def decorated_class():
    @decorator
    class C:
        pass
    return C.__name__


def delete():
    x = 1
    del x
    return 1


def global_statement():
    global some_global
    some_global = 1
    return some_global


def assert_statement(a):
    assert a, 'message'
    return 1


def augmented():
    x = 1
    x += 1
    d = {'a': 1}
    d['a'] += 1
    return x


def unpacking():
    a, b = 1, 2
    (c,
     d) = b, a
    return a, b, c, d


def import_statement():
    import sys
    from os import path
    return 1


def match_statement(x):
    match x:
        case 1:
            return 'one'
        case [a, b]:
            return 'pair'
        case {'k': v}:
            return 'mapping'
        case str():
            return 'str'
        case _:
            return 'other'


def star_except():
    try:
        raise ExceptionGroup('g', [ValueError(1), KeyError(2)])
    except* ValueError as e:
        a = 1
    except* KeyError:
        b = 2
    return a + b


def unbound():
    if 0:
        x = 1
    return x


def docstring():
    """A docstring."""
    return 1


def empty_return():
    return


def return_multiline():
    return (
        1
    )


def fstring(a):
    return f'{a}' \
           f'{a + 1}'


def chained_methods():
    return ('a'
            .upper()
            .lower())


def annotations():
    x: int = 1
    y: int
    return x


def walrus():
    if (n := 3) > 2:
        return n


def try_in_loop():
    n = 0
    for i in range(3):
        try:
            if i == 1:
                raise ValueError
            n += 1
        except ValueError:
            n += 10
    return n


for function, args in [
    (simple, ()), (only_pass, ()), (constants, ()), (if_else, (1,)), (if_else, (0,)), (if_elif, (1,)), (if_elif, (2,)), (if_elif, (3,)), (if_elif, (4,)),
    (for_loop, ()), (for_else, ()), (for_break, ()), (for_continue, ()), (one_line_for, ()), (one_line_while, ()), (while_loop, ()), (while_true, ()),
    (while_else, ()), (nested_loops, ()), (try_except, ()), (try_bare_except, ()), (try_else, ()), (try_finally, ()), (try_finally_raise, ()),
    (try_except_finally, ()), (return_in_try_finally, ()), (return_in_except, ()), (break_in_try_finally, ()), (continue_in_try_finally, ()),
    (not_caught, ()), (reraise, ()), (raise_in_handler, ()), (nested_try, ()), (with_statement, ()), (with_raise, ()), (with_swallow, ()), (with_two, ()),
    (with_return, ()), (with_multiline, ()), (calls, ()), (multiline_expression, ()), (multiline_assign, ()), (bool_ops, (1, 2)), (bool_ops, (0, 2)),
    (bool_ops, (1, 0)), (conditional_expression, (1,)), (conditional_expression, (0,)), (comprehension, ()), (generator_expression, ()), (make_lambda, ()),
    (inner_function, ()), (decorated, ()), (class_body, ()), (decorated_class, ()), (delete, ()), (global_statement, ()), (assert_statement, (1,)),
    (assert_statement, (0,)), (augmented, ()), (unpacking, ()), (import_statement, ()), (match_statement, (1,)), (match_statement, ([1, 2],)),
    (match_statement, ({'k': 1},)), (match_statement, ('s',)), (match_statement, (2.5,)), (star_except, ()), (unbound, ()), (docstring, ()),
    (empty_return, ()), (return_multiline, ()), (fstring, (1,)), (chained_methods, ()), (annotations, ()), (walrus, ()), (try_in_loop, ()),
]:
    run(function, *args)
