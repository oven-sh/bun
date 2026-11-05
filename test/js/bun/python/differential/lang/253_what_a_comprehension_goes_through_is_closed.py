# What a comprehension or a generator expression goes through, if it is a generator made on the spot, has no other reference: when the loop is left
# before its end (an exception, or the generator expression is closed or dropped), the generator is closed there and then, and what its `finally` does is done
# before the next statement.
import gc, sys

log = []
def items(name, values=(1, 'a', 2)):
    try:
        for value in values:
            yield value
    finally:
        log.append('closed ' + name)
def half(value):
    return value // 2

def sum_raises():
    try:
        sum(x for x in items('it'))
    except TypeError:
        log.append('caught')
def loop_is_left():
    for x in (y for y in items('it')):
        break
    log.append('after the loop')
def only_the_first():
    log.append(next(x for x in items('it')))
    log.append('after next()')
def key_raises():
    try:
        min((x for x in items('it')), key=lambda v: 1 // 0 if v == 'a' else 0)
    except ZeroDivisionError:
        log.append('caught')
def function_returns():
    def inner():
        for x in (y for y in items('it')):
            return x
    log.append(inner())
    log.append('after the call')
def body_raises():
    try:
        for x in (y for y in items('it')):
            raise KeyError
    except KeyError:
        log.append('caught')
def any_is_decided():
    log.append(any(x == 1 for x in items('it')))
    log.append('after any()')
def all_is_decided():
    log.append(all(x == 1 for x in items('it')))
    log.append('after all()')
# The exception comes out of the generator expression: its traceback has the frame, and the frame the variable.
def list_raises():
    try:
        list(half(x) for x in items('it'))
    except TypeError:
        log.append('caught')
    gc.collect()
    log.append('collected')
def one_in_another():
    log.append(next(x for x in (y for y in (z for z in items('it')))))
    log.append('after next()')
def second_loop():
    log.append(next((x, y) for x in items('outer') for y in items('inner')))
    log.append('after next()')
def list_comprehension():
    try:
        [half(x) for x in items('it')]
    except TypeError:
        log.append('caught')
def set_comprehension():
    try:
        {half(x) for x in items('it')}
    except TypeError:
        log.append('caught')
def dict_comprehension():
    try:
        {x: half(x) for x in items('it')}
    except TypeError:
        log.append('caught')
def comprehension_with_two_loops():
    try:
        [half(y) for x in items('outer') for y in items('inner')]
    except TypeError:
        log.append('caught')
def comprehension_in_comprehension():
    try:
        [[half(y) for y in items('inner')] for x in items('outer')]
    except TypeError:
        log.append('caught')
def condition_raises():
    try:
        [x for x in items('it') if half(x)]
    except TypeError:
        log.append('caught')
def comprehension_over_generator_expression():
    try:
        [half(x) for x in (y for y in items('it'))]
    except TypeError:
        log.append('caught')
def closed_by_the_program():
    g = (x for x in items('it'))
    next(g)
    g.close()
    log.append('after close()')
def thrown_into():
    g = (x for x in items('it'))
    next(g)
    try:
        g.throw(KeyError)
    except KeyError:
        log.append('caught')
    gc.collect()
    log.append('collected')
def never_started():
    sum((x for x in items('it')) if 0 else ())
    g = (x for x in items('it'))
    g.close()
    log.append('after close()')
def gone_through():
    log.append(sum(x for x in items('it', (1, 2))))
    log.append([x for x in items('it', (1, 2))])
# There is another reference: nothing is closed.
def in_a_variable():
    it = items('it')
    try:
        sum(x for x in it)
    except TypeError:
        log.append('caught')
    log.append(next(it))
    it.close()
def in_a_variable_comprehension():
    it = items('it')
    try:
        [half(x) for x in it]
    except TypeError:
        log.append('caught')
    log.append(next(it))
    it.close()
def seen_in_the_frame():
    g = (x for x in items('it'))
    next(g)
    it = g.gi_frame.f_locals['.0']
    g.close()
    log.append('after close()')
    log.append(next(it))
    it.close()
def seen_in_the_frame_before_it_starts():
    g = (x for x in items('it'))
    it = g.gi_frame.f_locals['.0']
    next(g)
    g.close()
    log.append('after close()')
    log.append(next(it))
    it.close()
def seen_by_a_trace_function():
    seen = []
    def trace(frame, event, argument):
        if frame.f_code.co_name == '<genexpr>':
            seen.append(frame.f_locals['.0'])
        return trace
    sys.settrace(trace)
    try:
        next(x for x in items('it'))
    finally:
        sys.settrace(None)
    log.append('after next()')
    log.append(next(seen[0]))
    seen[0].close()

def main():
    # What a trace function hears of it. (First, while each function has not run yet: where CPython's interpreter has adapted the code of a call to what is called,
    # it drops the arguments of a call that raises after it has told of the exception, not before.)
    events = []
    def trace(frame, event, argument):
        if frame.f_code.co_filename == __file__:
            events.append('%s %s %d' % (event[0], frame.f_code.co_name, frame.f_lineno - frame.f_code.co_firstlineno))
            return trace
    for function in (sum_raises, loop_is_left, only_the_first, function_returns, body_raises, any_is_decided, one_in_another, second_loop, list_comprehension, comprehension_with_two_loops, closed_by_the_program):
        sys.settrace(trace)
        try:
            function()
        finally:
            sys.settrace(None)
        print(function.__name__ + ':', ', '.join(events))
        del events[:], log[:]
    functions = [value for name, value in globals().items() if callable(value) and name not in ('items', 'half', 'main')]
    for function in functions:
        function()
        print(function.__name__ + ':', ', '.join(map(str, log)))
        del log[:]
main()
