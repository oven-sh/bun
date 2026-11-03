# frame.f_lineno = line, in a trace function.
import sys
import warnings


class Jumper:
    def __init__(self, function, source, target, event='line'):
        self.code = function.__code__
        self.source = source
        self.target = target
        self.event = event
        self.first = None
        self.done = False

    def trace(self, frame, event, arg):
        if self.done or frame.f_code is not self.code:
            return self.trace if frame.f_code is self.code else None
        first = self.code.co_firstlineno
        if event == self.event and frame.f_lineno == first + self.source:
            self.done = True
            frame.f_lineno = first + self.target
            self.seen = frame.f_lineno - first
        return self.trace


def attempt(function, source, target, event='line'):
    output = []
    jumper = Jumper(function, source, target, event)
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter('always')
        sys.settrace(jumper.trace)
        try:
            try:
                function(output)
            finally:
                sys.settrace(None)
            result = 'ok'
        except Exception as e:
            result = '%s: %s' % (type(e).__name__, e)
    print(function.__name__, source, '->', target, output, result, getattr(jumper, 'seen', None), [str(w.message) for w in caught])


def straight(output):
    output.append(1)
    output.append(2)
    output.append(3)
    output.append(4)


def loop(output):
    output.append(1)
    for i in range(2):
        output.append(3)
        output.append(4)
    output.append(5)


def two_loops(output):
    for i in [1, 2]:
        output.append(2)
    for j in [10, 20]:
        output.append((4, j))
    output.append(5)


def while_loop(output):
    n = 0
    while n < 2:
        output.append(3)
        n += 1
    output.append(5)


def try_except(output):
    try:
        output.append(2)
        raise ValueError
    except ValueError:
        output.append(5)
        output.append(6)
    output.append(7)


def try_finally(output):
    try:
        output.append(2)
    finally:
        output.append(4)
        output.append(5)
    output.append(6)


class Manager:
    def __init__(self, output):
        self.output = output

    def __enter__(self):
        self.output.append('enter')

    def __exit__(self, *args):
        self.output.append('exit')


def with_block(output):
    output.append(1)
    with Manager(output):
        output.append(3)
        output.append(4)
    output.append(5)


def unbound(output):
    output.append(1)
    x = 2
    output.append(x)


def nested(output):
    for i in range(1):
        for j in range(1):
            output.append(3)
        output.append(4)
    output.append(5)


def if_else(output):
    if output is not None:
        output.append(2)
    else:
        output.append(4)
    output.append(5)


def blank_lines(output):
    output.append(1)

    # a comment

    output.append(5)


for function, source, target in [
    (straight, 1, 3), (straight, 3, 1), (straight, 2, 2), (straight, 1, 4), (straight, 1, 5), (straight, 1, 100), (straight, 2, 0), (straight, 2, -1), (straight, 2, -100),
    (loop, 1, 3), (loop, 1, 4), (loop, 3, 5), (loop, 4, 3), (loop, 3, 1), (loop, 5, 3), (loop, 4, 2), (loop, 5, 2), (loop, 1, 5),
    (two_loops, 2, 4), (two_loops, 4, 2), (two_loops, 2, 5),
    (while_loop, 1, 3), (while_loop, 3, 5), (while_loop, 5, 3), (while_loop, 5, 2),
    (try_except, 2, 5), (try_except, 2, 4), (try_except, 5, 7), (try_except, 5, 2), (try_except, 6, 5), (try_except, 7, 2), (try_except, 7, 6), (try_except, 1, 2), (try_except, 2, 7),
    (try_finally, 2, 4), (try_finally, 2, 5), (try_finally, 4, 2), (try_finally, 6, 4), (try_finally, 1, 6), (try_finally, 5, 4),
    (with_block, 1, 3), (with_block, 3, 5), (with_block, 4, 3), (with_block, 5, 3), (with_block, 3, 1), (with_block, 5, 2), (with_block, 1, 5),
    (unbound, 1, 3), (unbound, 3, 1),
    (nested, 3, 4), (nested, 3, 5), (nested, 4, 3), (nested, 5, 1), (nested, 4, 2),
    (if_else, 2, 4), (if_else, 1, 4), (if_else, 5, 2),
    (blank_lines, 1, 2), (blank_lines, 1, 3), (blank_lines, 5, 2),
]:
    attempt(function, source, target)

for event in ('call', 'return', 'exception'):
    attempt(try_except, {'call': 0, 'return': 7, 'exception': 3}[event], 2, event)


def generator(output):
    output.append(1)
    yield 2
    output.append(3)
    output.append(4)


def drive(output):
    for value in generator(output):
        output.append(('yielded', value))


def attempt_in_generator(source, target, event='line'):
    output = []
    jumper = Jumper(generator, source, target, event)
    sys.settrace(jumper.trace)
    try:
        try:
            drive(output)
        finally:
            sys.settrace(None)
        result = 'ok'
    except Exception as e:
        result = '%s: %s' % (type(e).__name__, e)
    print('generator', source, '->', target, event, output, result)


attempt_in_generator(1, 3)
attempt_in_generator(3, 1)
attempt_in_generator(4, 3)
attempt_in_generator(3, 2)
