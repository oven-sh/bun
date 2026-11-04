# A trace function sends the frame back to where the code needs what it no longer needed where it was: the iterator of a loop
# that it was about to leave, the subject of a `match`. A collection in between must not take it away.
import contextlib
import gc
import sys


def run(function, source, target, *args):
    code = function.__code__
    state = {'done': False}

    def tracer(frame, event, arg):
        if frame.f_code is not code:
            return None
        if event == 'line' and frame.f_lineno - code.co_firstlineno == source and not state['done']:
            state['done'] = True
            gc.collect()
            try:
                frame.f_lineno = code.co_firstlineno + target
            except ValueError as e:
                print('   ', e)
            gc.collect()
        return tracer

    sys.settrace(tracer)
    try:
        result = function(*args)
        if hasattr(result, '__next__'):
            result = list(result)
    finally:
        sys.settrace(None)
    print(function.__name__, source, target, result)


def loop(items):
    out = []
    for x in items:
        out.append(x)
        if len(out) < 3:
            continue
        out.append('end')
        break
    return out


def generator(items):
    for x in items:
        if x < 3:
            yield x
            continue
        yield 'last'
        break


def returns(items):
    out = []
    for x in items:
        out.append(x)
        if x < 2:
            continue
        out.append('end')
        return out


def nested(items):
    out = []
    for x in items:
        for y in items:
            out.append((x, y))
            if y < 2:
                continue
            out.append('inner')
            break
        if x < 2:
            continue
        out.append('outer')
        break
    return out


def over_a_call(n):
    out = []
    for x in iter(range(n)):
        out.append(x)
        if x < 2:
            continue
        out.append('end')
        break
    return out


def matches(subject):
    out = []
    match subject:
        case 1:
            out.append('one')
        case 2:
            out.append('two')
        case _:
            out.append('other')
            out.append('end')
    return out


def in_a_with(items):
    out = []
    with contextlib.nullcontext(out) as c:
        for x in items:
            c.append(x)
            if x < 2:
                continue
            c.append('end')
            break
        out.append('after')
        return out


def in_a_handler(items):
    out = []
    try:
        raise ValueError('first')
    except ValueError as e:
        for x in items:
            out.append(x)
            if x < 2:
                continue
            out.append(str(e))
            break
        out.append(repr(sys.exception()))
    out.append(repr(sys.exception()))
    return out


items = [1, 2, 3, 4, 5]
run(loop, 6, 5, items)
run(loop, 7, 3, items)
run(generator, 6, 4, items)
run(generator, 5, 4, items)
run(returns, 6, 5, items)
run(returns, 7, 3, items)
run(nested, 7, 6, items)
run(nested, 8, 4, items)
run(nested, 11, 10, items)
run(nested, 12, 9, items)
run(over_a_call, 6, 5, 5)
run(over_a_call, 7, 3, 5)
run(matches, 9, 3, 7)
run(matches, 9, 5, 7)
run(in_a_with, 7, 6, items)
run(in_a_with, 9, 4, items)
run(in_a_with, 10, 3, items)
run(in_a_handler, 9, 8, items)
run(in_a_handler, 10, 6, items)
run(in_a_handler, 11, 5, items)
