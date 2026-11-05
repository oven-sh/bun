# An exception that is caught, and everything a program can find out about it: how it was raised x how the handler gets hold of
# it x when x how the handler is left. Each case is a small program of its own; what is shown is the traceback (function, line, the line its frame is on,
# the callers of the frame), whether it is the same object each time it is asked for, the context and the cause.
import gc, hashlib, sys, threading, traceback, warnings

warnings.simplefilter('ignore')
STEP, OFFSET = 1, 0

PRELUDE = '''
import gc, sys, threading, traceback
class Plain(KeyError): pass
class WithInit(KeyError):
    def __init__(self, *args):
        super().__init__(*args)
        self.extra = sys.exception()
class WithNew(KeyError):
    def __new__(cls, *args):
        return super().__new__(cls, *args)
class WithSlots(KeyError):
    __slots__ = ('a',)
class Meta(type):
    def __call__(cls, *args):
        made = super().__call__(*args)
        try:
            raise ValueError('in the metaclass')
        except ValueError as v:
            made.__context__ = v
            made.__traceback__ = v.__traceback__
        return made
class WithMeta(KeyError, metaclass=Meta): pass
class Unhashable:
    def __hash__(self): raise KeyError('hash')
class Attributes:
    def __getattr__(self, name): raise AttributeError(name)
def make(): return KeyError('made by a function')
def callee(): raise KeyError('callee')
def callee2(): callee()
def ask(): return sys.exception()
def returns():
    return 5
    yield
class Suspend:
    def __await__(self):
        yield 'suspended'
def ask_deeper(): return ask()
def walk(frame):
    names = []
    while frame is not None:
        names.append(frame.f_code.co_name)
        frame = frame.f_back
    return '<'.join(names[:names.index('<module>') + 1] if '<module>' in names else names + ['nothing'])
def look(e, depth=0):
    if e is None:
        return None
    rows = []
    tb = e.__traceback__
    same = tb is e.__traceback__
    while tb is not None:
        rows.append((tb.tb_frame.f_code.co_name, tb.tb_lineno, tb.tb_frame.f_lineno, walk(tb.tb_frame), tb.tb_lasti >= 0))
        tb = tb.tb_next
    rest = () if depth > 2 else (look(e.__context__, depth + 1), look(e.__cause__, depth + 1))
    return (type(e).__name__, repr(e.args), same, rows) + rest
out = []
'''

RAISES = {
    'class': 'raise KeyError',
    'call': 'raise KeyError("k")',
    'subscript': '{}["k"]',
    'division': '1 / 0',
    'attribute': 'None.missing',
    'name': 'missing_name',
    'next': 'next(iter(()))',
    'plain': 'raise Plain("p")',
    'init': 'raise WithInit("p")',
    'new': 'raise WithNew("p")',
    'slots': 'raise WithSlots("p")',
    'meta': 'raise WithMeta("p")',
    'instance': 'made = KeyError("made"); raise made',
    'function': 'raise make()',
    'with_traceback': 'raise KeyError("k").with_traceback(None)',
    'from': 'raise KeyError("k") from ValueError("cause")',
    'callee': 'callee()',
    'callee2': 'callee2()',
    'hash': '{}.get(Unhashable())',
    'getattr': 'Attributes().missing',
    'group': 'raise ExceptionGroup("g", [KeyError(1)])',
    'assert': 'assert not sys',
    'unpack': 'a, b = 1,',
    'import': 'import no_such_module_at_all',
}

# What gives the handler the exception, as `e`.
DOORS = {
    'nothing': 'e = None',
    'as': 'e = named',
    'exception': 'e = sys.exception()',
    'exc_info': 'e = sys.exc_info()[1]',
    'asked by a callee': 'e = ask_deeper()',
    'context': 'try:\n    raise ValueError("v")\nexcept ValueError as v:\n    e = v.__context__',
    'current': 'e = sys._current_exceptions()[threading.get_ident()]',
    'format': 'out.append(traceback.format_exc().count("\\n")); e = None',
}

WORK = 'x = [i for i in range(3)]\ntry:\n    int("no")\nexcept ValueError:\n    pass\ntry:\n    next(returns())\nexcept StopIteration:\n    pass\nlen(ask.__name__)'

WHENS = {
    'early': '{door}\nout.append(look(e))\n{work}',
    'late': '{work}\n{door}\nout.append(look(e))',
    'twice': '{door}\nfirst = e\nout.append(look(e))\n{work}\n{door}\nout.append((e is first, look(e)))',
    'after': '{door}\nkept.append(e)\n{work}',
}

# `handler` is what WHENS makes.
WAYS_OUT = {
    'falls off': 'def f(kept):\n    try:\n        {raises}\n    except {clause}:\n{handler8}\n    return "end"',
    'return': 'def f(kept):\n    try:\n        {raises}\n    except {clause}:\n{handler8}\n        return "returned"',
    'break': 'def f(kept):\n    for i in range(2):\n        try:\n            {raises}\n        except {clause}:\n{handler12}\n            break\n    return i',
    'continue': 'def f(kept):\n    for i in range(2):\n        try:\n            {raises}\n        except {clause}:\n{handler12}\n            continue\n    return i',
    'raises another': 'def f(kept):\n    try:\n        {raises}\n    except {clause}:\n{handler8}\n        raise OSError("another")',
    'raises from': 'def f(kept):\n    try:\n        {raises}\n    except {clause}:\n{handler8}\n        raise OSError("another") from sys.exception()',
    'raises again': 'def f(kept):\n    try:\n        {raises}\n    except {clause}:\n{handler8}\n        raise',
    'finally': 'def f(kept):\n    try:\n        {raises}\n    finally:\n        named = sys.exception()\n{handler8}',
    'finally returns': 'def f(kept):\n    try:\n        {raises}\n    finally:\n        named = sys.exception()\n{handler8}\n        return "swallowed"',
    'second handler': 'def f(kept):\n    try:\n        try:\n            {raises}\n        except MemoryError:\n            pass\n    except {clause}:\n{handler8}\n    return "end"',
    'caught twice': 'def f(kept):\n    try:\n        try:\n            {raises}\n        except BaseException:\n            raise\n    except {clause}:\n{handler8}\n    return "end"',
    'caller catches': 'def g():\n    {raises}\ndef f(kept):\n    try:\n        g()\n    except {clause}:\n{handler8}\n    return "end"',
    'generator': 'def g(kept):\n    try:\n        {raises}\n    except {clause}:\n{handler8}\n        yield 1\n        out.append(look(sys.exception()))\n    yield 2\ndef f(kept):\n    return list(g(kept))',
    'except star': 'def f(kept):\n    try:\n        {raises}\n    except* {star}:\n{handler8}\n    return "end"',
    'with': 'class Manager:\n    def __enter__(self):\n        return self\n    def __exit__(self, kind, named, traceback):\n{handler8}\n        return True\ndef f(kept_by_caller):\n    with Manager():\n        {raises}\n    return "end"',
    'coroutine': 'async def g(kept):\n    try:\n        {raises}\n    except {clause}:\n{handler8}\n        await Suspend()\n        out.append(look(sys.exception()))\n    return "done"\ndef f(kept):\n    c = g(kept)\n    seen = [c.send(None), sys.exception()]\n    try:\n        c.send(None)\n    except StopIteration as s:\n        seen.append(s.value)\n    return seen',
    'coroutine, no await in the handler': 'async def g(kept):\n    await Suspend()\n    try:\n        {raises}\n    except {clause}:\n{handler8}\n    await Suspend()\n    return "done"\ndef f(kept):\n    c = g(kept)\n    seen = [c.send(None), c.send(None), sys.exception()]\n    try:\n        c.send(None)\n    except StopIteration as s:\n        seen.append(s.value)\n    return seen',
    'generator, no yield in the handler': 'def g(kept):\n    yield 0\n    try:\n        {raises}\n    except {clause}:\n{handler8}\n    yield sys.exception()\ndef f(kept):\n    return list(g(kept))',
    'class body': 'def f(kept):\n    class C:\n        try:\n            {raises}\n        except {clause}:\n{handler12}\n        after = sys.exception()\n    return C.after',
    'module': 'kept = []\ntry:\n    {raises}\nexcept {clause}:\n{handler4}\ndef f(kept_by_caller):\n    kept_by_caller += kept\n    return sys.exception()',
    'nested function': 'def f(kept):\n    def inner():\n        try:\n            {raises}\n        except {clause}:\n{handler12}\n        return "inner"\n    return inner()',
}


def indent(text, by):
    return '\n'.join(' ' * by + line for line in text.split('\n'))


def cases():
    for how, raises in RAISES.items():
        for door_name, door in DOORS.items():
            for when, shape in WHENS.items():
                for way, function in WAYS_OUT.items():
                    yield how, raises, door_name, door, when, shape, way, function


DRIVER = '''
kept = []
try:
    out.append(f(kept))
except BaseException as escaped:
    out.append(('escaped', look(escaped)))
out.append(sys.exception())
out.append([look(e) for e in kept])
'''

count = 0
digests = {}
for number, (how, raises, door_name, door, when, shape, way, function) in enumerate(cases()):
    if number % STEP != OFFSET:
        continue
    handler = shape.format(door=door, work=WORK)
    clause = 'BaseException as named' if door_name == 'as' else 'BaseException'
    if door_name == 'as' and 'finally' in way:
        clause = ''
    star = 'Exception as named' if door_name == 'as' else 'Exception'
    source = PRELUDE + function.format(raises=raises, clause=clause, star=star, handler4=indent(handler, 4), handler8=indent(handler, 8), handler12=indent(handler, 12)) + DRIVER
    namespace = {'__name__': 'case'}
    exec(compile(source, '<case>', 'exec'), namespace)
    digests.setdefault((how, door_name), hashlib.sha1()).update(repr((when, way, namespace['out'])).encode())
    count += 1
# (lang/ has this with a print of each case in place of the digests.)
for (how, door_name), digest in digests.items():
    print(how, '|', door_name, '|', digest.hexdigest()[:16])
print(count, 'cases')
