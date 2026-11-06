# The two ways of a branch are switched off one by one: a tool that answers DISABLE is not told of that way again, at that branch, until
# restart_events(), and is still told of the other.
import sys

M = sys.monitoring
E = M.events


def for_loop(n):
    t = 0
    for i in range(n):
        t += i
    return t


def for_break(n):
    for i in range(n):
        if i == 2:
            break
    n += i
    n += i
    return n


def for_else(n):
    for i in range(n):
        if i == 7:
            break
    else:
        i = -1
    return i


def for_continue(n):
    t = 0
    for i in range(n):
        if i % 2:
            continue
        t += i
    return t


def while_loop(n):
    i = 0
    while i < n:
        i += 1
    return i


def while_else(n):
    i = 0
    while i < n:
        i += 1
    else:
        i = -i
    return i


def while_true(n):
    i = 0
    while True:
        i += 1
        if i >= n:
            return i


def if_else(n):
    t = 0
    for i in range(n):
        if i % 3:
            t += 1
        else:
            t -= 1
    return t


def if_only(n):
    t = 0
    for i in range(n):
        if i < 100:
            t += 1
    return t


def if_never(n):
    t = 0
    for i in range(n):
        if i > 100:
            t += 1
    return t


def if_last(n):
    for i in range(n):
        if i > 1:
            n = 0


def elifs(n):
    t = 0
    for i in range(n):
        if i == 0:
            t += 1
        elif i == 1:
            t += 2
        elif i == 50:
            t += 3
        else:
            t += 4
    return t


def and_or(n):
    t = 0
    for i in range(n):
        if i and t or not t:
            t = 1 - t
    return t


def values(n):
    t = None
    for i in range(n):
        t = i and t
        t = t or i
    return t


def none_tests(n):
    t = None
    for i in range(n):
        if t is None:
            t = i
        if t is not None:
            t = t or None
    return t


def nested(n):
    t = 0
    for i in range(n):
        for j in range(i):
            if j:
                t += 1
    return t


def comprehension(n):
    return [i for i in range(n) if i % 2], {i: j for i in range(n) for j in range(2) if i if j}


def generator(n):
    def inner():
        for i in range(n):
            if i:
                yield i
    return sum(inner()) + sum(i for i in range(n) if i > 1)


def handlers(n):
    t = 0
    for i in range(n):
        try:
            if i == 1:
                raise KeyError
            t += 1
        except KeyError:
            t -= 1
        except ValueError:
            t = 0
        finally:
            if t:
                t += 10
            t += 1
    return t


def withs(n):
    class C:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return True
    t = 0
    for i in range(n):
        with C():
            if i == 1:
                raise KeyError
            t += 1
    return t


def matches(n):
    t = 0
    for i in range(n):
        match i:
            case 0:
                t += 1
            case 1 | 2:
                t += 2
            case int(x) if x > 50:
                t += 3
            case _:
                t += 4
    return t


def one_line(n):
    for i in range(n): n = n and i
    return n


def returns(n):
    for i in range(n):
        if i == 3: return i
    return -1


FUNCTIONS = [for_loop, for_break, for_else, for_continue, while_loop, while_else, while_true, if_else, if_only, if_never, if_last, elifs, and_or, values,
             none_tests, nested, comprehension, generator, handlers, withs, matches, one_line, returns]
NAMES = {E.BRANCH_LEFT: 'L', E.BRANCH_RIGHT: 'R', E.LINE: 'line', E.JUMP: 'J'}


def line_of(code, offset):
    for start, end, line in code.co_lines():
        if start <= offset < end:
            return line - code.co_firstlineno if line is not None else None
    return '?'


def run(function, tools, argument=5, times=1):
    """tools: {tool id: (events, what is answered DISABLE)}"""
    log = []

    def callback(tool, event, disabled):
        def told(code, *rest):
            if code.co_filename != __file__ or code.co_name in ('run', 'told'):
                return None
            if event == E.LINE:
                log.append((tool, 'line', rest[0] - code.co_firstlineno))
            else:
                log.append((tool, NAMES[event], line_of(code, rest[0]), line_of(code, rest[1])))
            return M.DISABLE if event in disabled else None
        return told

    for tool, (events, disabled) in tools.items():
        M.use_tool_id(tool, 'test%d' % tool)
        wanted = 0
        for event in events:
            M.register_callback(tool, event, callback(tool, event, disabled))
            wanted |= event
        M.set_events(tool, wanted)
    results = []
    try:
        for _ in range(times):
            mark = len(log)
            function(argument)
            results.append(log[mark:])
    finally:
        for tool, (events, disabled) in tools.items():
            M.set_events(tool, 0)
            for event in events:
                M.register_callback(tool, event, None)
            M.free_tool_id(tool)
    return results


def short(entries, with_tool=False):
    out = []
    for entry in entries:
        text = ''.join(str(part) if index != 2 else '>' + str(part) for index, part in enumerate(entry[1:])) if entry[1] != 'line' else str(entry[2])
        out.append(('%d:' % entry[0] if with_tool else '') + text)
    return ' '.join(out)


BOTH = (E.BRANCH_LEFT, E.BRANCH_RIGHT)
for function in FUNCTIONS:
    print('==', function.__name__)
    print('all    ', short(run(function, {1: (BOTH, ())})[0]))
    for label, disabled in (('no L   ', (E.BRANCH_LEFT,)), ('no R   ', (E.BRANCH_RIGHT,)), ('neither', BOTH)):
        first, second = run(function, {1: (BOTH, disabled)}, times=2)
        print(label, short(first), '|', short(second))
    print('only L ', short(run(function, {1: ((E.BRANCH_LEFT,), ())})[0]))
    print('only R ', short(run(function, {1: ((E.BRANCH_RIGHT,), ())})[0]))
    print('lines  ', short(run(function, {1: (BOTH + (E.LINE,), ())})[0]))
    print('lines- ', short(run(function, {1: (BOTH + (E.LINE,), BOTH + (E.LINE,))})[0]))
    print('lines-L', short(run(function, {1: (BOTH + (E.LINE,), (E.BRANCH_LEFT, E.LINE))})[0]))
    print('jumps  ', short(run(function, {1: (BOTH + (E.JUMP,), ())})[0]))
    print('jumps-R', short(run(function, {1: (BOTH + (E.JUMP,), (E.BRANCH_RIGHT,))})[0]))
    print('only J ', short(run(function, {1: ((E.JUMP,), ())})[0]))
    print('two    ', short(run(function, {1: (BOTH, BOTH), 2: (BOTH, ())})[0], True))
    print('two LR ', short(run(function, {1: (BOTH, (E.BRANCH_LEFT,)), 2: (BOTH, (E.BRANCH_RIGHT,))})[0], True))

print('== restart_events()')
M.use_tool_id(1, 'test')
log = []


def told(name):
    def callback(code, source, destination):
        if code is if_else.__code__:
            log.append(name + str(line_of(code, source)) + '>' + str(line_of(code, destination)))
        return M.DISABLE
    return callback


M.register_callback(1, E.BRANCH_LEFT, told('L'))
M.register_callback(1, E.BRANCH_RIGHT, told('R'))
M.set_events(1, E.BRANCH_LEFT | E.BRANCH_RIGHT)
for step in range(3):
    log.clear()
    if_else(5)
    print(step, ' '.join(log))
    if step == 1:
        M.restart_events()
print('in the middle of a loop')


def restarts(code, source, destination):
    if code is if_else.__code__:
        log.append('R' + str(line_of(code, source)) + '>' + str(line_of(code, destination)))
        M.restart_events()
    return M.DISABLE


M.restart_events()
M.register_callback(1, E.BRANCH_RIGHT, restarts)
log.clear()
if_else(7)
print(' '.join(log))
print('local events')
M.set_events(1, 0)
M.restart_events()
M.register_callback(1, E.BRANCH_RIGHT, told('R'))
M.set_local_events(1, if_else.__code__, E.BRANCH_LEFT)
log.clear()
if_else(5)
M.set_local_events(1, if_else.__code__, E.BRANCH_LEFT | E.BRANCH_RIGHT)
if_else(5)
M.set_local_events(1, if_else.__code__, E.BRANCH_RIGHT)
if_else(5)
M.set_local_events(1, if_else.__code__, 0)
if_else(5)
print(' '.join(log))
print('switched on and off while the loop runs')


def switches(code, source, destination):
    if code is while_loop.__code__:
        log.append('L' + str(line_of(code, source)) + '>' + str(line_of(code, destination)))
        M.set_events(1, E.BRANCH_RIGHT if len(log) == 2 else E.BRANCH_LEFT | E.BRANCH_RIGHT)


def right(code, source, destination):
    if code is while_loop.__code__:
        log.append('R' + str(line_of(code, source)) + '>' + str(line_of(code, destination)))


M.register_callback(1, E.BRANCH_LEFT, switches)
M.register_callback(1, E.BRANCH_RIGHT, right)
log.clear()
M.set_events(1, E.BRANCH_LEFT)
while_loop(4)
M.set_events(1, 0)
print(' '.join(log))
print('a callback that raises')


def raises(code, source, destination):
    if code is handlers.__code__ and line_of(code, source) == 4:
        raise KeyError('from the tool')


for event in BOTH:
    M.register_callback(1, E.BRANCH_LEFT, None)
    M.register_callback(1, E.BRANCH_RIGHT, None)
    M.register_callback(1, event, raises)
    M.set_events(1, event)
    try:
        result = handlers(3)
    except KeyError as e:
        result = 'raised', e.args, e.__traceback__.tb_next.tb_lineno - handlers.__code__.co_firstlineno
    M.set_events(1, 0)
    print(result)
print('what the frame says meanwhile')


def looks(code, source, destination):
    if code is if_else.__code__:
        frame = sys._getframe(1)
        log.append((frame.f_lineno - code.co_firstlineno, frame.f_locals.get('i'), frame.f_locals.get('t')))


log.clear()
M.register_callback(1, E.BRANCH_LEFT, looks)
M.register_callback(1, E.BRANCH_RIGHT, looks)
M.set_events(1, E.BRANCH_LEFT | E.BRANCH_RIGHT)
if_else(4)
M.set_events(1, 0)
print(log)
M.free_tool_id(1)

print('== the event of old')
M.use_tool_id(1, 'test')
log.clear()
with __import__('warnings').catch_warnings():
    __import__('warnings').simplefilter('ignore')
    BRANCH = E.BRANCH


def old(code, source, destination):
    if code is if_else.__code__:
        log.append(str(line_of(code, source)) + '>' + str(line_of(code, destination)))
        return M.DISABLE


M.register_callback(1, BRANCH, old)
M.set_events(1, BRANCH)
if_else(5)
M.set_events(1, 0)
M.free_tool_id(1)
print(' '.join(log))

print('== with a trace function that sends the frame elsewhere')


def jumper(n):
    t = 0
    for i in range(n):
        if i == 1:
            t += 100
        t += 1
    return t


def trace(frame, event, argument):
    if frame.f_code is jumper.__code__ and event == 'line' and frame.f_lineno == jumper.__code__.co_firstlineno + 3 and frame.f_locals['i'] == 0:
        frame.f_lineno = jumper.__code__.co_firstlineno + 4
    return trace


M.use_tool_id(1, 'test')
log.clear()


def seen(name):
    def callback(code, source, destination):
        if code is jumper.__code__:
            log.append(name + str(line_of(code, source)) + '>' + str(line_of(code, destination)))
    return callback


M.register_callback(1, E.BRANCH_LEFT, seen('L'))
M.register_callback(1, E.BRANCH_RIGHT, seen('R'))
M.set_events(1, E.BRANCH_LEFT | E.BRANCH_RIGHT)
sys.settrace(trace)
print(jumper(3))
sys.settrace(None)
M.set_events(1, 0)
M.free_tool_id(1)
print(' '.join(log))
