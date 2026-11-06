# f(x, *positional, **keywords) while somebody listens: what is told of the call, and when, beside what the call itself runs of the program.
import sys

events = []
monitoring = sys.monitoring
TOOL = 3


def fvk(*args, **kw): return (args, kw)
def f2(a, b=2): return (a, b)


class Plain:
    def __init__(self, *args, **kw): pass
    def method(self, *args, **kw): return (args, kw)
    def __call__(self, *args, **kw): return (args, kw)
    def __repr__(self): return 'Plain()'


class Iterable:
    def __init__(self, *items, fails=False): self.items, self.fails = items, fails
    def __iter__(self):
        events.append('iter')
        yield from self.items
        if self.fails:
            raise LookupError('the iterable')
        events.append('end of iter')


class Mapping:
    def __init__(self, *names): self.names = names
    def keys(self):
        events.append('keys')
        return list(self.names)
    def __getitem__(self, name):
        events.append('item of %r' % (name,))
        return 1


class Name(str):
    def __hash__(self):
        events.append('hash of %s' % str(self))
        return 1
    def __eq__(self, other):
        events.append('%s == %s' % (str(self), str(other)))
        return str(self) == str(other)


def name_of(what):
    return getattr(what, '__qualname__', None) or repr(what)


def shown(value):
    return 'MISSING' if value is monitoring.MISSING else repr(value)


o = Plain()
bound = o.method
CASES = '''
fvk(*(1, 2))
fvk(*[1, 2])
fvk(*())
fvk(*(), **{})
fvk(**{})
fvk(**{'x': 1})
fvk(*(), **{'x': 1})
fvk(0, *(1,))
fvk(0, *())
fvk(0, **{'x': 1})
fvk(0, **{})
fvk(*(1,), x=2)
fvk(*(), x=2)
fvk(*(1,), *(2,))
fvk(*(), 3)
fvk(*Iterable(1, 2))
fvk(*Iterable())
fvk(0, *Iterable(1))
fvk(*Iterable(1), **Mapping('x'))
fvk(0, *Iterable(1), **Mapping('x'))
fvk(**Mapping('x', 'y'))
fvk(*Iterable(1), x=2, **Mapping('y'))
fvk(*Iterable(1, fails=True))
fvk(0, *Iterable(1, fails=True), **Mapping('x'))
fvk(*Iterable(1, fails=True), **Mapping('x'))
fvk(*5)
fvk(**5)
fvk(*Iterable(1), **5)
fvk(*(1,), **{1: 2})
fvk(*Iterable(1), **{1: 2})
fvk(*Iterable(1), **Mapping(1))
fvk(x=1, **Mapping('x'))
f2(*(1,), **{'a': 2})
f2(*(1, 2, 3))
f2(*Iterable(1, 2, 3))
f2(**Mapping('c'))
fvk(**{Name('x'): 1, Name('y'): 2})
fvk(*(1,), **{Name('x'): 1, Name('y'): 2})
fvk(*Iterable(1), **{Name('x'): 1, Name('y'): 2})
f2(**{Name('a'): 1, Name('b'): 2})
dict(**{Name('x'): 1, Name('y'): 2})
len(*('ab',))
len(*Iterable('ab'))
len(*())
len(*(1,))
len(*('ab',), **{})
len(*('ab',), **{'x': 1})
len(*('ab',), **{1: 2})
max(1, *(2, 3))
max(*Iterable(1, 2), **Mapping('key'))
dict(*(), **Mapping('x'))
dict(**{'x': 1})
Plain(*(1,))
Plain(*Iterable(1), **Mapping('x'))
Plain(**{})
o(*(1,))
o(*Iterable(1), **Mapping('x'))
o(*())
o.method(*(1,))
o.method(*())
o.method(0, *Iterable(1), **Mapping('x'))
bound(*(1,))
bound(*())
bound(**{'x': 1})
Plain.method(*(o, 1))
Plain.method(o, *(1,))
[].append(*(1,))
'{}'.format(*(1,))
str.upper(*('a',))
None(*Iterable(1))
None(*(1,), **Mapping('x'))
(lambda *a: a)(*(1,))
'''.strip().split('\n')


def run(text, code):
    events.clear()
    try:
        result = repr(eval(code))
    except Exception as e:
        result = type(e).__name__ + ': ' + str(e)
    return result


codes = [(text, compile(text, '<case>', 'eval')) for text in CASES]

print('--- nobody listens')
quiet = {}
for text, code in codes:
    result = run(text, code)
    quiet[text] = (result, list(events))
    print(text, '|', result, '|', events)

# (Keys that are no strs: CPython tells of the call and then refuses it.)
codes = [(text, code) for text, code in codes if '1: 2' not in text and 'Mapping(1)' not in text]

print('--- sys.monitoring: CALL, C_RETURN, C_RAISE, PY_START')
E = monitoring.events
monitoring.use_tool_id(TOOL, 'test')


def only_cases(function):
    def callback(code, *rest):
        if code.co_filename == '<case>':
            function(*rest)
    return callback


monitoring.register_callback(TOOL, E.CALL, only_cases(lambda offset, what, first: events.append('CALL %s %s' % (name_of(what), shown(first)))))
monitoring.register_callback(TOOL, E.C_RETURN, only_cases(lambda offset, what, first: events.append('C_RETURN %s %s' % (name_of(what), shown(first)))))
monitoring.register_callback(TOOL, E.C_RAISE, only_cases(lambda offset, what, first: events.append('C_RAISE %s %s' % (name_of(what), shown(first)))))
monitoring.register_callback(TOOL, E.PY_START, lambda code, offset: events.append('PY_START ' + code.co_qualname) if code.co_qualname in ('fvk', 'f2', 'Plain.__init__', 'Plain.method', 'Plain.__call__', '<lambda>') else None)
for turn in range(2):
    for text, code in codes:
        monitoring.set_events(TOOL, E.CALL | E.C_RETURN | E.C_RAISE | E.PY_START)
        result = run(text, code)
        monitoring.set_events(TOOL, 0)
        told = list(events)
        print(text, '|', result == quiet[text][0] or result, '|', told)
        rest = [e for e in told if not e.startswith(('CALL ', 'C_RETURN ', 'C_RAISE ', 'PY_START '))]
        if rest != quiet[text][1]:
            print('    the program itself ran something else:', rest)
monitoring.free_tool_id(TOOL)

print('--- sys.setprofile')


def profiler(frame, event, arg):
    if event.startswith('c_') and frame.f_code.co_filename == '<case>':
        events.append('%s %s' % (event, name_of(arg)))
    elif event == 'call' and frame.f_back and frame.f_back.f_code.co_filename == '<case>' and not frame.f_code.co_qualname.startswith('Name.'):
        events.append('call ' + frame.f_code.co_qualname)


for text, code in codes:
    events.clear()
    sys.setprofile(profiler)
    try:
        result = repr(eval(code))
    except Exception as e:
        result = type(e).__name__ + ': ' + str(e)
    finally:
        sys.setprofile(None)
    print(text, '|', result == quiet[text][0] or result, '|', events)

print('--- what the one who listens does to the operands')
monitoring.use_tool_id(TOOL, 'test')
the_list, the_dict = [1, 2], {'x': 1}


def meddles(code, offset, what, first):
    if code.co_filename == '<case>':
        the_list.append('late')
        the_dict['late'] = 1
        events.append('CALL %s %s' % (name_of(what), shown(first)))


monitoring.register_callback(TOOL, E.CALL, meddles)
for text in ('fvk(*the_list)', 'fvk(**the_dict)', 'fvk(*the_list, **the_dict)', 'fvk(0, *the_list, **the_dict)', 'max(*the_list[:2])', 'dict(**the_dict)', 'fvk(*the_list, x=1)'):
    the_list[:], code = [1, 2], compile(text, '<case>', 'eval')
    the_dict.clear()
    the_dict['x' if 'x=1' not in text else 'y'] = 1
    monitoring.set_events(TOOL, E.CALL)
    result = run(text, code)
    monitoring.set_events(TOOL, 0)
    print(text, '|', result, '|', events, the_list, the_dict)


def raises(code, offset, what, first):
    if code.co_filename == '<case>':
        raise KeyError('the listener')


monitoring.register_callback(TOOL, E.CALL, raises)
for text in ('fvk(*Iterable(1), **Mapping("x"))', 'len(*Iterable("a"))', 'fvk(0, *(1,))'):
    code = compile(text, '<case>', 'eval')
    monitoring.set_events(TOOL, E.CALL)
    result = run(text, code)
    monitoring.set_events(TOOL, 0)
    print(text, '|', result, '|', events)
monitoring.free_tool_id(TOOL)

print('--- whoever is told of the lines changes the list')


def on_lines(f, l, k):
    return f(0,
        *l,
        **k)


def on_one_line(f, l, k):
    return f(0, *l, **k)


def on_lines_keyword(f, l, k):
    return f(0,
        *l,
        x=k)


for function in (on_lines, on_one_line, on_lines_keyword):
    the_list = [1]

    def tracer(frame, event, arg):
        if frame.f_code is function.__code__:
            if event == 'line':
                the_list.append('line %d' % (frame.f_lineno - function.__code__.co_firstlineno))
            return tracer
    sys.settrace(tracer)
    try:
        result = function(fvk, the_list, {})
    finally:
        sys.settrace(None)
    print(function.__name__, result, the_list)

print('--- lines')
several_lines = '''
def c1(f, a, k):
    return f(
        0,
        1,
        *a,
        **k
    )
def c2(f, a, k):
    return f(
        0,
        *a
    )
def c3(f, a, k):
    return f(
        0,
        **k
    )
def c4(f, a, k):
    return f(0,
        1,
        *a,
        x=2,
        **k)
def c5(f, a, k):
    return f(
        a,
        k,
        *a,
        *a
    )
def c6(f, a, k):
    return f(
        a,
        *a,
        k
    )
def c7(f, a, k):
    return f(
        1, 2, 3,
        **k
    )
def c8(f, a, k):
    return f(
        1, 2, 3,
        *a
    )
def c9(f, a, k):
    return f(
        f(
            *a
        ),
        *f(
            **k
        )[0],
        **f(
            0,
            *a,
            **k
        )[1]
    )
def c10(f, a, k):
    x = f(
        0,
        *a,
        y=1
    )
    return x
'''
scope = {}
exec(compile(several_lines, 'several_lines', 'exec'), scope)


def lines_of(function, *args):
    seen = []

    def tracer(frame, event, arg):
        if frame.f_code is function.__code__:
            if event == 'line':
                seen.append(frame.f_lineno - function.__code__.co_firstlineno)
            return tracer
    sys.settrace(tracer)
    try:
        function(*args)
    finally:
        sys.settrace(None)
    return seen


for name in sorted(scope, key=lambda n: (len(n), n)):
    if name.startswith('c'):
        function = scope[name]
        first = function.__code__.co_firstlineno
        print(name, lines_of(function, fvk, (1,), {'z': 2}), lines_of(function, fvk, [], {}), lines_of(function, fvk, iter(()), {}), [line - first for _, _, line in function.__code__.co_lines() if line is not None], function.__code__.co_consts)

print('--- as many arguments before the star as CPython has on its stack, and more')
for count in (2, 3, 28, 29, 30, 31, 32):
    for what, item in (('constants', lambda i: str(i)), ('variables', lambda i: 'a')):
        for tail in ('*a', '**k', '*a,\n        **k', '*a,\n        x=1'):
            source = 'def c(f, a, k):\n    return f(\n' + ''.join('        %s,\n' % item(i) for i in range(count)) + '        ' + tail + ')\n'
            scope = {}
            exec(compile(source, 'generated', 'exec'), scope)
            function = scope['c']
            lines = lines_of(function, fvk, (1,), {'z': 2})
            consts = [c if not isinstance(c, tuple) else ('tuple of', len(c)) for c in function.__code__.co_consts]
            print(count, what, tail.replace('\n        ', ' '), len(lines), lines[:8], lines[-6:], consts[:4], len(consts))
