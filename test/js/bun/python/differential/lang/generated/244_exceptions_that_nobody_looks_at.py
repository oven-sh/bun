# An exception that is caught, and everything a program can find out about it: how it was raised x how the handler gets hold of
# it x when x how the handler is left. Each case is a small program of its own; what is shown is the traceback (function, line, the line its frame is on,
# the callers of the frame), whether it is the same object each time it is asked for, the context and the cause.
try: import gc, sys, threading, traceback, warnings
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import gc, sys, threading, traceback, warnings')

try: warnings.simplefilter('ignore')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: warnings.simplefilter('ignore')")
try: STEP, OFFSET = 97, 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: STEP, OFFSET = 97, 0')

try: PRELUDE = '''
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: PRELUDE = ''' import gc, sys, threading, traceback class Plain(KeyErr...")

try: RAISES = {
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: RAISES = { \'class\': \'raise KeyError\', \'call\': \'raise KeyError("k")\', ...')

# What gives the handler the exception, as `e`.
try: DOORS = {
    'nothing': 'e = None',
    'as': 'e = named',
    'exception': 'e = sys.exception()',
    'exc_info': 'e = sys.exc_info()[1]',
    'asked by a callee': 'e = ask_deeper()',
    'context': 'try:\n    raise ValueError("v")\nexcept ValueError as v:\n    e = v.__context__',
    'current': 'e = sys._current_exceptions()[threading.get_ident()]',
    'format': 'out.append(traceback.format_exc().count("\\n")); e = None',
}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: DOORS = { 'nothing': 'e = None', 'as': 'e = named', 'exception': 'e =...")

try: WORK = 'x = [i for i in range(3)]\ntry:\n    int("no")\nexcept ValueError:\n    pass\ntry:\n    next(returns())\nexcept StopIteration:\n    pass\nlen(ask.__name__)'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: WORK = \'x = [i for i in range(3)]\\ntry:\\n int("no")\\nexcept ValueErro...')

try: WHENS = {
    'early': '{door}\nout.append(look(e))\n{work}',
    'late': '{work}\n{door}\nout.append(look(e))',
    'twice': '{door}\nfirst = e\nout.append(look(e))\n{work}\n{door}\nout.append((e is first, look(e)))',
    'after': '{door}\nkept.append(e)\n{work}',
}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: WHENS = { 'early': '{door}\\nout.append(look(e))\\n{work}', 'late': '{w...")

# `handler` is what WHENS makes.
try: WAYS_OUT = {
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: WAYS_OUT = { 'falls off': 'def f(kept):\\n try:\\n {raises}\\n except {c...")


try:
    def indent(text, by):
        return '\n'.join(' ' * by + line for line in text.split('\n'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def indent(text, by):')


try:
    def cases():
        for how, raises in RAISES.items():
            for door_name, door in DOORS.items():
                for when, shape in WHENS.items():
                    for way, function in WAYS_OUT.items():
                        yield how, raises, door_name, door, when, shape, way, function
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cases():')


try: DRIVER = '''
kept = []
try:
    out.append(f(kept))
except BaseException as escaped:
    out.append(('escaped', look(escaped)))
out.append(sys.exception())
out.append([look(e) for e in kept])
'''
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: DRIVER = ''' kept = [] try: out.append(f(kept)) except BaseException ...")

try: count = 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: count = 0')
try:
    for number, (how, raises, door_name, door, when, shape, way, function) in enumerate(cases()):
        if number % STEP != OFFSET:
            continue
        try: handler = shape.format(door=door, work=WORK)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: handler = shape.format(door=door, work=WORK)')
        try: clause = 'BaseException as named' if door_name == 'as' else 'BaseException'
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: clause = 'BaseException as named' if door_name == 'as' else 'BaseExce...")
        if door_name == 'as' and 'finally' in way:
            try: clause = ''
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: clause = ''")
        try: star = 'Exception as named' if door_name == 'as' else 'Exception'
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: star = 'Exception as named' if door_name == 'as' else 'Exception'")
        try: source = PRELUDE + function.format(raises=raises, clause=clause, star=star, handler4=indent(handler, 4), handler8=indent(handler, 8), handler12=indent(handler, 12)) + DRIVER
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: source = PRELUDE + function.format(raises=raises, clause=clause, star...')
        try: namespace = {'__name__': 'case'}
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: namespace = {'__name__': 'case'}")
        try: exec(compile(source, '<case>', 'exec'), namespace)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: exec(compile(source, '<case>', 'exec'), namespace)")
        try: print('how [' + 'number=' + (repr(number) if type(number) in (str, int, float, bytes, bool, type(None)) or (type(number) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in number)) else number.__name__ if type(number) is type else type(number).__name__) + ", " + 'how=' + (repr(how) if type(how) in (str, int, float, bytes, bool, type(None)) or (type(how) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in how)) else how.__name__ if type(how) is type else type(how).__name__) + ", " + 'raises=' + (repr(raises) if type(raises) in (str, int, float, bytes, bool, type(None)) or (type(raises) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in raises)) else raises.__name__ if type(raises) is type else type(raises).__name__) + ", " + 'door_name=' + (repr(door_name) if type(door_name) in (str, int, float, bytes, bool, type(None)) or (type(door_name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in door_name)) else door_name.__name__ if type(door_name) is type else type(door_name).__name__) + ", " + 'door=' + (repr(door) if type(door) in (str, int, float, bytes, bool, type(None)) or (type(door) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in door)) else door.__name__ if type(door) is type else type(door).__name__) + ", " + 'when=' + (repr(when) if type(when) in (str, int, float, bytes, bool, type(None)) or (type(when) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in when)) else when.__name__ if type(when) is type else type(when).__name__) + ", " + 'shape=' + (repr(shape) if type(shape) in (str, int, float, bytes, bool, type(None)) or (type(shape) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in shape)) else shape.__name__ if type(shape) is type else type(shape).__name__) + ", " + 'way=' + (repr(way) if type(way) in (str, int, float, bytes, bool, type(None)) or (type(way) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in way)) else way.__name__ if type(way) is type else type(way).__name__) + ", " + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + '] =>', how)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: how')
        try: print('|', 'door_name [' + 'number=' + (repr(number) if type(number) in (str, int, float, bytes, bool, type(None)) or (type(number) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in number)) else number.__name__ if type(number) is type else type(number).__name__) + ", " + 'how=' + (repr(how) if type(how) in (str, int, float, bytes, bool, type(None)) or (type(how) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in how)) else how.__name__ if type(how) is type else type(how).__name__) + ", " + 'raises=' + (repr(raises) if type(raises) in (str, int, float, bytes, bool, type(None)) or (type(raises) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in raises)) else raises.__name__ if type(raises) is type else type(raises).__name__) + ", " + 'door_name=' + (repr(door_name) if type(door_name) in (str, int, float, bytes, bool, type(None)) or (type(door_name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in door_name)) else door_name.__name__ if type(door_name) is type else type(door_name).__name__) + ", " + 'door=' + (repr(door) if type(door) in (str, int, float, bytes, bool, type(None)) or (type(door) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in door)) else door.__name__ if type(door) is type else type(door).__name__) + ", " + 'when=' + (repr(when) if type(when) in (str, int, float, bytes, bool, type(None)) or (type(when) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in when)) else when.__name__ if type(when) is type else type(when).__name__) + ", " + 'shape=' + (repr(shape) if type(shape) in (str, int, float, bytes, bool, type(None)) or (type(shape) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in shape)) else shape.__name__ if type(shape) is type else type(shape).__name__) + ", " + 'way=' + (repr(way) if type(way) in (str, int, float, bytes, bool, type(None)) or (type(way) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in way)) else way.__name__ if type(way) is type else type(way).__name__) + ", " + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + '] =>', door_name)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: door_name')
        try: print('|', 'when [' + 'number=' + (repr(number) if type(number) in (str, int, float, bytes, bool, type(None)) or (type(number) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in number)) else number.__name__ if type(number) is type else type(number).__name__) + ", " + 'how=' + (repr(how) if type(how) in (str, int, float, bytes, bool, type(None)) or (type(how) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in how)) else how.__name__ if type(how) is type else type(how).__name__) + ", " + 'raises=' + (repr(raises) if type(raises) in (str, int, float, bytes, bool, type(None)) or (type(raises) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in raises)) else raises.__name__ if type(raises) is type else type(raises).__name__) + ", " + 'door_name=' + (repr(door_name) if type(door_name) in (str, int, float, bytes, bool, type(None)) or (type(door_name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in door_name)) else door_name.__name__ if type(door_name) is type else type(door_name).__name__) + ", " + 'door=' + (repr(door) if type(door) in (str, int, float, bytes, bool, type(None)) or (type(door) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in door)) else door.__name__ if type(door) is type else type(door).__name__) + ", " + 'when=' + (repr(when) if type(when) in (str, int, float, bytes, bool, type(None)) or (type(when) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in when)) else when.__name__ if type(when) is type else type(when).__name__) + ", " + 'shape=' + (repr(shape) if type(shape) in (str, int, float, bytes, bool, type(None)) or (type(shape) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in shape)) else shape.__name__ if type(shape) is type else type(shape).__name__) + ", " + 'way=' + (repr(way) if type(way) in (str, int, float, bytes, bool, type(None)) or (type(way) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in way)) else way.__name__ if type(way) is type else type(way).__name__) + ", " + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + '] =>', when)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: when')
        try: print('|', 'way [' + 'number=' + (repr(number) if type(number) in (str, int, float, bytes, bool, type(None)) or (type(number) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in number)) else number.__name__ if type(number) is type else type(number).__name__) + ", " + 'how=' + (repr(how) if type(how) in (str, int, float, bytes, bool, type(None)) or (type(how) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in how)) else how.__name__ if type(how) is type else type(how).__name__) + ", " + 'raises=' + (repr(raises) if type(raises) in (str, int, float, bytes, bool, type(None)) or (type(raises) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in raises)) else raises.__name__ if type(raises) is type else type(raises).__name__) + ", " + 'door_name=' + (repr(door_name) if type(door_name) in (str, int, float, bytes, bool, type(None)) or (type(door_name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in door_name)) else door_name.__name__ if type(door_name) is type else type(door_name).__name__) + ", " + 'door=' + (repr(door) if type(door) in (str, int, float, bytes, bool, type(None)) or (type(door) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in door)) else door.__name__ if type(door) is type else type(door).__name__) + ", " + 'when=' + (repr(when) if type(when) in (str, int, float, bytes, bool, type(None)) or (type(when) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in when)) else when.__name__ if type(when) is type else type(when).__name__) + ", " + 'shape=' + (repr(shape) if type(shape) in (str, int, float, bytes, bool, type(None)) or (type(shape) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in shape)) else shape.__name__ if type(shape) is type else type(shape).__name__) + ", " + 'way=' + (repr(way) if type(way) in (str, int, float, bytes, bool, type(None)) or (type(way) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in way)) else way.__name__ if type(way) is type else type(way).__name__) + ", " + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + '] =>', way)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: way')
        try: print('|', "namespace['out'] [" + 'number=' + (repr(number) if type(number) in (str, int, float, bytes, bool, type(None)) or (type(number) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in number)) else number.__name__ if type(number) is type else type(number).__name__) + ", " + 'how=' + (repr(how) if type(how) in (str, int, float, bytes, bool, type(None)) or (type(how) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in how)) else how.__name__ if type(how) is type else type(how).__name__) + ", " + 'raises=' + (repr(raises) if type(raises) in (str, int, float, bytes, bool, type(None)) or (type(raises) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in raises)) else raises.__name__ if type(raises) is type else type(raises).__name__) + ", " + 'door_name=' + (repr(door_name) if type(door_name) in (str, int, float, bytes, bool, type(None)) or (type(door_name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in door_name)) else door_name.__name__ if type(door_name) is type else type(door_name).__name__) + ", " + 'door=' + (repr(door) if type(door) in (str, int, float, bytes, bool, type(None)) or (type(door) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in door)) else door.__name__ if type(door) is type else type(door).__name__) + ", " + 'when=' + (repr(when) if type(when) in (str, int, float, bytes, bool, type(None)) or (type(when) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in when)) else when.__name__ if type(when) is type else type(when).__name__) + ", " + 'shape=' + (repr(shape) if type(shape) in (str, int, float, bytes, bool, type(None)) or (type(shape) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in shape)) else shape.__name__ if type(shape) is type else type(shape).__name__) + ", " + 'way=' + (repr(way) if type(way) in (str, int, float, bytes, bool, type(None)) or (type(way) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in way)) else way.__name__ if type(way) is type else type(way).__name__) + ", " + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + '] =>', namespace['out'])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: namespace['out']")
        try: count += 1
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: count += 1')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for number, (how, raises, door_name, door, when, shape, way, function...')
try: print('count =>', count)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: count')
try: print('cases')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'cases'")
