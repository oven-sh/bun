# The line a frame is on when the function has ended by falling off its end, and what a trace function is told on the way:
# the implicit return is of the line of whatever ran last, whichever way led to it.
try: import sys, asyncio, contextlib
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys, asyncio, contextlib')
try: TRUE = True
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: TRUE = True')
try: FALSE = False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: FALSE = False')
try:
    def if1(x):
        x()
        if TRUE:
            pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def if1(x):')
try:
    def if2(x):
        x()
        if TRUE:
            pass
        else:
            pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def if2(x):')
try:
    def if3(x):
        x()
        if TRUE:
            pass
        else:
            return None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def if3(x):')
try:
    def if4(x):
        x()
        if not TRUE:
            pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def if4(x):')
try:
    def loop1(x):
        x()
        for i in range(2):
            pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def loop1(x):')
try:
    def loop2(x):
        x()
        for i in range(2):
            if i:
                break
        else:
            pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def loop2(x):')
try:
    def try1(x):
        x()
        try:
            pass
        except ValueError:
            y = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def try1(x):')
try:
    def try2(x):
        x()
        try:
            raise ValueError
        except ValueError:
            y = 1
        else:
            y = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def try2(x):')
try:
    def with1(x):
        x()
        with open(__file__) as f:
            pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def with1(x):')
try:
    def while1(x):
        x()
        n = 0
        while n < 2:
            n += 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def while1(x):')
try:
    def match1(x):
        x()
        match TRUE:
            case False:
                y = 1
            case True:
                y = 2
            case _:
                y = 3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def match1(x):')
try:
    def nested(x):
        x()
        if TRUE:
            if TRUE:
                y = 1
            else:
                y = 2
        else:
            y = 3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def nested(x):')
try:
    def cond1(x):
        x()
        if (TRUE and
                FALSE):
            pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cond1(x):')
try:
    def cond2(x):
        x()
        if (FALSE or
                TRUE):
            pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cond2(x):')
try:
    def cond3(x):
        x()
        while (TRUE and
                FALSE):
            pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cond3(x):')
try:
    def elif1(x):
        x()
        if FALSE:
            pass
        elif TRUE:
            y = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def elif1(x):')
try:
    def elif2(x):
        x()
        if FALSE:
            pass
        elif FALSE:
            y = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def elif2(x):')
try:
    def fin1(x):
        x()
        try:
            y = 0
        finally:
            y = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def fin1(x):')
try:
    def fin2(x):
        x()
        try:
            try:
                raise ValueError
            finally:
                y = 1
        except ValueError:
            pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def fin2(x):')
try:
    def fin3(x):
        x()
        for i in range(2):
            try:
                continue
            finally:
                y = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def fin3(x):')
try:
    def with2(x):
        x()
        with contextlib.suppress(ValueError):
            raise ValueError
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def with2(x):')
try:
    def with3(x):
        x()
        with contextlib.nullcontext() as a, contextlib.nullcontext() as b:
            y = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def with3(x):')
try:
    def with4(x):
        x()
        with (contextlib.nullcontext() as a,
              contextlib.nullcontext() as b):
            y = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def with4(x):')
try:
    def loop3(x):
        x()
        for i in range(3):
            if i == 1:
                break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def loop3(x):')
try:
    def loop4(x):
        x()
        n = 0
        while True:
            n += 1
            if n > 1:
                break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def loop4(x):')
try:
    def loop5(x):
        x()
        for i in range(2):
            for j in range(2):
                pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def loop5(x):')
try:
    def loop6(x):
        x()
        for i in range(2):
            if i:
                continue
            y = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def loop6(x):')
try:
    def loop7(x):
        x()
        n = 0
        while n < 2:
            n += 1
        else:
            y = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def loop7(x):')
try:
    def match2(x):
        x()
        match TRUE:
            case False:
                y = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def match2(x):')
try:
    def match4(x):
        x()
        match {'a': 1}:
            case {'b': _}:
                y = 1
            case [1, 2]:
                y = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def match4(x):')
try:
    def tryelse(x):
        x()
        try:
            y = 0
        except ValueError:
            y = 1
        else:
            if TRUE:
                y = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def tryelse(x):')
try:
    def tryname(x):
        x()
        try:
            raise ValueError
        except ValueError as e:
            y = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def tryname(x):')
try:
    def assert1(x):
        x()
        assert TRUE, 'no'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def assert1(x):')
try:
    def del1(x):
        x()
        y = 1
        del y
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def del1(x):')
try:
    def call1(x):
        x()
        print(
            end='')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def call1(x):')
try:
    def doc(x):
        'doc'
        x()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def doc(x):')
try:
    def ann(x):
        x()
        y: int
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def ann(x):')
try:
    def pass1(x):
        x()
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def pass1(x):')
try:
    def glob(x):
        x()
        global zzz
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def glob(x):')
try:
    def ifconst(x):
        x()
        if 0:
            y = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def ifconst(x):')
try:
    def ifconst2(x):
        x()
        if 1:
            y = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def ifconst2(x):')
try:
    def whileconst(x):
        x()
        while 0:
            y = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def whileconst(x):')
try:
    def nestedfn(x):
        x()
        def g():
            pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def nestedfn(x):')
try:
    def nestedcls(x):
        x()
        class C:
            pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def nestedcls(x):')
try:
    def deco(x):
        x()
        @staticmethod
        def g():
            pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def deco(x):')
try: frame = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: frame = None')
try:
    def save():
        global frame
        frame = sys._getframe(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def save():')
try: fs = [v for k, v in list(globals().items()) if getattr(v, '__code__', None) and v.__code__.co_argcount == 1 and v.__module__ == __name__]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: fs = [v for k, v in list(globals().items()) if getattr(v, '__code__',...")
try:
    for f in fs:
        try: f(save)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f(save)')
        try: events = []
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: events = []')
        def tracer(fr, ev, arg):
            if fr.f_code is f.__code__:
                events.append((ev, None if fr.f_lineno is None else fr.f_lineno - f.__code__.co_firstlineno))
            return tracer
        try: after = frame.f_lineno
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: after = frame.f_lineno')
        try: after = None if after is None else after - frame.f_code.co_firstlineno
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: after = None if after is None else after - frame.f_code.co_firstlineno')
        try: sys.settrace(tracer)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.settrace(tracer)')
        try: f(lambda: None)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f(lambda: None)')
        try: sys.settrace(None)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.settrace(None)')
        try: print('f.__name__ [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', f.__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__name__')
        try: print('after [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', after)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: after')
        try: print('events [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', events)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: events')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in fs:')

try:
    async def afor(x):
        x()
        async for i in agen():
            pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def afor(x):')
try:
    async def awith(x):
        x()
        async with contextlib.nullcontext():
            y = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def awith(x):')
try:
    async def agen():
        yield 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def agen():')
try:
    def gen1(x):
        x()
        yield 1
        if TRUE:
            pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def gen1(x):')
try:
    for f in (afor, awith):
        try: asyncio.run(f(save))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: asyncio.run(f(save))')
        try: print('f.__name__ [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', f.__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__name__')
        try: print('frame.f_lineno - frame.f_code.co_firstlineno if frame.f_lineno else None [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', frame.f_lineno - frame.f_code.co_firstlineno if frame.f_lineno else None)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: frame.f_lineno - frame.f_code.co_firstlineno if frame.f_lineno else None')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (afor, awith):')
try: list(gen1(save))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(gen1(save))')
try: print('gen1', 'frame.f_lineno - frame.f_code.co_firstlineno if frame.f_lineno else None =>', frame.f_lineno - frame.f_code.co_firstlineno if frame.f_lineno else None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: frame.f_lineno - frame.f_code.co_firstlineno if frame.f_lineno else None')
