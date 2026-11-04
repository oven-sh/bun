# tb_lineno, tb_lasti, and f_lineno and f_lasti of a frame whose call has ended, asked for late: after the function has other code, after
# collections, more than once.
try: import gc
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import gc')
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try: import types
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import types')


try:
    def raises(x):
        y = x + 1
        return y // 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def raises(x):')


try:
    def calls(x):
        z = 1
        return raises(
            x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def calls(x):')


try:
    def entries(e):
        tb = e.__traceback__
        out = []
        while tb:
            code = tb.tb_frame.f_code
            positions = list(code.co_positions())[tb.tb_lasti // 2]
            out.append((code.co_name, tb.tb_lineno - code.co_firstlineno, tb.tb_frame.f_lineno - code.co_firstlineno, tb.tb_lasti == tb.tb_frame.f_lasti, positions[0] - code.co_firstlineno, positions[2:]))
            tb = tb.tb_next
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def entries(e):')


try:
    def catch(f, *a):
        try:
            f(*a)
        except Exception as e:
            return e
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def catch(f, *a):')


try: e = catch(calls, 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e = catch(calls, 1)')
try: print(entries(e)[1:])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: entries(e)[1:]')
try: print(entries(e)[1:])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: entries(e)[1:]')

try: print('--- the function has other code by then')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- the function has other code by then'")


try:
    def other(x):


        return 'other'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def other(x):')


try: e = catch(calls, 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e = catch(calls, 1)')
try: old = raises.__code__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: old = raises.__code__')
try: raises.__code__ = other.__code__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: raises.__code__ = other.__code__')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: print(entries(e)[1:])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: entries(e)[1:]')
try: print(calls(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: calls(1)')
try: raises.__code__ = old
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: raises.__code__ = old')

try: print('--- many, kept, and looked at after collections')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- many, kept, and looked at after collections'")
try: kept = [catch(calls, i) for i in range(200)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: kept = [catch(calls, i) for i in range(200)]')
try:
    for i in range(3):
        try: gc.collect()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in range(3):')
try: print({tuple(entries(e)[1:]) for e in kept})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: {tuple(entries(e)[1:]) for e in kept}')

try: print('--- code that nothing else keeps')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- code that nothing else keeps'")
try: namespace = {}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: namespace = {}')
try: exec(compile('def f():\n    a = 1\n\n    return a / 0\n', '<made>', 'exec'), namespace)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: exec(compile('def f():\\n a = 1\\n\\n return a / 0\\n', '<made>', 'exec')...")
try: e = catch(namespace.pop('f'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: e = catch(namespace.pop('f'))")
try: del namespace
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del namespace')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: print(entries(e)[1:])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: entries(e)[1:]')

try: print('--- a frame that returned')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- a frame that returned'")


try:
    def returns():
        frame = sys._getframe()
        return frame
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def returns():')


try: frame = returns()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: frame = returns()')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: print('frame.f_lineno - frame.f_code.co_firstlineno =>', frame.f_lineno - frame.f_code.co_firstlineno)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: frame.f_lineno - frame.f_code.co_firstlineno')
try: print('frame.f_lasti >= 0 =>', frame.f_lasti >= 0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: frame.f_lasti >= 0')
try: print('frame.f_lineno - frame.f_code.co_firstlineno =>', frame.f_lineno - frame.f_code.co_firstlineno)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: frame.f_lineno - frame.f_code.co_firstlineno')


try:
    def returns_at_the_end(p):
        global frame
        frame = sys._getframe()
        if p:
            x = 1
        else:
            x = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def returns_at_the_end(p):')


try:
    for p in (0, 1):
        try: returns_at_the_end(p)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: returns_at_the_end(p)')
        try: print('frame.f_lineno - frame.f_code.co_firstlineno [' + 'p=' + (repr(p) if type(p) in (str, int, float, bytes, bool, type(None)) or (type(p) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in p)) else p.__name__ if type(p) is type else type(p).__name__) + '] =>', frame.f_lineno - frame.f_code.co_firstlineno)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: frame.f_lineno - frame.f_code.co_firstlineno')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for p in (0, 1):')

try: print('--- a generator that ended')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- a generator that ended'")


try:
    def gen():
        global frame
        frame = sys._getframe()
        yield 1
        yield 2
        raise ValueError
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def gen():')


try: g = gen()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = gen()')
try: lines = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lines = []')
try:
    try:
        for x in g:
            lines.append(frame.f_lineno - frame.f_code.co_firstlineno)
    except ValueError as e:
        print('lines =>', lines)
        print('frame.f_lineno - frame.f_code.co_firstlineno =>', frame.f_lineno - frame.f_code.co_firstlineno)
        print('entries(e)[1:] =>', entries(e)[1:])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')

try: print('--- left through a with, a finally, an except')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- left through a with, a finally, an except'")


try:
    class CM:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class CM:')


try:
    def through_with():
        with CM():
            x = 1
            raise ValueError
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def through_with():')


try:
    def through_finally():
        try:
            raise ValueError
        finally:
            x = 1
            y = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def through_finally():')


try:
    def through_except():
        try:
            raise ValueError
        except KeyError:
            pass
        except OSError:
            pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def through_except():')


try:
    def raised_again():
        try:
            raise ValueError
        except ValueError:
            x = 1
            raise
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def raised_again():')


try:
    def raised_again_by_name():
        try:
            raise ValueError
        except ValueError as e:
            x = 1
            raise e
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def raised_again_by_name():')


try:
    for f in (through_with, through_finally, through_except, raised_again, raised_again_by_name):
        try: print('f.__name__ [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', f.__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__name__')
        try: print('entries(catch(f))[1:] [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', entries(catch(f))[1:])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: entries(catch(f))[1:]')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (through_with, through_finally, through_except, raised_again...')

try: print('--- made by the program')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- made by the program'")
try: tb = types.TracebackType(None, frame, 4, 77)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tb = types.TracebackType(None, frame, 4, 77)')
try: print('tb.tb_lineno =>', tb.tb_lineno)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tb.tb_lineno')
try: print('tb.tb_lasti =>', tb.tb_lasti)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tb.tb_lasti')
try: print('tb.tb_next =>', tb.tb_next)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tb.tb_next')
