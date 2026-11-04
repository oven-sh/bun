# Which lines have code (co_lines()), and which a trace function is told of, where the compiler works things out beforehand:
# constants over several lines, defaults, branches that cannot be taken.
import sys

SHAPES = r'''
def list_of_constants():
    x = [
        1,
        2,
        3,
    ]
---
def short_list():
    x = [
        1,
        2,
    ]
---
def list_with_a_name(a=0):
    x = [
        1,
        a,
        3,
    ]
---
def set_of_constants():
    x = {
        'a',
        'b',
        'c',
    }
---
def tuple_of_constants():
    x = (
        1,
        (2,
         3),
        -4,
    )
---
def tuple_worked_out():
    x = (
        1 << 4,
        (2 ** 3,
         'a' * 2),
    )
---
def long_list():
    x = [
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
        10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
        20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
        30, 31,
    ]
---
def long_tuple():
    x = (
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
        10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
        20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
        30, 31,
    )
---
def arguments():
    return dict(
        a=(1, 2),
        b=-1,
        c=1+2j,
        d='x',
        e=(),
    )
---
def loop_over_constants():
    for i in [
        1,
        2,
    ]:
        pass
---
def search_in_constants(a=1):
    return a in {
        1,
        2,
    }
---
def comprehension_over_constants():
    return [i for i in [
        1,
        2,
    ]]
---
def defaults():
    def inner(a,
              b=1,
              c='x',
              *,
              d=(),
              e=None):
        pass
---
def defaults_with_a_name(n=0):
    def inner(a,
              b=1,
              c=n):
        pass
---
def lambda_defaults():
    return (lambda a,
            b=1,
            c=2: a)
---
def if_false():
    a = 1
    if 0:
        b = 2
    c = 3
---
def if_false_else():
    if False:
        b = 2
    else:
        c = 3
---
def if_true_else():
    if 1:
        b = 2
    else:
        c = 3
---
def while_false():
    a = 1
    while 0:
        b = 2
    c = 3
---
def while_true_else():
    while True:
        break
    else:
        c = 3
---
def generator_that_yields_nothing():
    while False:
        yield None
---
def else_after_raise():
    try:
        raise ValueError
    except ValueError:
        a = 1
    else:
        b = 2
---
def after_return():
    return 1
    a = 2
---
def asserts(a=1):
    assert (
        a
    ), (
        'message'
    )
---
def debug():
    if __debug__:
        a = 1
    else:
        b = 2
---
def match_constant():
    match (1, 2):
        case (a, b):
            pass
---
def strings():
    x = ('a'
         'b'
         'c')
    y = ('a' +
         'b')
'''

log = []


def tracer(frame, event, arg):
    if frame.f_code.co_filename == '<shape>':
        log.append('%s%s' % (event[0], frame.f_lineno - 1 if frame.f_lineno is not None else None))
        return tracer


def codes(code):
    yield code
    for constant in code.co_consts:
        if hasattr(constant, 'co_lines'):
            yield from codes(constant)


for source in SHAPES.split('---\n'):
    namespace = {}
    exec(compile(source.strip('\n') + '\n', '<shape>', 'exec'), namespace)
    function = [v for v in namespace.values() if getattr(v, '__code__', None)][0]
    del log[:]
    sys.settrace(tracer)
    try:
        result = function()
        if hasattr(result, '__next__'):
            list(result)
    finally:
        sys.settrace(None)
    print(function.__name__)
    for code in codes(function.__code__):
        print('   ', code.co_name, sorted({line - 1 for _, _, line in code.co_lines() if line is not None}))
    print('   ', ' '.join(log))
